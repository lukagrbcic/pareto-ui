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
import io
import os
import tempfile
from copy import deepcopy
from uuid import uuid4
from pathlib import Path
import aiofiles
from fastapi import Body, Request, APIRouter, HTTPException, File, UploadFile, BackgroundTasks
from fastapi.responses import FileResponse

import logging
import idaes.logger as idaeslog

from app.internal.optimization.strategic_model import handle_run_strategic_model
from app.internal.scenario_handler import (
    scenario_handler,
)
from app.internal.maps.kml_parser import ParseKMZ
from app.internal.workbooks.excel_api import WriteMapDataToExcel, PreprocessMapData
from app.internal.maps.shapefile_parser import extract_shp_paths, parseShapefiles
from app.internal.util import time_it
from app.internal.util import prepare_config
from app.internal.scenarios.input_schema import input_revision
from app.internal.validation.scenario_validation import validate_inputs
from app.internal.ai.configuration import ai_configuration as cborg
from app.schemas.table_save import SavedTableScenario, UpdateExcelRequest

# _log = idaeslog.getLogger(__name__)
_log = logging.getLogger(__name__)

router = APIRouter(
    prefix="",
    tags=["scenarios"],
    responses={404: {"description": "Scenario not found"}},
)

@router.get("/get_project_name")
async def get_project_name():
    """
    Get project name.
    """
    return "pareto"

@router.get("/ai_available")
async def ai_available():
    """
    Return whether the AI functionality is configured and available.
    """
    return {
        "available": cborg.is_available()
    }

@router.get("/get_scenario_list")
async def get_scenario_list():
    """
    Get basic information about all saved scenarios.
    """
    scenarios = scenario_handler.get_list()
    return {'data' : scenarios}

@router.get("/get_scenario/{scenario_id}")
async def get_scenario(scenario_id: str):
    """
    Get basic information about all saved scenarios.
    """
    return scenario_handler.retrieve_scenario(scenario_id)

@router.get("/validate_scenario/{scenario_id}")
def validate_scenario(scenario_id: int):
    """
    Validate whether a scenario is ready to be optimized.
    """
    return scenario_handler.validate__pareto_scenario(scenario_id)

@router.get('/scenario_readiness/{scenario_id}')
def scenario_readiness(scenario_id: int):
    return validate_inputs(scenario_handler.get_scenario(scenario_id))

@router.post('/scenario_feasibility/{scenario_id}')
def scenario_feasibility(scenario_id: int):
    scenario_handler.ensure_editable(scenario_id)
    return scenario_handler.validate__pareto_scenario(scenario_id, solve=True)

@router.post('/planning_horizon/{scenario_id}')
def planning_horizon(scenario_id: int, payload: dict = Body(...)):
    with scenario_handler._db_lock:
        try:
            current = scenario_handler.get_scenario(scenario_id)
            if payload.get('revision') and payload['revision'] != current['input_revision']:
                raise HTTPException(409, detail='Inputs changed. Refresh before changing the planning horizon.')
            return scenario_handler.update_horizon(scenario_id, payload.get('periods'))
        except ValueError as error:
            raise HTTPException(400, detail=str(error)) from error


@router.post('/fill_scenario_inputs/{scenario_id}')
def fill_scenario_inputs(scenario_id: int, payload: dict = Body(...)):
    from app.internal.scenarios.fill import prepare_fill
    with scenario_handler._db_lock:
        scenario_handler.ensure_editable(scenario_id)
        current = scenario_handler.get_scenario(scenario_id)
        if payload.get('revision') != current['input_revision']:
            raise HTTPException(409, detail='Inputs changed. Refresh completion and preview the fill again.')
        try:
            updated, preview = prepare_fill(current, payload.get('section'), payload.get('value'))
            if payload.get('apply') is True:
                if not preview['cell_count']:
                    raise ValueError('There are no eligible cells to fill in this section.')
                return scenario_handler.save_inputs(updated)
            return preview
        except ValueError as error:
            raise HTTPException(400, detail=str(error)) from error


