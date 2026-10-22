# AI-Feature Review Tests (separate from the main suite)

These tests were written to verify the AI grounding work on `ai-grounding-compatible`.
They are intentionally **kept out of the main test suite** — main's original test files are
byte-identical to `main` and are not modified by these additions.

## Locations

| Area | Location | Notes |
|---|---|---|
| Frontend dialog | `electron/ui/src/tests/aifeature/dialog.aifeature.test.tsx` | Renders the real `AIPromptDialog` |
| Frontend wiring | `electron/ui/src/tests/aifeature/bottombar.aifeature.test.tsx` | Renders `Bottombar` with a mocked AI dialog |
| Frontend decoder | `electron/ui/src/tests/aifeature/contracts.aifeature.test.tsx` | `requestAIDataUpdate` decoder contract |
| Backend prompts/guard | `backend/tests_ai/test_ai_prompts.py` | Prompt contract, response sanitization, structural guard |
| Backend retrieval | `backend/tests_ai/test_docs_retrieval.py` | FTS5 retrieval, settings bias, docs version header |

## Run commands

Frontend — only the AI-feature tests:

```bash
cd electron/ui
CI=true npm test -- --testPathPattern='aifeature'          # 3 suites, 8 tests
```

Frontend — main's original suite, without the AI-feature tests:

```bash
cd electron/ui
CI=true npm test -- --testPathIgnorePatterns=aifeature     # 32 suites, 252 tests
```

Backend — only the AI-feature tests:

```bash
cd backend
python -m unittest discover -s tests_ai -t .               # 38 tests
```

Backend — main's original suite (unchanged):

```bash
cd backend/tests
PYTHONPATH=<repo>/backend:<repo>/backend/tests python -m unittest \
  test_ai_availability test_frozen_startup test_legacy_inputs test_map_export \
  test_map_import test_model_diagnostics test_optimization_workflow \
  test_payload_contracts test_scenario_api test_scenario_fill \
  test_scenario_validation test_solver_precision test_workbook_handles   # 94 tests, ~2.5 min
```

## What the AI-feature tests cover

**Backend (`tests_ai/`)**
- Prompt contract: `patch`-free whole-`updatedScenario` contract, `questions` rule, `updateNotes`
  format rules (one short note per change, no markdown), units/defaults block,
  model-requirements block, validation-findings block.
- Model settings parsing: `waterQuality`/`hydraulics` are multi-valued (`post_process` does not
  require those tables; `discrete`/`co_optimize*` do).
- Stateless AI calls: `clear_history()` called and `prompt(..., add_to_history=False)` on every
  autofill request.
- Structural guard (`sanitize_ai_updated_scenario`): dropped tables/set entries restored, omitted
  `df_sets` restored, malformed entries reverted, new tables/set entries flagged for review,
  unknown top-level keys removed, legacy `{"data_input": ...}` responses unwrapped, unusable
  responses rejected with `status: "error"` while valid `questions` are preserved, no aliasing of
  the original scenario.
- Docs retrieval: camelCase tokenization, relevance, terminology always-on, budget limits,
  graceful no-index fallback, enabled-feature retrieval bias (`waterQuality`), docs version header
  with mismatch `WARNING` and fallback without metadata.

**Frontend (`aifeature/`)**
- Validation findings reach the fill request body.
- Multi-line `updateNotes` render as one scannable bullet per line.
- Guard rejections surface questions with inline answer fields.
- Inline answers are sent as a `Q:/A:` transcript on the follow-up run, including the original
  prompt and omitting unanswered questions.
- Bottombar: standalone "AI Fill Inputs" attaches the latest validation findings; "Fix with AI"
  appears only when AI is available (non-AI setups see main's validation dialog).
- Decoder: a questions-only success response is valid and carries no scenario.

Note: the default `npm test` (no path arguments) runs everything, including the `aifeature`
folder. Use the two frontend commands above to keep the runs separate.
