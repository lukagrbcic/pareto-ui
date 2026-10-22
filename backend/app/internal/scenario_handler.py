#####################################################################################################
# PARETO was produced under the DOE Produced Water Application for Beneficial Reuse Environmental
# Impact and Treatment Optimization (PARETO), and is copyright (c) 2021-2024 by the software owners:
# The Regents of the University of California, through Lawrence Berkeley National Laboratory, et al.
# All rights reserved.
#
# NOTICE. This Software was developed under funding from the U.S. Department of Energy and the U.S.
# Government consequently retains certain rights. As such, the U.S. Government has been granted for
# itself and others acting on its behalf a paid-up, nonexclusive, irrevocable, worldwide license in
# the Software to reproduce, distribute copies to the public, prepare derivative works, and perform
# publicly and display publicly, and to permit others to do so.
#####################################################################################################
import logging
import shutil
import os
import datetime
from pathlib import Path
import tinydb
from fastapi import HTTPException
from importlib.resources import files
import json
from copy import deepcopy
import tempfile
import threading
from functools import wraps

import idaes.logger as idaeslog

from app.internal.workbooks.reader import get_data, get_input_lists
from app.internal.settings import AppSettings
from app.internal.workbooks.excel_api import PreprocessMapData, WriteMapDataToExcel, WriteJSONToExcel
from app.internal.util import (
    time_it, 
    FormatPrompt,
    FormatOptimizationDiagnosisPrompt,
    summarize_long_text,
)
    
from app.internal.ai.configuration import ai_configuration as cborg
from app.internal.optimization.model_diagnostics import build_diagnosis_context, DIAGNOSTIC_LIMITATION
from app.internal.scenarios.input_schema import input_revision, with_horizon
from app.internal.scenarios.inputs import read_inputs, write_inputs, sync_map_fields, changed_pipe_fields, prune_removed_map_nodes, rename_map_nodes

# _log = idaeslog.getLogger(__name__)
_log = logging.getLogger(__name__)

def serialized(method):
    """Keep each read/modify/write operation together on this handler.

    The handler uses an RLock because a persistence operation can call another
    decorated method while refreshing its in-memory scenario list.
    """
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self._db_lock:
            return method(self, *args, **kwargs)
    return wrapped