@router.post("/advance_to_optimization_setup/{scenario_id}")
async def advance_to_optimization_setup(scenario_id: int):
    """
    Mark a validated scenario as Draft so optimization setup can proceed.
    """
    with scenario_handler._db_lock:
        scenario_handler.ensure_editable(scenario_id)
        current = scenario_handler.get_scenario(scenario_id)
        validation = current.get('validation', {})
        if not validation.get('valid') or validation.get('model_check') != 'passed' or validation.get('revision') != current['input_revision']:
            raise HTTPException(409, detail='Validate the current inputs before advancing to optimization setup.')
        updated_scenario = scenario_handler.set_scenario_status(scenario_id, "Draft")
        return {"data": updated_scenario}


@router.post("/update")
async def update(request: Request):
    """Update a given scenario.

    Args:
        request.json()['updatedScenario']: Scenario to be updated

    Returns:
        Updated scenario
    """
    data = await request.json()
    with scenario_handler._db_lock:
        updated_scenario = data['updatedScenario']
        propagate_changes = data.get("propagateChanges")
        scenario_id = updated_scenario.get("id")
        # Zero is a valid persisted ID and needs the same edit/revision guards.
        if scenario_id is not None:
            scenario_handler.ensure_editable(scenario_id)
            current = scenario_handler.get_scenario(int(scenario_id))
            if updated_scenario.get('input_revision') and updated_scenario['input_revision'] != current['input_revision']:
                raise HTTPException(409, detail='Inputs changed in another request. Refresh the scenario before saving again.')
            updated_scenario['data_input'].setdefault('units', current['data_input']['units'])
            if propagate_changes == "map":
                _log.info(f"propagating map changes")
                scenario_handler.propagate_map_data(updated_scenario)
                scenario = scenario_handler.get_scenario(scenario_id)
                return {"data": scenario}
            elif propagate_changes == "json":
                _log.info(f"propagating JSON changes")
                scenario_handler.propagate_json_data(updated_scenario)
                scenario = scenario_handler.get_scenario(scenario_id)
                return {"data": scenario}
            if updated_scenario['data_input'] != current['data_input']:
                return {'data': scenario_handler.save_inputs(updated_scenario)}
        return {"data": scenario_handler.update_scenario(updated_scenario)}


@router.post("/upload/{scenario_name}")
async def upload(scenario_name: str, defaultNodeType: str, file: UploadFile = File(...)):
    """Upload an excel sheet or KMZ map file and create corresponding scenario.

    Args:
        file: excel sheet to be uploaded

    Returns:
        New scenario data
    """
    new_id = scenario_handler.get_next_id()
    file_extension = file.filename.split('.')[-1].lower()
    # check if file is excel or KMZ
    if file_extension == 'kmz' or file_extension == 'kml':
        _log.info("Creating scenario from kmz/kml")
        kmz_path = f"{scenario_handler.excelsheets_path}/{new_id}.{file_extension}"
        excel_path = f"{scenario_handler.excelsheets_path}/{new_id}"
        try:
            async with aiofiles.open(kmz_path, 'wb') as out_file:
                content = await file.read()
                await out_file.write(content) 
            kmz_data = PreprocessMapData({"map_data": ParseKMZ(kmz_path, defaultNodeType)})
            WriteMapDataToExcel(kmz_data, excel_path)
            kmz_data["defaultNode"] = defaultNodeType
            return scenario_handler.upload_excelsheet(output_path=f'{excel_path}.xlsx', scenarioName=scenario_name, filename=file.filename, map_data=kmz_data)
        except Exception as e:
            _log.error(f"error on file upload: {str(e)}")
            raise HTTPException(400, detail=f"File upload failed: {e}")
    elif file_extension == "zip":
        _log.info("Creating scenario from zip")
        zip_path = f"{scenario_handler.excelsheets_path}/{new_id}.{file_extension}"
        excel_path = f"{scenario_handler.excelsheets_path}/{new_id}"
        try:
            async with aiofiles.open(zip_path, 'wb') as out_file:
                content = await file.read()
                await out_file.write(content)
            shp_paths = extract_shp_paths(zip_path)
            map_data = parseShapefiles(shp_paths, defaultNodeType)
            map_data = PreprocessMapData({"map_data": map_data})
            WriteMapDataToExcel(map_data, excel_path)
            map_data["defaultNode"] = defaultNodeType
            return scenario_handler.upload_excelsheet(output_path=f'{excel_path}.xlsx', scenarioName=scenario_name, filename=file.filename, map_data=map_data)
        except Exception as e:
            _log.exception(f"Error on file upload")
            raise HTTPException(400, detail=f"File upload failed: {e}")
    elif file_extension == 'xlsx':
        output_path = f"{scenario_handler.excelsheets_path}/{new_id}.xlsx"
        try:
            async with aiofiles.open(output_path, 'wb') as out_file:
                content = await file.read()
                await out_file.write(content) 
            return scenario_handler.upload_excelsheet(output_path=output_path, scenarioName=scenario_name, filename=file.filename)

        except Exception as e:
            _log.error(f"error on file upload: {str(e)}")
            raise HTTPException(400, detail=f"File upload failed: {e}")
        

