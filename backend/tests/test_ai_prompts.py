import json
import unittest
from unittest import mock

from app.internal import scenario_handler as handler_module
from app.internal.scenario_handler import sanitize_ai_updated_scenario
from app.internal.util import FormatPrompt


class FormatPromptContractTests(unittest.TestCase):
    def test_prompt_contains_response_contract(self):
        prompt = FormatPrompt("fill completions demand", data={"df_parameters": {"PadRates": {}}},
                              optimization_settings={})
        for expected in ("'updatedScenario'", "'questions'", "'updateNotes'", "'status'",
                         "one note per distinct change", "'questions', not in updateNotes",
                         "Here is the prompt:", "fill completions demand", "PadRates"):
            self.assertIn(expected, prompt)

    def test_prompt_includes_validation_findings(self):
        findings = [{"code": "missing_value", "table": "PadRates", "row": ["Pad1"], "severity": "error"}]
        prompt = FormatPrompt("fix the issues", data={"df_parameters": {}},
                              optimization_settings={}, validation_findings=findings)
        self.assertIn("validation findings", prompt)
        self.assertIn("PadRates", prompt)
        self.assertIn("Prioritize resolving these", prompt)

    def test_prompt_without_findings_omits_block(self):
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}}, optimization_settings={})
        self.assertNotIn("validation findings", prompt)

    def test_prompt_includes_units_and_defaults(self):
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}}, optimization_settings={})
        self.assertIn("Units and defaults", prompt)
        self.assertIn("bbl", prompt)
        self.assertIn("not zeros", prompt)

    def test_prompt_includes_model_requirements_from_settings(self):
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
                              optimization_settings={"waterQuality": "true", "solver": "cbc"})
        self.assertIn("Model requirements", prompt)
        self.assertIn("water_quality", prompt)
        self.assertIn("Enabled features: water_quality", prompt)

    def test_prompt_without_settings_omits_model_requirements(self):
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}})
        self.assertNotIn("Model requirements", prompt)

    def test_multi_valued_feature_settings_are_parsed_like_the_app(self):
        # "post_process" runs the model without those input tables; "discrete"
        # and "co_optimize" build them into the optimization.
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
                              optimization_settings={"waterQuality": "post_process"})
        self.assertNotIn("Enabled features: water_quality", prompt)
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
                              optimization_settings={"waterQuality": "discrete"})
        self.assertIn("Enabled features: water_quality", prompt)
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
                              optimization_settings={"hydraulics": "co_optimize"})
        self.assertIn("Enabled features: hydraulics", prompt)
        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
                              optimization_settings={"hydraulics": "post_process"})
        self.assertNotIn("Enabled features: hydraulics", prompt)


class GenerateDataWithAIQuestionTests(unittest.TestCase):
    def setUp(self):
        self.scenario_id = 987654
        handler_module.scenario_handler.scenario_list[self.scenario_id] = {
            "id": self.scenario_id,
            "name": "question test",
            "optimization": {},
            "data_input": {"df_sets": {}, "df_parameters": {"PadRates": {"T01": [1]}}},
        }
        self.addCleanup(handler_module.scenario_handler.scenario_list.pop, self.scenario_id, None)

    def _run(self, model_answer):
        with mock.patch.object(handler_module.cborg, "is_available", return_value=True), \
             mock.patch.object(handler_module.cborg, "clear_history") as clear_mock, \
             mock.patch.object(handler_module.cborg, "prompt",
                               return_value=json.dumps(model_answer)) as prompt_mock:
            result = handler_module.scenario_handler.generate_data_with_ai(self.scenario_id, "fill demand")
        clear_mock.assert_called_once()
        self.assertEqual(prompt_mock.call_args.kwargs.get("add_to_history"), False)
        return result

    def test_valid_questions_pass_through(self):
        answer = self._run({"status": "success", "updatedScenario": {"df_parameters": {"PadRates": {"T01": [2]}}},
                            "questions": ["Which unit should demand use?"], "updateNotes": ["updated"]})
        self.assertEqual(answer["questions"], ["Which unit should demand use?"])
        self.assertEqual(answer["updatedScenario"]["df_parameters"]["PadRates"], {"T01": [2]})

    def test_malformed_questions_are_dropped(self):
        answer = self._run({"status": "success", "updatedScenario": {"df_parameters": {}},
                            "questions": "which unit?", "updateNotes": []})
        self.assertNotIn("questions", answer)

    def test_questions_survive_markdown_fences(self):
        fenced = "```json\n" + json.dumps({"status": "success", "updatedScenario": {"df_parameters": {}},
                                           "updateNotes": [], "questions": ["How many periods?"]}) + "\n```"
        with mock.patch.object(handler_module.cborg, "is_available", return_value=True), \
             mock.patch.object(handler_module.cborg, "prompt", return_value=fenced):
            answer = handler_module.scenario_handler.generate_data_with_ai(self.scenario_id, "fill demand")
        self.assertEqual(answer["questions"], ["How many periods?"])

    def test_questions_only_response_has_no_updated_scenario(self):
        answer = self._run({"status": "success", "updateNotes": [], "questions": ["Which pads?"]})
        self.assertNotIn("updatedScenario", answer)
        self.assertEqual(answer["questions"], ["Which pads?"])

    def test_string_update_notes_become_a_list(self):
        result = self._run({"status": "success", "updatedScenario": {"df_parameters": {}},
                            "updateNotes": "No tables were changed.", "questions": ["Which pads?"]})
        self.assertEqual(result["updateNotes"][0], "No tables were changed.")
        self.assertTrue(any("AI guard" in note for note in result["updateNotes"]))

    def test_guard_rejects_unusable_scenario_through_endpoint(self):
        result = self._run({"status": "success", "updatedScenario": "garbage", "updateNotes": [], "questions": []})
        self.assertEqual(result["status"], "error")
        self.assertIn("no updates were applied", result["errorMessage"])
        self.assertNotIn("updatedScenario", result)

    def test_guard_rejection_preserves_valid_questions(self):
        result = self._run({"status": "success", "updatedScenario": "garbage", "updateNotes": [],
                            "questions": ["Which pads?", "Which units?"]})
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["questions"], ["Which pads?", "Which units?"])

    def test_guard_rejection_drops_malformed_questions(self):
        result = self._run({"status": "success", "updatedScenario": "garbage", "updateNotes": [],
                            "questions": ["Which pads?", "   ", 42]})
        self.assertEqual(result["status"], "error")
        self.assertNotIn("questions", result)

    def test_guard_notes_are_appended_to_update_notes(self):
        result = self._run({"status": "success",
                            "updatedScenario": {"df_sets": {}, "df_parameters": {}},
                            "updateNotes": ["Only sets were updated."], "questions": []})
        self.assertEqual(result["updatedScenario"]["df_parameters"]["PadRates"], {"T01": [1]})
        self.assertIn("Only sets were updated.", result["updateNotes"])
        self.assertTrue(any("AI guard" in note and "dropped" in note for note in result["updateNotes"]))