class ScenarioHandler:
    """Manage the saved scenarios."""

    VERSION = 3
    SCENARIO_DB_FILE = f"scenarios.json"


    def __init__(self, **kwargs) -> None:
        self._db_lock = threading.RLock()
        _log.info(f"initializing scenario handler")
        self.app_settings = AppSettings(**kwargs)

        self.scenario_list = {}
        self.next_id = 0
        self.background_tasks = []
        self.data_directory_path = self.app_settings.data_basedir
        self.scenarios_path = self.data_directory_path / f"v{self.VERSION}" / self.SCENARIO_DB_FILE
        self.excelsheets_path = self.data_directory_path / f"v{self.VERSION}" / "excelsheets"
        self.outputs_path = self.data_directory_path / f"v{self.VERSION}" / "outputs"
        self.input_diagrams_path = self.data_directory_path / f"v{self.VERSION}" / "input_diagrams"
        self.output_diagrams_path = self.data_directory_path / f"v{self.VERSION}" / "output_diagrams"

        _log.info(f"app directory: {os.path.dirname(os.path.abspath(__file__))}")
        _log.info(f"currently operating in directory: {os.getcwd()}")
        try:
            _log.info(f"changing to home directroy")
            home_dir = Path.home()
            _log.info(f"new directory: {home_dir}")
            os.chdir(home_dir)
        except Exception as e:
            _log.info(f"unable to change to app directroy: {e}")

        ### check for data directory
        has_data = os.path.isdir(self.data_directory_path / f"v{self.VERSION}")
        _log.info(f'has_data is {has_data}')


        # create data directories
        _log.info(f"making directory: {self.data_directory_path}")
        self.data_directory_path.mkdir(parents=True, exist_ok=True)

        _log.info(f"making directory: {self.excelsheets_path}")
        self.excelsheets_path.mkdir(parents=True, exist_ok=True)

        _log.info(f"making directory: {self.outputs_path}")
        self.outputs_path.mkdir(parents=True, exist_ok=True)

        _log.info(f"making directory: {self.input_diagrams_path}")
        self.input_diagrams_path.mkdir(parents=True, exist_ok=True)

        _log.info(f"making directory: {self.output_diagrams_path}")
        self.output_diagrams_path.mkdir(parents=True, exist_ok=True)

        # Connect to DB
        path = self.scenarios_path
        self._db = tinydb.TinyDB(path)
        self.update_next_id()
        self.retrieve_scenarios()

    def import_default_data(self):
        default_ids = [1,2,3,4,5]
        default_directories = [("excelsheets", "xlsx"), ("input_diagrams", "png"), ("output_diagrams", "png"), ("outputs", "xlsx")]
        default_data_path = files('app').joinpath(f"internal/assets/v{self.VERSION}_default")
        destination_directory = self.data_directory_path / f"v{self.VERSION}"
        for directory in default_directories:
            d_name = directory[0]
            d_ext  = directory[1]
            for each in default_ids:
                f_path = default_data_path.joinpath(f"{d_name}/{each}.{d_ext}")
                destination_path = destination_directory.joinpath(f"{d_name}/{each}.{d_ext}")
                _log.info(f'moving {f_path} to {destination_path}')
                shutil.copyfile(f_path, destination_path)
        ### copy over scenarios.json files
        f_path = default_data_path.joinpath(f"scenarios.json")
        destination_path = destination_directory.joinpath(f"scenarios.json")
        _log.info(f'moving {f_path} to {destination_path}')
        shutil.copyfile(f_path, destination_path)

    @serialized
    def retrieve_scenarios(self):
        _log.info(f"retrieving scenarios")

        query = tinydb.Query()
        scenarios = self._db.search((query.id_ != None) & (query.version == self.VERSION))
        scenario_list = {}
        _log.info(f'found {len(scenarios)} scenarios')
        if len(scenarios) > 0:
            for each in scenarios:
                scenario_list[each["id_"]] =  each['scenario']
            self.scenario_list=scenario_list
        else:
            self.scenario_list={}


    def retrieve_scenario(self, id):
        return self.get_scenario(int(id))

    @serialized
    def _persist_scenario(self, scenario):
        scenario = deepcopy(scenario)
        data_input = scenario.get('data_input', {})
        if 'units' not in data_input:
            excel_path = self.excelsheets_path / f"{scenario['id']}.xlsx"
            if excel_path.exists():
                data_input['units'] = get_data(str(excel_path))[1]['Units']
        revision = input_revision(scenario)
        scenario['input_revision'] = revision
        if scenario.get('validation', {}).get('revision') != revision:
            from app.internal.validation.scenario_validation import validate_inputs
            # Refresh all input issues; previous build/solver evidence is stale.
            scenario['validation'] = validate_inputs(scenario)

        query = tinydb.Query()
        self._db.upsert(
            {"scenario": scenario, 'id_': scenario['id'], 'version': self.VERSION},
            ((query.id_ == scenario['id']) & (query.version == self.VERSION)),
        )

        self.retrieve_scenarios()
        return scenario

    @serialized
    def _save_validation_results(self, scenario, validation_payload):
        current = self.get_scenario(scenario['id'])
        if input_revision(current) != validation_payload['revision']:
            return {**validation_payload, 'valid': False, 'state': 'outdated', 'error': 'Inputs changed during validation. Check the current scenario again.'}
        current['validation'] = validation_payload
        self._persist_scenario(current)
        return validation_payload
    
    @serialized
    def update_scenario(self, updatedScenario):
        _log.info(f"Updating scenario list")

        try:
            id_ = updatedScenario["id"]
            newName = updatedScenario["name"]
            oldName = self.scenario_list[id_]["name"]
            if newName.upper() == "SRA" and oldName.upper() != "SRA":
                ## move SRA image into input network diagram spot
                _log.info('scenario has been RENAMED to SRA')
                input_diagramFileType = 'png'
                original_input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/SRAInput.png'
                new_input_diagram_path = f"{self.input_diagrams_path}/{id_}.{input_diagramFileType}"
                shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                updatedScenario[f'inputDiagramExtension'] = 'png'
            if newName.upper() == "WORKSHOP BASELINE" and oldName.upper() != "WORKSHOP BASELINE":
                input_diagramFileType = 'png'
                original_input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_baseline_input.png'
                new_input_diagram_path = f"{self.input_diagrams_path}/{id_}.{input_diagramFileType}"
                shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                updatedScenario[f'inputDiagramExtension'] = 'png'
            if newName.upper() == "WORKSHOP SRA" and oldName.upper() != "WORKSHOP SRA":
                input_diagramFileType = 'png'
                original_input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_SRA_input.png'
                new_input_diagram_path = f"{self.input_diagrams_path}/{id_}.{input_diagramFileType}"
                shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                updatedScenario[f'inputDiagramExtension'] = 'png'
            if newName.upper() == "WORKSHOP BENEFICIAL REUSE" and oldName.upper() != "WORKSHOP BENEFICIAL REUSE":
                input_diagramFileType = 'png'
                original_input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_beneficial_reuse_input.png'
                new_input_diagram_path = f"{self.input_diagrams_path}/{id_}.{input_diagramFileType}"
                shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                updatedScenario[f'inputDiagramExtension'] = 'png'
            if newName.upper() == "WORKSHOP BENEFICIAL REUSE OVERRIDE" and oldName.upper() != "WORKSHOP BENEFICIAL REUSE OVERRIDE":
                input_diagramFileType = 'png'
                original_input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_beneficial_reuse_override_input.png'
                new_input_diagram_path = f"{self.input_diagrams_path}/{id_}.{input_diagramFileType}"
                shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                updatedScenario[f'inputDiagramExtension'] = 'png'
        except:
            _log.error('unable to check and/or replace input diagram based on scenario name')

        return self._persist_scenario(updatedScenario)
    
    @serialized
    def upload_excelsheet(self, output_path, scenarioName, filename, map_data=None, scenario_id=None):
        if scenario_id is None:
            _id = self.next_id
        _log.info(f"Uploading excel sheet: {scenarioName}")

        # create scenario object
        current_day = datetime.date.today()
        date = datetime.date.strftime(current_day, "%m/%d/%Y")
        if map_data is not None:
            status = "Incomplete"
        else:
            status = "Draft"
        return_object = {
            "name": scenarioName, 
            "id": self.next_id, 
            "date": date,
            "data_input": read_inputs(output_path, previous={'origin': 'map' if map_data else 'excel'}, map_data=map_data),
            "optimization": 
                {
                    "objective":"cost", 
                    "runtime": 900, 
                    "pipeline_cost": "distance_based", 
                    "waterQuality": "false", 
                    "hydraulics": "false",
                    "solver": "cbc",
                    "build_units": "scaled_units",
                    "optimalityGap": 0,
                    "scale_model": True
                }, 
            "results": {"status": status, "data": {}},
            "validation": {"valid": None, "state": "not_checked", "issues": []},
            "override_values": 
                {
                    "vb_y_overview_dict": {},
                    "v_F_Piped_dict": {},
                    "v_F_Sourced_dict": {},
                    "v_F_Trucked_dict": {},
                    "v_L_Storage_dict": {},
                    "v_L_PadStorage_dict": {},
                    "vb_y_Pipeline_dict": {},
                    "vb_y_Disposal_dict": {},
                    "vb_y_Storage_dict": {},
                    "vb_y_Treatment_dict": {}
                }
            }


        self._db.insert({'id_': self.next_id, "scenario": return_object, 'version': self.VERSION})

        
        return_object = self.check_for_diagram(self.next_id, filename.split('.')[0])

        self.update_next_id()
        self.retrieve_scenarios()
        
        return self._persist_scenario(return_object)
    
    @serialized
    def update_scenario_from_excel(self, scenario, excel_path, map_data):
        scenario['data_input'] = read_inputs(excel_path, previous=scenario.get('data_input'), map_data=map_data)
        return self.update_scenario(scenario)

    
    @serialized
    def replace_excelsheet(self, output_path, id):
        self.ensure_editable(id)
        scenario = self.get_scenario(id)
        scenario['data_input'] = read_inputs(output_path, previous={'origin': 'excel'})
        scenario['results'] = {'status': 'Draft', 'data': {}}
        return self.save_inputs(scenario)

    
    def check_for_diagram(self, id, filename = None):
        scenario = self.get_scenario(id)
        extension = "png"
        if filename:
            diagramType = "input"
            diagramIdentifier = filename
            scenario_diagram_path = f"{self.input_diagrams_path}/{id}.{extension}"
        else:
            diagramType = "output"
            diagramIdentifier = scenario['name']
            scenario_diagram_path = f"{self.output_diagrams_path}/{id}.{extension}"
        try:
            if scenario['name'].upper() == "WORKSHOP BASELINE":
                diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_baseline_{diagramType}.png'
            elif scenario['name'].upper() == "WORKSHOP SRA":
                diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_SRA_{diagramType}.png'
            elif scenario['name'].upper() == "WORKSHOP BENEFICIAL REUSE":
                diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_beneficial_reuse_{diagramType}.png'
            elif scenario['name'].upper() == "WORKSHOP BENEFICIAL REUSE OVERRIDE":
                diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_beneficial_reuse_override_{diagramType}.png'
                ## do input for Workshop beneficial reuse override
                input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/workshop_beneficial_reuse_override_input.png'
                input_scenario_diagram_path = f"{self.input_diagrams_path}/{id}.{extension}"
                shutil.copyfile(input_diagram_path, input_scenario_diagram_path)
                scenario[f"inputDiagramExtension"] = extension
            else: 
                diagram_path = files('pareto').parent.joinpath(f"docs/img/{diagramIdentifier}.{extension}")
            _log.info(f'diagram_path is : {diagram_path}')
            shutil.copyfile(diagram_path, scenario_diagram_path)
            scenario[f"{diagramType}DiagramExtension"] = extension
            return self.update_scenario(scenario)
        except Exception as e:
            _log.info(f'unable to find diagram_path: {e}')
            return scenario


    @serialized
    def copy_scenario(self, id, new_scenario_name):
        _log.info(f"copying scenario with id: {id}")

        try:
            # copy scenario with given id
            new_scenario = self.scenario_list[id].copy()
            new_scenario_id = self.next_id

            # update scenario name, id, and creation date
            current_day = datetime.date.today()
            date = datetime.date.strftime(current_day, "%m/%d/%Y")
            new_scenario["name"] = new_scenario_name
            new_scenario["id"] = new_scenario_id
            new_scenario["date"] = date

            # create copy of excel sheet input
            original_excel_path = "{}/{}.xlsx".format(self.excelsheets_path,id)
            new_excel_path = "{}/{}.xlsx".format(self.excelsheets_path,new_scenario_id)
            shutil.copyfile(original_excel_path, new_excel_path)

            # create copy of excel sheet output (if it exists)
            original_output_path = "{}/{}.xlsx".format(self.outputs_path,id)
            new_output_path = "{}/{}.xlsx".format(self.outputs_path,new_scenario_id)
            if (os.path.isfile(original_output_path)):
                shutil.copyfile(original_output_path, new_output_path)

            # check for disposal override scenario. if found, insert disposal diagrams in. otherwise, copy input diagram over
            if new_scenario_name.lower() == 'disposal override':
                output_diagramFileType = 'png'
                original_output_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/DisposalOverride.png'
                new_output_diagram_path = f"{self.output_diagrams_path}/{new_scenario_id}.{output_diagramFileType}"

                input_diagramFileType = 'png'
                original_input_diagram_path = f'{os.path.dirname(os.path.abspath(__file__))}/assets/DisposalOverrideInput.png'
                new_input_diagram_path = f"{self.input_diagrams_path}/{new_scenario_id}.{input_diagramFileType}"
                try:
                    shutil.copyfile(original_output_diagram_path, new_output_diagram_path)
                    new_scenario[f'outputDiagramExtension'] = 'png'
                except Exception as e:
                    _log.error(f'unable to copy disposal override output diagram over: {e}')
                try:
                    shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                    new_scenario[f'inputDiagramExtension'] = 'png'
                except Exception as e:
                    _log.error(f'unable to copy disposal override input diagram over: {e}')
            else:
                try:
                    input_diagramFileType = self.scenario_list[id][f'inputDiagramExtension']
                    original_input_diagram_path = f"{self.input_diagrams_path}/{id}.{input_diagramFileType}"
                    new_input_diagram_path = f"{self.input_diagrams_path}/{new_scenario_id}.{input_diagramFileType}"
                    if (os.path.isfile(original_input_diagram_path)):
                        shutil.copyfile(original_input_diagram_path, new_input_diagram_path)
                except:
                    _log.info('unable to copy input network diagram')
            


            # add record in db for new scenario

            self._db.insert({'id_': new_scenario_id, "scenario": new_scenario, 'version': self.VERSION})

            self.update_next_id()
            self.retrieve_scenarios()

            # return updated scenario list
            return self.scenario_list, new_scenario_id

        except Exception as e:
            _log.error(f"error copying scenario: {e}")
            raise HTTPException(
                    500, f"unable to make copy of scenario with id {id}: {e}"
                )

    @serialized
    def delete_scenario(self, index):
        self.ensure_editable(index)
        _log.info(f"Deleting scenario #{index}")

        try:
            index = int(index)
            query = tinydb.Query()
            self._db.remove((query.id_ == index) & (query.version == self.VERSION))


            # remove input excel sheet
            excel_sheet = "{}/{}.xlsx".format(self.excelsheets_path,index)
            os.remove(excel_sheet)
        except Exception as e:
            _log.error(f"unable to delete scenario #{index}: {e}")

        # remove output excel sheet
        try:
            excel_sheet = "{}/{}.xlsx".format(self.outputs_path,index)
            os.remove(excel_sheet)
        except Exception as e:
            _log.error(f"unable to remove output for #{index}: {e}")

        # remove diagram images (if they exist)
        try:
            diagramFileType = self.scenario_list[index]['inputDiagramExtension']
            input_diagram = f"{self.input_diagrams_path}/{index}.{diagramFileType}"
            _log.info(f'removing input diagram from location: {input_diagram}')
            if os.path.isfile(input_diagram):
                os.remove(input_diagram)
        except Exception as e:
            _log.error(f"unable to remove input diagram for #{index}: {e}")
        try:
            diagramFileType = self.scenario_list[index]['outputDiagramExtension']
            output_diagram = f"{self.output_diagrams_path}/{index}.{diagramFileType}"
            _log.info(f'removing output diagram from location: {output_diagram}')
            if os.path.isfile(output_diagram):
                os.remove(output_diagram)
        except Exception as e:
            _log.error(f"unable to remove output diagram for #{index}: {e}")

        # # remove completions demand plot
        # try:
        #     plot_file = "{}/{}_plot.html".format(self.outputs_path,index)
        #     os.remove(plot_file)
        # except Exception as e:
        #     _log.error(f"unable to delete completions demand plot for #{index}: {e}")

        # update scenario list
        self.retrieve_scenarios()

    @serialized
    def get_scenario(self, id):
        query = tinydb.Query()
        records = self._db.search((query.id_ == int(id)) & (query.version == self.VERSION))
        if not records:
            raise HTTPException(404, detail=f'Scenario {id} was not found.')
        result = deepcopy(records[0]['scenario'])
        data = result.get('data_input', {})
        if 'units' not in data:
            data['units'] = get_data(self.get_excelsheet_path(id))[1]['Units']
        result['input_revision'] = input_revision(result)
        return result

    def get_plots(self, id):
        return_object = {}
        plot_files = {
            'CompletionsDemand': 'Completion Pad Demand', 
            "PadRates": "Production Forecast", 
            "FlowbackRates": "Flowback Forecast"
        }
        for each in plot_files:
            try:
                key = plot_files[each]
                plot_file = f"{self.outputs_path}/{id}_{each}_plot.html"
                with open(plot_file, 'r') as f:
                    plot_html = f.read()
                    return_object[key] = plot_html
            except Exception as e:
                _log.error(f"unable to get plot for id{id}: {e}")
                raise HTTPException(
                    500, f"unable to find plot: {e}"
                )
        return return_object

    @serialized
    def add_background_task(self, id):
        self.ensure_editable(id)
        self.background_tasks.append(id)
        return self.background_tasks

    @serialized
    def remove_background_task(self, id):
        if id in self.background_tasks: 
            self.background_tasks.remove(id)
        else:
            _log.error(f'id #{id} is not in background tasks list')
        return self.background_tasks

    @serialized
    def get_list(self):
        return deepcopy(self.scenario_list)

    def get_next_id(self):
        nextid = self.next_id
        return nextid

    def get_excelsheet_path(self, id):
        return f"{self.excelsheets_path}/{id}.xlsx"
    
    def get_excel_output_path(self, id):
        return f"{self.outputs_path}/{id}.xlsx"

    def set_scenario_status(self, id, status):
        _log.info(f"setting scenario {id} status to {status}")
        try:
            scenario = self.get_scenario(int(id))
            if scenario is None or "error" in scenario:
                raise HTTPException(404, f"unable to find scenario with id {id}")

            if "results" not in scenario:
                scenario["results"] = {}
            scenario["results"]["status"] = status
            return self.update_scenario(scenario)
        except HTTPException:
            raise
        except Exception as e:
            _log.error(f"unable to set scenario status for id {id}: {e}")
            raise HTTPException(500, f"unable to set scenario status for id {id}: {e}")

    def get_diagram(self, diagram_type, id):
        try:
            diagramFileType = self.scenario_list[id][f'{diagram_type}DiagramExtension']
            if diagram_type == "input":
                diagramLocation = f"{self.input_diagrams_path}/{id}.{diagramFileType}"
            elif diagram_type == "output":
                diagramLocation = f"{self.output_diagrams_path}/{id}.{diagramFileType}"
            if os.path.isfile(diagramLocation):
                return diagramLocation
            else:
                _log.error(f"unable to find diagram for id {id}")
                raise HTTPException(400, detail=f"no diagram found")
        except Exception as e:
            _log.error(f"error: unable to find diagram for id {id}: {e}")
            raise HTTPException(400, detail=f"no diagram found: {e}")
        
    @serialized
    def update_next_id(self):
        try:


            query = tinydb.Query()
            # el = self._db.search((query.version == self.VERSION))[-1]
            # next_id = el.doc_id+1
            db_items = self._db.search((query.version == self.VERSION))
            highest_id = 0
            for each in db_items:
                if each["id_"] > highest_id:
                    highest_id = each["id_"]
            next_id = highest_id + 1
            _log.info(f'setting next id: {next_id}')
            self.next_id = next_id
        except Exception as e:
            _log.info(f"no documents found; next id is 0")
            _log.error(f"{e}")


    def get_background_tasks(self):
        return self.background_tasks

    @serialized
    def update_excel(self, id, table_key, updatedTable):
        self.ensure_editable(id)
        scenario = self.get_scenario(int(id))
        if table_key not in scenario['data_input']['df_parameters']:
            raise HTTPException(400, detail='Unknown input table.')
        scenario['data_input']['df_parameters'][table_key] = deepcopy(updatedTable)
        return self.save_inputs(scenario)


    @serialized
    def upload_diagram(self, output_path, id, diagram_type):

        query = tinydb.Query()
        scenario = self._db.search((query.id_ == int(id)) & (query.version == self.VERSION))[0]['scenario']
        scenario[f"{diagram_type}DiagramExtension"] = output_path.split('.')[-1]
        self._db.upsert(
            {"scenario": scenario, 'id_': scenario['id'], 'version': self.VERSION},
            ((query.id_ == scenario['id']) & (query.version == self.VERSION)),
        )

        self.retrieve_scenarios()
        
        return
    
    def delete_diagram(self, diagram_type, index):
        try:
            diagramFileType = self.scenario_list[index][f'{diagram_type}DiagramExtension']
            if diagram_type == "input":
                diagram = f"{self.input_diagrams_path}/{index}.{diagramFileType}"
            elif diagram_type == "output":
                diagram = f"{self.output_diagrams_path}/{index}.{diagramFileType}"
            _log.info(f'removing diagram from location: {diagram}')
            if os.path.isfile(diagram):
                os.remove(diagram)
        except Exception as e:
            _log.error(f"unable to remove diagram for #{index}: {e}")
            raise HTTPException(400, detail=f"unable to remove diagram: {e}")
        return self.scenario_list[index]
    
    def get_assets_dir(self):
        return Path(f'{os.path.dirname(os.path.abspath(__file__))}/assets/')
    
    @serialized
    def propagate_map_data(self, scenario):
        self.ensure_editable(scenario['id'])
        previous = self.get_scenario(scenario['id'])
        renames = scenario['data_input'].get('map_data', {}).pop('_node_renames', {})
        if renames:
            old_nodes = previous['data_input'].get('map_data', {}).get('all_nodes', {})
            if any(old not in old_nodes or new in old_nodes or not isinstance(new, str) or not new.strip() for old, new in renames.items()) or len(set(renames.values())) != len(renames):
                raise HTTPException(400, detail='A renamed facility needs a unique, nonempty name.')
            previous['data_input'] = rename_map_nodes(previous['data_input'], renames)
            scenario['data_input'] = rename_map_nodes(scenario['data_input'], renames)
        data = PreprocessMapData(scenario['data_input'])
        data['_changed_pipe_fields'] = changed_pipe_fields(data, previous['data_input'].get('map_data'))
        excel_path = self.get_excelsheet_path(scenario['id'])
        with tempfile.TemporaryDirectory(dir=self.excelsheets_path) as directory:
            target = str(Path(directory) / 'map')
            # Rebuild from the canonical tables, never an older workbook revision.
            write_inputs(prune_removed_map_nodes(previous['data_input'], data), target + '.xlsx', template=excel_path)
            WriteMapDataToExcel(data, target, target + '.xlsx', previous_map_data=previous['data_input'].get('map_data'))
            data.pop('_changed_pipe_fields', None)
            scenario['data_input'] = read_inputs(target + '.xlsx', previous=scenario['data_input'], map_data=data)
        return self.save_inputs(scenario)


    def propagate_json_data(self, scenario):
        self.ensure_editable(scenario['id'])
        return self.save_inputs(scenario)

    def ensure_editable(self, id):
        if int(id) in self.background_tasks:
            raise HTTPException(409, detail='Wait for this optimization to finish before editing its inputs.')

    @serialized
    def save_inputs(self, scenario):
        self.ensure_editable(scenario['id'])
        sync_map_fields(scenario['data_input'])
        path = self.get_excelsheet_path(scenario['id'])
        with tempfile.TemporaryDirectory(dir=self.excelsheets_path) as directory:
            staged = Path(directory) / 'inputs.xlsx'
            write_inputs(scenario['data_input'], staged, template=path)
            scenario['data_input'] = read_inputs(staged, previous=scenario['data_input'])
            os.replace(staged, path)
        if scenario.get('results', {}).get('status') == 'Optimized':
            scenario['results']['status'] = 'Not Optimized'
        return self.update_scenario(scenario)

    @serialized
    def update_horizon(self, id, periods):
        self.ensure_editable(id)
        scenario = self.get_scenario(id)
        scenario['data_input'] = with_horizon(scenario['data_input'], periods)
        return self.save_inputs(scenario)

            

    @serialized
    def create_scenario_from_data_input_json(self, data_input, scenarioName = "New Scenario From Data Input"):
        new_id = self.next_id
        current_day = datetime.date.today()
        date = datetime.date.strftime(current_day, "%m/%d/%Y")
        return_object = {
            "name": scenarioName, 
            "id": new_id, 
            "date": date,
            "data_input": data_input, 
            "optimization": 
                {
                    "objective":"cost", 
                    "runtime": 900, 
                    "pipeline_cost": "distance_based", 
                    "waterQuality": "false", 
                    "hydraulics": "false",
                    "solver": "cbc",
                    "build_units": "scaled_units",
                    "optimalityGap": 0,
                    "scale_model": True
                }, 
            "results": {"status": "Draft", "data": {}},
            "override_values": 
                {
                    "vb_y_overview_dict": {},
                    "v_F_Piped_dict": {},
                    "v_F_Sourced_dict": {},
                    "v_F_Trucked_dict": {},
                    "v_L_Storage_dict": {},
                    "v_L_PadStorage_dict": {},
                    "vb_y_Pipeline_dict": {},
                    "vb_y_Disposal_dict": {},
                    "vb_y_Storage_dict": {},
                    "vb_y_Treatment_dict": {}
                }
            }

        # write data to excel

        excel_path = f"{self.excelsheets_path}/{new_id}"
        excel_data = {
            #  **data_input["df_sets"],
            # **data_input["df_parameters"],
        }
        excel_data["display_units"] = data_input["display_units"]
        for key in data_input["df_sets"]:
            if key in excel_data:
                _log.info(f"{key} is ALREADY IN data")
            val = data_input["df_sets"][key]
            excel_data[key] = val
            # _log.info(f"{key} :: {val}")
    
        for key in data_input["df_parameters"]:
            if key in excel_data:
                _log.info(f"{key} is ALREADY IN data")
            val = data_input["df_parameters"][key]
            excel_data[key] = val
            # _log.info(f"{key} :: {val}")
        _log.info(f"Writing JSON To Excel")
        pareto_excel_template = f"{os.path.dirname(os.path.abspath(__file__))}/assets/pareto_input_template.xlsx"
        WriteJSONToExcel(data=excel_data, output_file_name=excel_path, template_location=pareto_excel_template)


        # TODO: uncomment

        self._db.insert({'id_': new_id, "scenario": return_object, 'version': self.VERSION})

        self.update_next_id()
        self.retrieve_scenarios()
        
        return return_object
    
    def validate__pareto_scenario(self, id, solve=False):
        from app.internal.validation.scenario_validation import validate_inputs, check_model
        scenario = self.get_scenario(id)
        result = validate_inputs(scenario)
        if result['valid']:
            with tempfile.TemporaryDirectory(dir=self.excelsheets_path) as directory:
                path = Path(directory) / 'validation.xlsx'
                write_inputs(scenario['data_input'], path)
                result = check_model(scenario, path, result, solve=solve)
        return self._save_validation_results(scenario, result)

    
    @time_it
    def generate_data_with_ai(self, id, user_prompt, validation_findings=None):
        _log.info(f"generate_data_with_ai user prompt: {user_prompt}")
        try:

            scenario = self.scenario_list[id]
            data_input = scenario.get("data_input", None)
        except Exception as e:
            return {
                "error": "invalid scenario"
            }
        if not cborg.is_available():
            return {
                "error": "ai_unavailable",
                "detail": "AI client is not configured. Provide an API key to enable AI features."
            }
        if data_input:
            prompt = FormatPrompt(user_prompt=user_prompt, data=data_input, optimization_settings=scenario.get("optimization"), validation_findings=validation_findings)
            # _log.info(f"full prompt: {prompt}")
            _log.info(f"hitting cborg now")
            resp = cborg.prompt(prompt)
            _log.info(f"resp: {resp}")
            answer = self._parse_ai_json_response(resp)

            ## TODO: 
            ## 1) check if the prompt response was good (resp.status)
            ## 2) If ok, update scenario in DB
            ## 3) We must also update the map data (need function for this) and excel sheet
            ## 4) Optionally, we could display the updates to the user 

            ## sample prompt: Can you fill in completions demand with 10000 barrels in each time period

            status = answer.get("status")
            _log.info(f"ai response status: {status}")
            if status == "error":
                _log.info(f"error response from AI: {answer.get('errorMessage')}")
                return answer
            
            updatedScenario = answer.get("updatedScenario")
            notes = answer.get("updateNotes")
            if isinstance(notes, str):
                answer["updateNotes"] = [notes] if notes.strip() else []
            elif isinstance(notes, list):
                if all(isinstance(n, str) and n.strip() for n in notes):
                    answer["updateNotes"] = [n for n in notes if n.strip()]
                else:
                    _log.info(f"dropping malformed AI updateNotes: {notes!r}")
                    answer.pop("updateNotes", None)
            elif notes is not None:
                _log.info(f"dropping malformed AI updateNotes: {notes!r}")
                answer.pop("updateNotes", None)
            questions = answer.get("questions")
            if questions is not None:
                if isinstance(questions, list) and all(isinstance(q, str) and q.strip() for q in questions):
                    answer["questions"] = [q.strip() for q in questions]
                else:
                    _log.info(f"dropping malformed AI questions: {questions!r}")
                    answer.pop("questions", None)
            return answer
        else:
            return {
                "error": "unable to process request"
            }

    def _parse_ai_json_response(self, response_text):
        if isinstance(response_text, dict):
            return response_text

        response_text = response_text.strip()
        if response_text.startswith("```"):
            response_text = response_text.strip("`")
            if response_text.startswith("json"):
                response_text = response_text[4:]
            response_text = response_text.strip()

        return json.loads(response_text)

    def _utc_timestamp(self):
        return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")

    def _mark_diagnosis_outdated(self, diagnosis, reason="optimization_restarted"):
        if not isinstance(diagnosis, dict):
            return diagnosis

        updated = dict(diagnosis)
        updated["outdated"] = True
        updated["outdatedAt"] = self._utc_timestamp()
        updated["outdatedReason"] = reason
        return updated

    @time_it
    def generate_optimization_diagnosis_with_ai(self, id, error_message):
        _log.info(f"generate_optimization_diagnosis_with_ai for scenario {id}")
        try:
            scenario = self.scenario_list[id]
        except Exception:
            return {
                "status": "error",
                "errorMessage": "invalid scenario"
            }

        if not cborg.is_available():
            return {
                "status": "error",
                "errorMessage": "AI client is not configured. Provide an API key to enable AI features."
            }

        results = scenario.get("results") or {}
        failure_message = results.get("error") or error_message
        if not failure_message and (results.get("status") == "Infeasible" or results.get("terminationCondition") == "infeasible"):
            failure_message = "Optimization terminated as infeasible."
        if not failure_message:
            return {
                "status": "error",
                "errorMessage": "No optimization failure message was available to diagnose."
            }

        diagnosis_context = build_diagnosis_context(scenario)

        truncated_failure_message = summarize_long_text(
            failure_message,
            start_chars=6000,
            end_chars=4000,
        )

        prompt = FormatOptimizationDiagnosisPrompt(
            error_message=truncated_failure_message,
            diagnosis_context=json.dumps(diagnosis_context, default=str),
            optimization_settings=scenario.get("optimization"),
        )
        _log.info("hitting cborg for optimization diagnosis")

        try:
            resp = cborg.prompt(prompt)
            answer = self._parse_ai_json_response(resp)
        except Exception as e:
            _log.error(f"unable to parse diagnosis response: {e}")
            return {
                "status": "error",
                "errorMessage": f"Unable to process AI diagnosis response: {e}"
            }

        if not isinstance(answer, dict):
            return {"status": "error", "errorMessage": "AI returned an invalid diagnosis."}

        if answer.get("status") != "success":
            return {
                "status": "error",
                "errorMessage": str(answer.get("errorMessage") or "AI could not diagnose the optimization failure.")
            }

        if (
            not isinstance(answer.get("summary"), str)
            or not isinstance(answer.get("likelyCauses", []), list)
            or not all(isinstance(item, str) for item in answer.get("likelyCauses", []))
            or not isinstance(answer.get("cautionNotes", []), list)
            or not all(isinstance(item, str) for item in answer.get("cautionNotes", []))
            or not isinstance(answer.get("nextSteps"), list)
            or not all(isinstance(step, dict) and isinstance(step.get("title"), str)
                       and isinstance(step.get("instruction"), str)
                       and all(step.get(key) is None or isinstance(step[key], str) for key in ("reason", "appArea"))
                       for step in answer.get("nextSteps", []))
        ):
            return {"status": "error", "errorMessage": "AI returned an invalid diagnosis format. Please try again."}

        diagnosis_record = {
            "status": "success",
            "summary": answer.get("summary", ""),
            "likelyCauses": answer.get("likelyCauses", []),
            "nextSteps": answer.get("nextSteps", []),
            "cautionNotes": [*answer.get("cautionNotes", []), DIAGNOSTIC_LIMITATION],
            "diagnosedAt": self._utc_timestamp(),
            "sourceErrorMessage": failure_message,
            "outdated": False,
        }

        if isinstance(scenario.get("aiDiagnosis"), dict):
            scenario["previousAIDiagnosis"] = scenario.get("aiDiagnosis")
        scenario["aiDiagnosis"] = diagnosis_record
        self.update_scenario(scenario)

        return diagnosis_record


scenario_handler = ScenarioHandler()