@router.post("/upload_additional_map/{scenario_id}")
async def upload_additional_map(scenario_id: int, defaultNodeType: str = "NetworkNode", file: UploadFile = File(...)):
    """Upload an excel sheet or KMZ map file and create corresponding scenario.

    Args:
        file: excel sheet to be uploaded

    Returns:
        New scenario data
    """
    file_extension = file.filename.split('.')[-1].lower()
    scenario = scenario_handler.get_scenario(scenario_id)
    excel_path = scenario_handler.get_excelsheet_path(scenario_id)
    scenario_handler.ensure_editable(scenario_id)
    initial_map_data = scenario.get("data_input", {}).get("map_data", None)

    # check if file is excel or KMZ
    if file_extension == 'kmz' or file_extension == 'kml':
        _log.info("upload_additional_map from kmz/kml")
        kmz_path = f"{scenario_handler.excelsheets_path}/{scenario_id}.{file_extension}"
        try:
            async with aiofiles.open(kmz_path, 'wb') as out_file:
                content = await file.read()
                await out_file.write(content) 
            map_data = ParseKMZ(kmz_path, defaultNodeType, initial_map_data=initial_map_data)
            scenario['data_input']['map_data'] = map_data
            return scenario_handler.propagate_map_data(scenario)
        except Exception as e:
            _log.error(f"error on file upload: {str(e)}")
            raise HTTPException(400, detail=f"File upload failed: {e}")
    elif file_extension == "zip":
        _log.info("upload_additional_map from zip")
        zip_path = f"{scenario_handler.excelsheets_path}/{scenario_id}.{file_extension}"
        try:
            async with aiofiles.open(zip_path, 'wb') as out_file:
                content = await file.read()
                await out_file.write(content)
            shp_paths = extract_shp_paths(zip_path)
            map_data = parseShapefiles(shp_paths, defaultNodeType, initial_map_data)
            map_data = PreprocessMapData({"map_data": map_data})
            scenario['data_input']['map_data'] = map_data
            return scenario_handler.propagate_map_data(scenario)
        except Exception as e:
            _log.exception(f"Error on file upload")
            raise HTTPException(400, detail=f"File upload failed: {e}")
    else:
        raise HTTPException(400, detail=f"Cannot process map for file type: {file_extension}")

        
@router.post("/replace/{scenario_id}")
async def replace_excel(scenario_id: int, file: UploadFile = File(...)):
    """Upload an excel sheet or KMZ map file and create corresponding scenario.

    Args:
        file: excel sheet to be uploaded

    Returns:
        New scenario data
    """
        
    scenario_handler.ensure_editable(scenario_id)
    try:
        with tempfile.TemporaryDirectory(dir=scenario_handler.excelsheets_path) as directory:
            output_path = str(Path(directory) / 'replacement.xlsx')
            async with aiofiles.open(output_path, 'wb') as out_file:
                await out_file.write(await file.read())
            return scenario_handler.replace_excelsheet(output_path=output_path, id=scenario_id)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(400, detail=f'File upload failed: {error}') from error

@router.post("/delete_scenario")
async def delete_scenario(request: Request):
    """Delete a given scenario.

    Args:
        request.json()['id']: id of scenario to be deleted

    Returns:
        List of remaining scenarios
    """
    data = await request.json()
    
    scenario_handler.delete_scenario(data['id'])

    return {'data' : scenario_handler.get_list()}
    
