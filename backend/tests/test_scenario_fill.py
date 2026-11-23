from copy import deepcopy
import tempfile
import unittest

from scenario_fixtures import simple_scenario
from app.internal.scenarios.input_schema import flat_table, with_horizon
from app.internal.scenarios.fill import apply_cell_edits, prepare_fill
from app.internal.scenarios.inputs import read_inputs, write_inputs
from app.internal.validation.scenario_validation import validate_inputs


class ScenarioFillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.example, cls.path = simple_scenario(cls.temp.name)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_scalar_matrix_and_three_index_cells_fill_without_overwriting_valid_values(self):
        scenario = deepcopy(self.example)
        scenario['optimization']['pipeline_cost'] = 'capacity_based'
        tables = scenario['data_input']['df_parameters']
        tables['DisposalOperationalCost']['VALUE'] = ['']
        tables['PipelineExpansionDistance']['N1'][0] = -5
        tables['PipelineCapexCapacityBased'] = {}
        original = deepcopy(scenario)
        updated, preview = prepare_fill(scenario, 'costs', 0)
        self.assertEqual(scenario, original)
        filled = updated['data_input']['df_parameters']
        self.assertEqual(flat_table(filled['DisposalOperationalCost'])[('K1',)], 0)
        self.assertEqual(flat_table(filled['PipelineExpansionDistance'])[('P1', 'N1')], 0)
        self.assertEqual(flat_table(filled['PipelineExpansionDistance'])[('N1', 'K1')], 1)
        self.assertEqual(flat_table(filled['PipelineCapexCapacityBased'])[('P1', 'N1', 'D0')], 0)
        self.assertEqual(filled['PadRates'], tables['PadRates'])
        self.assertEqual(sum(t['cell_count'] for t in preview['tables']), preview['cell_count'])
        write_inputs(updated['data_input'], self.path)
        self.assertEqual(read_inputs(self.path)['df_parameters']['PipelineCapexCapacityBased'], filled['PipelineCapexCapacityBased'])

    def test_all_cells_and_table_highlights_are_counted_past_the_display_limit(self):
        scenario = deepcopy(self.example)
        scenario['data_input'] = with_horizon(scenario['data_input'], [f'T{i:03}' for i in range(300)])
        scenario['data_input']['df_parameters']['DisposalOperationalCost']['VALUE'] = ['']
        readiness = validate_inputs(scenario)
        self.assertTrue(readiness['truncated'])
        self.assertIn('DisposalOperationalCost', readiness['tables_with_issues'])
        filled, preview = prepare_fill(scenario, 'forecasts', 100)
        self.assertEqual(preview['cell_count'], 300)
        self.assertEqual(set(flat_table(filled['data_input']['df_parameters']['PadRates']).values()), {100})
        self.assertFalse(any(i['table'] == 'PadRates' for i in validate_inputs(filled)['issues']))

    def test_reuse_special_bound_and_missing_forecast_rows(self):
        scenario = deepcopy(self.example)
        data = scenario['data_input']
        data['df_sets']['ReuseOptions'] = ['O1']
        data['df_parameters']['ReuseMinimum'] = {'ReuseOptions': ['O1'], 'T01': [0], 'T02': [0]}
        data['df_parameters']['ReuseCapacity'] = {'ReuseOptions': ['O1'], 'T01': [-0.5], 'T02': ['']}
        with self.assertRaisesRegex(ValueError, 'nonnegative, or -1'):
            prepare_fill(scenario, 'forecasts', -0.5)
        filled, preview = prepare_fill(scenario, 'forecasts', -1)
        self.assertEqual(preview['cell_count'], 2)
        self.assertEqual(set(flat_table(filled['data_input']['df_parameters']['ReuseCapacity']).values()), {-1})
        data['df_parameters']['ReuseCapacity'] = {}
        filled, _ = prepare_fill(scenario, 'forecasts', 0)
        self.assertEqual(flat_table(filled['data_input']['df_parameters']['ReuseCapacity']), {('O1', 'T01'): 0, ('O1', 'T02'): 0})

    def test_invalid_numbers_and_structural_issues_are_not_blindly_overwritten(self):
        for value in ('', 'NaN', 'inf', True, -10):
            with self.subTest(value=value), self.assertRaises(ValueError):
                prepare_fill(self.example, 'capacity', value)
        scenario = deepcopy(self.example)
        scenario['data_input']['df_parameters']['DisposalOperationalCost'] = {'SWDSites': ['K1', 'K1'], 'VALUE': ['', '']}
        with self.assertRaisesRegex(ValueError, 'duplicate rows'):
            prepare_fill(scenario, 'costs', 1)
        scenario = deepcopy(self.example)
        scenario['data_input']['df_parameters']['NKA'] = {}
        filled, preview = prepare_fill(scenario, 'network', 1)
        self.assertEqual(preview['cell_count'], 0)
        self.assertEqual(filled, scenario)

    def test_storage_initial_level_can_be_filled_when_the_old_template_omits_it(self):
        scenario = deepcopy(self.example)
        data = scenario['data_input']
        data['df_sets']['StorageSites'] = ['S1']
        data['df_parameters']['InitialStorageCapacity'] = {'StorageSites': ['S1'], 'VALUE': [10000]}
        filled, _ = prepare_fill(scenario, 'capacity', 0)
        table = filled['data_input']['df_parameters']['InitialStorageLevel']
        self.assertEqual(table, {'StorageSites': ['S1'], 'VALUE': [0]})
        write_inputs(filled['data_input'], self.path)
        self.assertEqual(read_inputs(self.path)['df_parameters']['InitialStorageLevel'], table)

    def test_apply_cell_edits_saves_distinct_inline_values_across_tables_and_checks_bounds(self):
        scenario = deepcopy(self.example)
        data = scenario['data_input']
        data['df_sets']['CompletionsPads'] = ['CP01']
        data['df_parameters']['FlowbackRates'] = {}
        data['df_parameters']['CompletionsDemand'] = {'CompletionsPads': ['CP01'], 'T01': [50], 'T02': [50]}
        data['df_parameters']['Economics'] = {}

        updated = apply_cell_edits(scenario, [
            {'table': 'FlowbackRates', 'keys': ['CP01', 'T01'], 'value': 0},
            {'table': 'FlowbackRates', 'keys': ['CP01', 'T02'], 'value': 250.5},
            {'table': 'Economics', 'keys': ['discount_rate'], 'value': 0.05},
        ])
        params = updated['data_input']['df_parameters']
        self.assertEqual(flat_table(params['FlowbackRates']), {('CP01', 'T01'): 0, ('CP01', 'T02'): 250.5})
        self.assertEqual(flat_table(params['Economics'])[('discount_rate',)], 0.05)

        with self.assertRaisesRegex(ValueError, 'at least 0'):
            apply_cell_edits(scenario, [{'table': 'FlowbackRates', 'keys': ['CP01', 'T01'], 'value': -5}])

        with self.assertRaisesRegex(ValueError, 'between 0 and 1'):
            apply_cell_edits(scenario, [{'table': 'DisposalOperatingCapacity', 'keys': ['K1', 'T01'], 'value': 1.5}])

    def test_apply_cell_edits_and_prepare_fill_handle_empty_multi_index_matrix_stubs(self):
        scenario = deepcopy(self.example)
        scenario['optimization']['pipeline_cost'] = 'capacity_based'
        data = scenario['data_input']
        data['df_sets']['PipelineDiameters'] = ['D04', 'D08']
        # Empty matrix stubs emitted by reader / template
        data['df_parameters']['PipelineCapexCapacityBased'] = {'NODES': [], 'NODES.1': []}
        data['df_parameters']['InitialPipelineCapacity'] = {'NODES': []}

        updated = apply_cell_edits(scenario, [
            {'table': 'PipelineCapexCapacityBased', 'keys': ['P1', 'N1', 'D04'], 'value': 12000},
            {'table': 'PipelineCapexCapacityBased', 'keys': ['P1', 'N1', 'D08'], 'value': 18000},
            {'table': 'InitialPipelineCapacity', 'keys': ['P1', 'N1'], 'value': 500},
        ])
        params = updated['data_input']['df_parameters']
        self.assertEqual(
            flat_table(params['PipelineCapexCapacityBased']),
            {('P1', 'N1', 'D04'): 12000, ('P1', 'N1', 'D08'): 18000},
        )
        self.assertEqual(flat_table(params['InitialPipelineCapacity']), {('P1', 'N1'): 500})

        write_inputs(updated['data_input'], self.path)
        reloaded = read_inputs(self.path, previous=updated['data_input'])
        self.assertEqual(
            flat_table(reloaded['df_parameters']['PipelineCapexCapacityBased']),
            {('P1', 'N1', 'D04'): 12000, ('P1', 'N1', 'D08'): 18000},
        )

        # prepare_fill also succeeds starting from {'NODES': [], 'NODES.1': []}
        stub_scenario = deepcopy(self.example)
        stub_scenario['optimization']['pipeline_cost'] = 'capacity_based'
        stub_scenario['data_input']['df_sets']['PipelineDiameters'] = ['D04']
        stub_scenario['data_input']['df_parameters']['PipelineCapexCapacityBased'] = {'NODES': [], 'NODES.1': []}
        filled, _ = prepare_fill(stub_scenario, 'costs', 100)
        self.assertEqual(
            flat_table(filled['data_input']['df_parameters']['PipelineCapexCapacityBased'])[('P1', 'N1', 'D04')],
            100,
        )

    def test_save_inputs_cleanly_reverts_newly_created_table_on_disk(self):
        import os
        import importlib
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as db_dir:
            prev_cwd = os.getcwd()
            with patch.dict(os.environ, {'PARETO_DATA_BASEDIR': db_dir, 'PARETO_LOG_DIR': db_dir}):
                handler_mod = importlib.import_module('app.internal.scenario_handler')
                handler = handler_mod.ScenarioHandler()
            os.chdir(prev_cwd)
            try:
                scenario = deepcopy(self.example)
                scenario['id'] = 1
                scenario['data_input']['df_sets']['StorageSites'] = ['S1']
                scenario['data_input']['df_parameters'].pop('InitialStorageLevel', None)
                excel_path = handler.get_excelsheet_path(1)
                write_inputs(scenario['data_input'], excel_path)
                handler._persist_scenario(scenario)
                before = handler.get_scenario(1)
                self.assertNotIn('InitialStorageLevel', before['data_input']['df_parameters'])

                after = deepcopy(before)
                after['data_input']['df_parameters']['InitialStorageLevel'] = {
                    'StorageSites': ['S1'],
                    'VALUE': [500],
                }
                saved_after = handler.save_inputs(after)
                self.assertEqual(
                    saved_after['data_input']['df_parameters']['InitialStorageLevel'],
                    {'StorageSites': ['S1'], 'VALUE': [500]},
                )

                # Reverting to the prior data_input snapshot clears InitialStorageLevel on disk & DB
                reverted = deepcopy(saved_after)
                reverted['data_input'] = deepcopy(before['data_input'])
                saved_reverted = handler.save_inputs(reverted)
                self.assertNotIn('InitialStorageLevel', saved_reverted['data_input']['df_parameters'])
                reloaded_disk = read_inputs(excel_path)
                self.assertEqual(flat_table(reloaded_disk['df_parameters'].get('InitialStorageLevel', {})), {})
            finally:
                handler._db.close()