class SanitizeAiUpdatedScenarioTests(unittest.TestCase):
    def setUp(self):
        self.original = {
            "df_sets": {"ProductionPads": ["P1"], "StorageSites": ["S1"]},
            "df_parameters": {
                "PadRates": {"ProductionPads": ["P1"], "T01": [100]},
                "CapCost": {"ProductionPads": ["P1"], "VALUE": [10]},
            },
        }

    def test_valid_response_passes_through(self):
        response = {"df_sets": {"ProductionPads": ["P1"]}, "df_parameters": {"PadRates": {"T01": [200]}}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_parameters"]["PadRates"], {"T01": [200]})
        self.assertEqual(cleaned["df_parameters"]["CapCost"], self.original["df_parameters"]["CapCost"])
        self.assertTrue(any("dropped" in note and "CapCost" in note for note in notes))

    def test_dropped_tables_are_restored(self):
        response = {"df_sets": {}, "df_parameters": {"PadRates": {"T01": [200]}}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_parameters"]["CapCost"], self.original["df_parameters"]["CapCost"])
        self.assertIn("CapCost", notes[0])

    def test_unknown_top_level_keys_are_removed(self):
        response = {"df_sets": {}, "df_parameters": {}, "surprise_section": {"a": 1}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertNotIn("surprise_section", cleaned)
        self.assertTrue(any("surprise_section" in note for note in notes))

    def test_malformed_table_entries_revert_to_original(self):
        response = {"df_parameters": {"PadRates": "not a table", "Extra": [1, 2]}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_parameters"]["PadRates"], self.original["df_parameters"]["PadRates"])
        self.assertNotIn("Extra", cleaned["df_parameters"])
        self.assertTrue(any("malformed" in note for note in notes))

    def test_new_tables_are_flagged_not_blocked(self):
        response = {"df_parameters": {"PadRates": {"T01": [1]}, "NewCost": {"T01": [5]}}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertIn("NewCost", cleaned["df_parameters"])
        self.assertTrue(any("NewCost" in note and "review" in note for note in notes))

    def test_legacy_data_input_wrapper_is_unwrapped(self):
        response = {"data_input": {"df_sets": {"ProductionPads": ["P1"]},
                                   "df_parameters": {"PadRates": {"T01": [200]}}}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertNotIn("data_input", cleaned)
        self.assertEqual(cleaned["df_parameters"]["PadRates"], {"T01": [200]})

    def test_dropped_set_entries_are_restored(self):
        response = {"df_sets": {"ProductionPads": ["P1"]}, "df_parameters": {}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_sets"]["ProductionPads"], ["P1"])
        self.assertTrue(any("dropped set entries" in note for note in notes))

    def test_malformed_set_entries_are_reverted(self):
        response = {"df_sets": {"ProductionPads": "oops"}, "df_parameters": {}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_sets"]["ProductionPads"], ["P1"])
        self.assertTrue(any("malformed set entries" in note for note in notes))

    def test_new_set_entries_are_flagged_not_blocked(self):
        response = {"df_sets": {"ProductionPads": ["P1"], "StorageSites": ["S1"], "RiverIntakes": ["R1"]},
                    "df_parameters": {}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_sets"]["RiverIntakes"], ["R1"])
        self.assertTrue(any("new set entries" in note and "RiverIntakes" in note for note in notes))

    def test_omitted_df_sets_section_is_restored(self):
        response = {"df_parameters": {"PadRates": {"T01": [200]}}}
        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
        self.assertEqual(cleaned["df_sets"], self.original["df_sets"])
        self.assertTrue(any("omitted the df_sets section" in note for note in notes))

    def test_original_objects_are_not_aliased(self):
        response = {"df_parameters": {"PadRates": {"T01": [200]}}}
        cleaned, _ = sanitize_ai_updated_scenario(self.original, response)
        cleaned["df_parameters"]["PadRates"]["T01"][0] = 999
        self.assertEqual(self.original["df_parameters"]["PadRates"]["T01"][0], 100)

    def test_unusable_responses_return_none(self):
        for bad in ("a string", 42, {"df_sets": {}}, None):
            cleaned, notes = sanitize_ai_updated_scenario(self.original, bad)
            self.assertIsNone(cleaned)
            self.assertTrue(notes and "no updates were applied" in notes[0])


if __name__ == "__main__":
    unittest.main()
