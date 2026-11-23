import importlib
import inspect
import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch


class AIChatBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        previous_cwd = os.getcwd()
        with patch.dict(
            os.environ,
            {'PARETO_DATA_BASEDIR': cls.temp.name, 'PARETO_LOG_DIR': cls.temp.name},
        ):
            cls.handler_module = importlib.import_module('app.internal.scenario_handler')
            cls.util_module = importlib.import_module('app.internal.util')
        os.chdir(previous_cwd)

    @classmethod
    def tearDownClass(cls):
        cls.handler_module.scenario_handler._db.close()
        import logging
        for handler in list(logging.getLogger().handlers):
            if getattr(handler, 'baseFilename', '').startswith(cls.temp.name):
                logging.getLogger().removeHandler(handler)
                handler.close()
        cls.temp.cleanup()

    def _make_handler(self):
        handler = self.handler_module.ScenarioHandler.__new__(self.handler_module.ScenarioHandler)
        handler.scenario_list = {
            1: {
                'id': 1,
                'optimization': {},
                'data_input': {
                    'df_sets': {'ProductionPads': ['P1'], 'TimePeriods': ['T01', 'T02']},
                    'df_parameters': {
                        'PadRates': {'ProductionPads': ['P1'], 'T01': [100], 'T02': [120]},
                    },
                },
            }
        }
        return handler

    def test_conversational_review_reply_without_scenario_mutations_succeeds(self):
        handler = self._make_handler()
        ai = Mock()
        ai.is_available.return_value = True
        ai.prompt.return_value = json.dumps(
            {
                'status': 'success',
                'reply': 'Production forecasts look consistent across T01 and T02.',
                'updateNotes': ['Checked PadRates for P1.'],
            }
        )
        with patch.object(self.handler_module, 'cborg', ai):
            result = handler.generate_data_with_ai(
                1,
                'Review my scenario',
                validation_findings={'valid': True, 'error_count': 0, 'state': 'model_built'},
            )
        self.assertEqual(result['status'], 'success')
        self.assertEqual(
            result['reply'],
            'Production forecasts look consistent across T01 and T02.',
        )
        self.assertNotIn('updatedScenario', result)
        sent_prompt = ai.prompt.call_args.args[0]
        self.assertIn('no blocking errors were found', sent_prompt)

    def test_multi_turn_history_and_staged_updates_are_embedded_in_working_prompt(self):
        handler = self._make_handler()
        ai = Mock()
        ai.is_available.return_value = True
        ai.prompt.return_value = json.dumps(
            {
                'status': 'success',
                'reply': 'Updated T02 to 600 as well.',
                'updatedScenario': {
                    'df_parameters': {
                        'PadRates': {'ProductionPads': ['P1'], 'T01': [500], 'T02': [600]},
                    }
                },
            }
        )
        history = [
            {'role': 'user', 'content': 'Set T01 to 500'},
            {'role': 'assistant', 'content': 'Set P1 T01 to 500.'},
        ]
        staged = {
            'df_parameters': {
                'PadRates': {'ProductionPads': ['P1'], 'T01': [500], 'T02': [120]},
            }
        }
        with patch.object(self.handler_module, 'cborg', ai):
            result = handler.generate_data_with_ai(
                1,
                'Now set T02 to 600 too',
                conversation_history=history,
                staged_updates=staged,
            )
        self.assertEqual(result['status'], 'success')
        self.assertEqual(
            result['updatedScenario']['df_parameters']['PadRates']['T01'],
            [500],
        )
        self.assertEqual(
            result['updatedScenario']['df_parameters']['PadRates']['T02'],
            [600],
        )
        sent_prompt = ai.prompt.call_args.args[0]
        self.assertIn('Previous conversation in this scenario session:', sent_prompt)
        self.assertIn('User: Set T01 to 500', sent_prompt)
        self.assertIn("'T01': [500]", sent_prompt)
        # Saved baseline must remain untouched until user explicitly applies.
        self.assertEqual(
            handler.scenario_list[1]['data_input']['df_parameters']['PadRates']['T01'],
            [100],
        )

    def test_partial_table_patch_does_not_snapshot_untouched_tables_or_emit_false_guard_warning(self):
        handler = self._make_handler()
        handler.scenario_list[1]['data_input']['df_parameters']['FlowbackRates'] = {
            'CompletionsPads': ['C1'],
            'T01': [10],
            'T02': [20],
        }
        handler.scenario_list[1]['data_input']['df_parameters']['CompletionsDemand'] = {
            'CompletionsPads': ['C1'],
            'T01': [50],
            'T02': [60],
        }
        ai = Mock()
        ai.is_available.return_value = True
        ai.prompt.return_value = json.dumps(
            {
                'status': 'success',
                'reply': 'Updated PadRates T01 to 350.',
                'updatedScenario': {
                    'df_parameters': {
                        'PadRates': {'ProductionPads': ['P1'], 'T01': [350], 'T02': [120]},
                    }
                },
            }
        )
        with patch.object(self.handler_module, 'cborg', ai):
            result = handler.generate_data_with_ai(1, 'Set PadRates T01 to 350')
        self.assertEqual(result['status'], 'success')
        self.assertEqual(list(result['updatedScenario']['df_parameters'].keys()), ['PadRates'])
        notes = result.get('updateNotes') or []
        self.assertFalse(any('dropped' in n for n in notes), notes)

    def test_omitted_columns_in_changed_table_are_restored_with_guard_note(self):
        handler = self._make_handler()
        ai = Mock()
        ai.is_available.return_value = True
        ai.prompt.return_value = json.dumps(
            {
                'status': 'success',
                'reply': 'Updated T01 to 400.',
                'updatedScenario': {
                    'df_parameters': {
                        'PadRates': {'ProductionPads': ['P1'], 'T01': [400]},
                    }
                },
            }
        )
        with patch.object(self.handler_module, 'cborg', ai):
            result = handler.generate_data_with_ai(1, 'Set T01 to 400')
        self.assertEqual(result['status'], 'success')
        self.assertEqual(
            result['updatedScenario']['df_parameters']['PadRates'],
            {'ProductionPads': ['P1'], 'T01': [400], 'T02': [120]},
        )
        self.assertTrue(
            any('restored omitted column' in n for n in (result.get('updateNotes') or [])),
            result.get('updateNotes'),
        )

    def test_ai_routes_are_sync_for_worker_threadpool_execution(self):
        routers_module = importlib.import_module('app.routers.scenarios')
        self.assertFalse(inspect.iscoroutinefunction(routers_module.request_ai_data_update))
        self.assertFalse(inspect.iscoroutinefunction(routers_module.request_ai_optimization_diagnosis))

    def test_response_parsing_normalization_and_error_handling(self):
        handler = self._make_handler()
        ai = Mock()
        ai.is_available.return_value = True

        # Prose-wrapped fenced JSON missing explicit status should normalize to success
        ai.prompt.return_value = (
            'Here is the review:\n```json\n'
            '{"reply": "Inputs look ready.", "questions": []}\n'
            '```\nLet me know if you want changes.'
        )
        with patch.object(self.handler_module, 'cborg', ai):
            res = handler.generate_data_with_ai(1, 'Review')
        self.assertEqual(res, {'status': 'success', 'reply': 'Inputs look ready.'})

        # status='error' with missing errorMessage still returns a non-empty errorMessage
        ai.prompt.return_value = json.dumps({'status': 'error', 'questions': ['Which pad?']})
        with patch.object(self.handler_module, 'cborg', ai):
            err_res = handler.generate_data_with_ai(1, 'Update')
        self.assertEqual(err_res['status'], 'error')
        self.assertTrue(err_res['errorMessage'].strip())
        self.assertEqual(err_res['questions'], ['Which pad?'])

        # RuntimeError or unparseable text returns status='error' instead of raising 500
        ai.prompt.side_effect = RuntimeError('Provider timed out')
        with patch.object(self.handler_module, 'cborg', ai):
            rt_err = handler.generate_data_with_ai(1, 'Update')
        self.assertEqual(rt_err, {'status': 'error', 'errorMessage': 'Provider timed out'})

        ai.prompt.side_effect = None
        ai.prompt.return_value = 'Sorry, I could not format JSON'
        with patch.object(self.handler_module, 'cborg', ai):
            parse_err = handler.generate_data_with_ai(1, 'Update')
        self.assertEqual(parse_err['status'], 'error')
        self.assertIn('valid JSON', parse_err['errorMessage'])

    def test_sanitize_ai_updated_scenario_aligns_reordered_rows_and_drops_bad_cells_or_readonly_sections(self):
        original = {
            'df_sets': {'ProductionPads': ['P1', 'P2'], 'TimePeriods': ['T01', 'T02']},
            'df_parameters': {
                'PadRates': {'ProductionPads': ['P1', 'P2'], 'T01': [100, 200], 'T02': [150, 250]},
            },
            'units': {'volume': 'bbl'},
            'map_data': {'all_nodes': {'P1': {'node_type': 'ProductionPad'}}},
        }
        # Reordered rows with omitted T02 column should align T02 by key, not position
        reordered = {
            'df_parameters': {
                'PadRates': {'ProductionPads': ['P2', 'P1'], 'T01': [220, 110]},
                'BadBoolTable': {'ProductionPads': ['P1', 'P2'], 'VALUE': [True, 10]},
            },
            'df_sets': {'ProductionPads': [123, 'P2']},
            'map_data': {'all_nodes': {}},
            'units': {'volume': 'gal'},
        }
        cleaned, notes = self.handler_module.sanitize_ai_updated_scenario(original, reordered)
        self.assertIsNotNone(cleaned)
        self.assertEqual(
            cleaned['df_parameters']['PadRates'],
            {'ProductionPads': ['P2', 'P1'], 'T01': [220, 110], 'T02': [250, 150]},
        )
        self.assertNotIn('BadBoolTable', cleaned['df_parameters'])
        self.assertNotIn('df_sets', cleaned)
        self.assertNotIn('map_data', cleaned)
        self.assertNotIn('units', cleaned)
        self.assertTrue(any('BadBoolTable' in n for n in notes))

        # Duplicate/mismatched keys in omitted-column table should be rejected rather than scrambled
        mismatched = {
            'df_parameters': {
                'PadRates': {'ProductionPads': ['P1', 'P1'], 'T01': [110, 220]},
            }
        }
        cleaned_bad, notes_bad = self.handler_module.sanitize_ai_updated_scenario(original, mismatched)
        self.assertIsNone(cleaned_bad)
        self.assertTrue(any('PadRates' in n for n in notes_bad))


if __name__ == '__main__':
    unittest.main()