@router.post("/run_model")
async def run_model(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    with scenario_handler._db_lock:
        supplied = data['scenario']
        scenario_id = int(supplied['id'])
        scenario = scenario_handler.get_scenario(scenario_id)
        # A lost acknowledgement can be retried without launching a second solve.
        if data.get('run_id') and scenario.get('results', {}).get('run_id') == data['run_id']:
            return scenario
        scenario_handler.ensure_editable(scenario_id)
        if supplied.get('input_revision') and supplied['input_revision'] != scenario['input_revision']:
            raise HTTPException(409, detail='Inputs changed. Refresh the scenario before running optimization.')
        # Check current saved tables and capture settings while reserving the run.
        # Workbook I/O and model construction belong to the synchronous background
        # worker, which Starlette runs in its thread pool after sending the response.
        scenario['optimization'] = supplied.get('optimization', scenario['optimization'])
        scenario['override_values'] = supplied.get('override_values', scenario.get('override_values', {}))
        validation = validate_inputs(scenario)
        scenario['validation'] = validation
        scenario = scenario_handler.update_scenario(scenario)
        if not validation.get('valid'):
            raise HTTPException(422, detail={'message': 'Review the scenario inputs before optimization.', 'validation': validation})
        model_parameters = prepare_config(scenario, 'modelParameters')
        snapshot = deepcopy(scenario['data_input'])
        overrides = deepcopy(scenario.get('override_values', {}))
        scenario_handler.add_background_task(scenario_id)
        try:
            if scenario.get('aiDiagnosis'):
                scenario['previousAIDiagnosis'] = scenario_handler._mark_diagnosis_outdated(scenario['aiDiagnosis'])
                scenario.pop('aiDiagnosis', None)
            scenario['results'] = {'data': {}, 'status': 'Preparing inputs',
                'input_revision': input_revision(scenario), 'run_id': data.get('run_id') or uuid4().hex}
            scenario = scenario_handler.update_scenario(scenario)
            background_tasks.add_task(handle_run_strategic_model, input_file=None, input_data=snapshot,
                output_file=scenario_handler.get_excel_output_path(scenario_id), id=scenario_id,
                modelParameters=model_parameters, overrideValues=overrides)
            return scenario
        except Exception:
            scenario_handler.remove_background_task(scenario_id)
            raise


@router.get("/check_tasks")
async def check_tasks():
    """Get list of currently running background tasks

    Returns:
        List of scenario ids that are currently being optimized. 
    """
    return {'tasks' : scenario_handler.get_background_tasks()}

@router.get("/copy/{scenario_id}/{new_scenario_name}")
async def copy(scenario_id: int, new_scenario_name: str):
    """Create a copy of scenario for given scenario id

    Args:
        scenario_id: scenario id for given completions demand plot

    Returns:
        Newly created scenario. 
    """
    scenarios, new_id = scenario_handler.copy_scenario(scenario_id, new_scenario_name)
    return {"scenarios": scenarios, "new_id": new_id}

@router.post("/update_excel", response_model=SavedTableScenario, response_model_exclude_unset=True)
async def update_excel(data: UpdateExcelRequest):
    """Check the table before any writes and return the saved scenario.

    FastAPI validates/serializes the response once. Excluding unset defaults
    preserves omitted legacy fields; PayloadModel also retains extra metadata.
    """
    with scenario_handler._db_lock:
        try:
            current = scenario_handler.get_scenario(data.id)
            if data.revision and data.revision != current['input_revision']:
                raise HTTPException(409, detail='Inputs changed. Reload the saved scenario before saving this table.')
            saved = scenario_handler.update_excel(data.id, data.tableKey, data.updatedTable)
            if not isinstance(saved, dict) or saved.get('id') != data.id:
                raise HTTPException(500, detail='Saved table response could not be verified. Reload the scenario before saving again.')
            return saved
        except HTTPException:
            raise
        except Exception as e:
            _log.exception('Unable to save input table for scenario %s', data.id)
            raise HTTPException(
                500, detail='Unable to save the input table. Reload the scenario before saving again.'
            ) from e


@router.get("/get_diagram/{diagram_type}/{id}")
async def get_diagram(diagram_type: str, id: int):
    """Fetch network diagram

    Args:
        id: scenario id
        diagram_type: input or output

    Returns:
        Network diagram
    """
    data = scenario_handler.get_diagram(diagram_type, id)
    return {"data":data}
    # return StreamingResponse(io.BytesIO(data), media_type=f"image/{diagramFileType}")

@router.get("/get_template/{id}")
async def get_template(id: int):
    """Fetch excel template

    Args:
        id: scenario id

    Returns:
        Path to excel template
    """
    path = scenario_handler.get_excelsheet_path(id)
    return FileResponse(path)

@router.post("/upload_diagram/{diagram_type}/{id}")
async def upload_diagram(diagram_type: str, id: int, file: UploadFile = File(...)):
    """Upload a network diagram.

    Args:
        file: diagram to be uploaded

    Returns:
        New scenario data
    """
    diagram_extension = file.filename.split('.')[-1]
    if diagram_type == "input":
        output_path = f"{scenario_handler.input_diagrams_path}/{id}.{diagram_extension}"
    elif diagram_type == "output":
        output_path = f"{scenario_handler.output_diagrams_path}/{id}.{diagram_extension}"
    try:
        async with aiofiles.open(output_path, 'wb') as out_file:
            content = await file.read()
            await out_file.write(content) 
        return scenario_handler.upload_diagram(output_path=output_path, id=id, diagram_type=diagram_type)

    except Exception as e:
        _log.error(f"error on file upload: {str(e)}")
        raise HTTPException(400, detail=f"File upload failed: {e}")

@router.get("/delete_diagram/{diagram_type}/{id}")
async def delete_diagram(diagram_type: str, id: int):
    """Delete network diagram

    Args:
        id: scenario id

    Returns:
        Scenario
    """
    data = scenario_handler.delete_diagram(diagram_type, id)
    return {"data":data}

@router.get("/get_excel_file/{filename}")
async def get_excel_file(filename: str):
    """Fetch excel input file

    Args:
        filename: name of excel file

    Returns:
        Excel file
    """
    assets_path = scenario_handler.get_assets_dir()
    excel_path = assets_path / filename
    return FileResponse(excel_path)



@router.get("/generate_excel_from_map/{id}")
async def generate_excel_from_map(id: int):
    """Generate excel spreadsheet from map data

    Args:
        id: scenario id

    Returns:
        Excel file
    """
    scenario = scenario_handler.get_scenario(id)
    excel_path = scenario_handler.get_excelsheet_path(id)
    return FileResponse(excel_path)


@router.get("/generate_report/{id}")
async def generate_report(id: str):
    """Generate output report

    Args:
        id: scenario id

    Returns:
        Excel file
    """
    path = scenario_handler.get_excel_output_path(id)
    return FileResponse(path)


@router.post("/request_ai_data_update/{id}")
async def request_ai_data_update(request: Request, id: int) -> dict:
    """Prompt AI to fill out data.
    TODO: 
        - In the future, we should add authentication to this endpoint.
        - We could even host this endpoint on a server somewhere else that
            is locked down.
        - User would have to provide their own API key.
        - We can also allow for choice of model, model base_url, etc.

    Args:
        id: scenario id
        request.prompt: Prompt to provide to AI.

    Returns:
        Updated scenario
    """
    req = await request.json()
    prompt = req.get("prompt", None)
    # Optional validation evidence from the UI ("Fix with AI" or the last
    # validation run); embedded into the prompt so the fill targets real issues.
    validation_findings = req.get("validation_findings", None)
    if validation_findings is not None and not isinstance(validation_findings, (list, dict)):
        raise HTTPException(400, detail="validation_findings must be a list or object.")
    if prompt:
        updatedScenario = scenario_handler.generate_data_with_ai(id, prompt, validation_findings)
    else:
        raise HTTPException(400, detail=f"Please provide a prompt.")
    return updatedScenario

@router.post("/request_ai_optimization_diagnosis/{id}")
async def request_ai_optimization_diagnosis(request: Request, id: int) -> dict:
    """Prompt AI to diagnose a failed optimization run using scenario context."""
    req = await request.json()
    error_message = req.get("errorMessage", None)
    if error_message is not None and not isinstance(error_message, str):
        raise HTTPException(400, detail="errorMessage must be a string.")
    return scenario_handler.generate_optimization_diagnosis_with_ai(id, error_message)
