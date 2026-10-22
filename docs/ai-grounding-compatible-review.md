# AI Grounding (main-compatible) — Change Review

**Branch:** `ai-grounding-compatible` (base: `main`)
**Commits:** `d7a8a4f` (feature port) + the current change set (bug fixes + issue bullets 1–2)

This document explains every change on this branch relative to `main`, in two groups:

1. **The feature port** — everything from the `ai-grounding` branch re-implemented so that
   main's data-flow architecture is preserved (the AI still returns a **whole `updatedScenario`**;
   there is no patch contract and no server-side patch merge).
2. **Bug fixes + issue bullets 1–2** — built on top of the port.

The full unified diff against `main` is at the end of this file (Appendix), excluding this document.

---

## Part 0 — What was deliberately NOT changed (architecture compatibility)

| Aspect | main's behavior | This branch |
|---|---|---|
| AI response contract | AI returns a complete `updatedScenario` JSON object | **Unchanged.** The prompt still asks for `updatedScenario`; the frontend still merges `df_parameters` wholesale on Save. |
| Scenario save path | `handleScenarioUpdate(..., "json")` | **Unchanged.** |
| Module layout | `backend/app/internal/ai/{client,configuration}.py` | **Unchanged.** Only additive files: `ai/docs.py` + the prebuilt index, and `backend/scripts/`. |

The only contract change is **additive**: a success response may now carry an optional
`questions` array, and `updatedScenario` is optional *only* when questions are present
(a questions-only response is valid; a response with neither is rejected).

---

## Part 1 — The feature port (commit `d7a8a4f`)

### 1.1 PARETO system prompt — `backend/app/internal/ai/client.py`

**What main did:** AI requests were bare user messages — a generic LLM with no PARETO persona.
**What this branch does:** adds `PARETO_SYSTEM_PROMPT` (domain persona: input tables, flow
decisions, optimization layer, app constraints) plus rules of engagement — cite actual
node/table/period names, never invent absent values, mark hypotheses as hypotheses, preserve
referential integrity, respond in pure JSON. The client prepends it to every request unless a
system message is already present; `set_system_prompt()` allows overrides.

Default model changed `openai/gpt-5.2` → `cborg-coder-max` (constructor default and the
module-level `cborg` singleton).

### 1.2 Docs grounding retrieval — `backend/app/internal/ai/docs.py` (new) + `pareto_docs_index.sqlite` (new)

**What main did:** nothing — no PARETO documentation reached the model.
**What this branch does:** a retrieval layer over a prebuilt SQLite FTS5 index of the PARETO
docs snapshot (9 rst docs + the app-owned `docs/ui-parameter-requirements.md`; 119 chunks):

- `query_tokens()` — camelCase-aware tokenization (`TruckingHourlyCost` → "trucking hourly cost"),
  stopword filter, 40-token cap.
- `_retrieve()` — BM25 OR-match, greedy packing under a per-request character budget
  (22k autofill / 32k diagnosis).
- `prompt_reference_docs()` — Terminology chunk always on + up to 8 chunks retrieved against the
  user's prompt; `diagnosis_reference_docs()` — up to 12 chunks retrieved against the failure
  message.
- Graceful degradation: missing/corrupt index → empty string → AI runs ungrounded, never crashes.

The index is rebuilt with `python backend/scripts/build_docs_index.py`
(`backend/scripts/inspect_docs_index.py` is a dev browser for it).

### 1.3 Prompt builders — `backend/app/internal/util.py`

**What main did:** `FormatPrompt(user_prompt, data)` sent only the instruction + full scenario JSON.
**What this branch does:** `FormatPrompt(user_prompt, data, optimization_settings, validation_findings)`
additionally injects (in order): retrieved reference docs, a validation-findings block
("Prioritize resolving these…"), then scenario JSON, then the user prompt.
`FormatOptimizationDiagnosisPrompt` gains the same docs injection, retrieved against the
truncated failure message (`summarize_long_text`, 6000 head / 4000 tail — pre-existing).

The response contract keeps main's `updatedScenario` key and adds:
- **questions rule:** if a node/table/period the request depends on doesn't exist, or an
  engineering value can't be inferred, do not invent — return a top-level `questions` array and
  only fill what the provided data supports (omit `updatedScenario` if nothing can be filled).
- **updateNotes format rules** (see 1.5).

### 1.4 Request handling — `backend/app/internal/scenario_handler.py` + `backend/app/routers/scenarios.py`

**What main did:** the router accepted only `prompt`; the response was passed through untouched.
**What this branch does:**
- Router accepts `validation_findings` (list/object; else 400) and forwards it.
- `generate_data_with_ai(id, user_prompt, validation_findings=None)` passes the scenario's
  optimization settings into the prompt and **sanitizes the response**: `updateNotes`
  string→list coercion, malformed `updateNotes`/`questions` dropped (with logs) instead of
  crashing the UI. Legacy whole-scenario responses flow through unchanged.
- Diagnosis passes optimization settings into its prompt.

### 1.5 Update notes formatting — prompt + dialog

**Problem addressed:** notes came back as one wall-of-text paragraph.
**Prompt side (`util.py`):** `updateNotes` must be an array of short plain-text strings — one note
per distinct change, one sentence, ≤240 chars, no markdown/line breaks; first note summarizes the
interpretation, then one note per changed table; user decisions belong in `questions`, never in notes.
**Display side (`AIPromptDialog.tsx`):** notes are flattened on newlines and stripped of leading
`-`/`*`/`•` markers before rendering, so a model that ignores the contract still renders as
scannable bullets.

### 1.6 Questions flow — frontend

- `types/ai.ts`: `questions?: string[]`.
- `services/contracts/ai.ts`: `updatedScenario` becomes optional; a success response must carry
  updates **or** questions; tolerates the legacy `updatedNotes` spelling.
- `AIPromptContext.tsx`: questions state; `runPrompt(id, prompt, validationFindings?)`.
- `AIPromptDialog.tsx`: questions render as clickable buttons that append the question text to the
  prompt box for a follow-up run; questions-only responses suppress the Save button.
- `app.service.ts`: sends `validation_findings` in the POST body when present.

### 1.7 Validation findings + auto re-validation — `Bottombar.tsx`, `ScenarioValidationDialog.tsx`

**What main did:** validation and AI were disconnected.
**What this branch does:** the validation dialog gains **"Fix with AI"** (shown when issues exist
or state is infeasible); it hands the whole `ScenarioValidation` result to the AI dialog, which
shows an info alert ("findings will be shared"). After saving AI updates, `onApplied` →
**validation re-runs automatically**. Findings are cleared when the dialog closes or the
scenario/revision changes (preventing stale findings).

### 1.8 Diff review improvements — `AIPromptDialog.tsx`

**Problem addressed:** "Showing 6 of 52 changed rows… review full data after saving" and
overlapping column headers.
**What this branch does:** a `DiffTable` component keeps **all** changed rows and **all** columns;
each table shows the first 6 rows with a **"Show all N rows" / "Show fewer"** toggle; headers and
cells get `overflowWrap: "anywhere"` + `minWidth: 0` (long camelCase names wrap instead of
bleeding into neighbors); the dialog was widened `sm` → `md`. Expansion resets when a new AI
result arrives.

---

## Part 2 — Bug fixes and issue bullets 1–2 (this change set)

### 2.1 Bug fix: AI calls are now stateless — `scenario_handler.py`, `ai/configuration.py`

Both AI call sites now run as self-contained requests:

```python
cborg.clear_history()
resp = cborg.prompt(prompt, add_to_history=False)
```

`AIConfiguration` (the wrapper the app actually calls) gains a `clear_history()` proxy so the
call reaches the active client. Each autofill/diagnosis request contains only its own prompt;
no replay of previous prompts, no unbounded token growth, no cross-scenario context leakage.

### 2.2 Bug fix: structural guard for whole-scenario responses — `scenario_handler.py`

Because the AI re-emits the **entire** scenario (main's contract), a careless response could
silently drop input tables or invent top-level sections, and saving it would corrupt the inputs.
`sanitize_ai_updated_scenario(original_data_input, updated_scenario)` now runs before the
response is returned:

- **Unwraps** legacy scenario-shaped responses (`{"data_input": {...}}`) before validation — the
  frontend decoder already tolerated this shape; the backend would have rejected it.
- **Restores** any original table missing from `df_parameters` (data loss prevented) and notes it.
- **Protects `df_sets` the same way** — the save merge replaces the whole section, so a response
  omitting set entries would silently lose them. Dropped set entries are restored, malformed
  entries (non-list) reverted to original, an omitted `df_sets` section restored with a note, and
  newly added set entries flagged for review.
- **Reverts** malformed (non-dict) table entries to original values.
- **Removes** unrecognized top-level keys (anything outside the original keys plus
  `df_sets`/`df_parameters`) and notes it.
- **Flags** newly added tables in `updateNotes` for review — allowed (filling a missing required
  table is legitimate) but never silent.
- Returns `(None, notes)` for unusable responses (non-dict scenario, missing `df_parameters`) →
  the endpoint returns a clean `status: "error"` instead of a success the decoder would reject.
  Valid `questions` in the same response are preserved on the error (and dropped if malformed),
  and the frontend error path surfaces them as clickable follow-ups.

Guard actions are appended to `updateNotes` ("AI guard: …") so the review dialog shows exactly
what the guard changed — nothing about the guard is silent.

### 2.3 Model requirements block (issue bullet 1) — `util.py`

`_model_requirements_block(optimization_settings)` reuses the existing `prepare_config(..., "modelParameters")`
to compute the effective model parameters (objective, solver, runtime, pipeline cost/capacity
modes, water quality, hydraulics, desalination, …) and injects them into the autofill prompt with
an "Enabled features: …" note. Previously `optimization_settings` was accepted but never reached
the prompt body — the AI could not tailor fills to the configured model (e.g. water-quality
tables required only when `waterQuality` is enabled).

Feature parsing mirrors the app's real value space: `waterQuality` and `hydraulics` are
multi-valued dropdowns (`"post_process"`, `"discrete"`, `"co_optimize"`, `"co_optimize_linearized"`),
not booleans. `post_process` runs the model *without* requiring those input tables, so it is NOT
listed as an enabled feature; `discrete` / `co_optimize*` are. Retrieval bias (2.7) stays broad
on purpose — post-process docs are still useful context for results questions.

### 2.4 Units and defaults block (issue bullet 1) — `util.py`

`_units_defaults_block()` injects the scenario's `DEFAULT_UNITS` (volume bbl, distance mile,
concentration mg/liter, …) and the conventions: **blank cells mean unfilled, not zeros**; do not
fill a blank with 0 unless the documented default is 0; state assumed units in `updateNotes`.
Previously units rode along implicitly inside the scenario JSON with no instruction.

### 2.5 Dataset rules (issue bullet 1, minimal) — `util.py`

The empty `dataset_rules` TODO now carries the core referential rule: only use identifiers that
already exist in the scenario's sets and tables; never delete existing tables or rows.

### 2.6 Docs version pinning (issue bullet 1: "version-appropriate") — `ai/docs.py`, `build_docs_index.py`

- The build script records the installed `project-pareto` version (`pareto_version`) in the
  index metadata next to `built_at`; the committed index was rebuilt with this metadata.
- Every rendered reference block is headed with its provenance:
  `Reference documentation for the PARETO strategic model (grounded in PARETO <v>; docs built <date>)`.
- If the installed version differs from the index version, a `WARNING` line tells the model to
  treat version-specific details as potentially outdated. No metadata → falls back to naming the
  installed version with a caveat; `importlib.metadata` unavailable → silent graceful fallback.

### 2.7 Settings-aware retrieval (issue bullet 2) — `ai/docs.py`

`_settings_query_terms(optimization_settings)` turns enabled features (waterQuality, hydraulics,
desalination_model, subsurface_risk, infrastructure_timing) into extra retrieval tokens so
documentation for those features surfaces even when a short prompt ("fill things") or a solver
error message never mentions them. `_retrieve()` tokenizes and merges the extra terms with the
query tokens (cap 60). This gives the previously dead `optimization_settings` parameter of
`prompt_reference_docs` / `diagnosis_reference_docs` a real function.

### 2.8 Auto-attach validation findings on standalone fills (issue bullet 2) — `Bottombar.tsx`

**What the port did:** findings reached the AI only through the validation dialog's "Fix with AI".
**Now:** opening the dialog via the standalone **"AI Fill Inputs"** button also attaches the
latest `validationResult` (if one exists for the current revision; the existing effect already
clears stale results). The dialog's info alert reflects it.

### 2.9 Tests

Backend (`tests/test_ai_prompts.py`, `tests/test_docs_retrieval.py`):
- Contract tests: units/defaults block present; model-requirements block present with settings
  (and absent without); multi-valued feature settings parsed like the app (`post_process` not an
  enabled feature, `discrete`/`co_optimize` are); notes format rules asserted.
- Stateless assertions: `clear_history()` called once and `prompt(..., add_to_history=False)` on
  every autofill request.
- Guard tests: dropped tables restored; `df_sets` dropped entries restored, omitted section
  restored, malformed entries reverted, new entries flagged; legacy `data_input` wrapper
  unwrapped; unknown top-level keys removed; malformed table entries reverted; new tables flagged
  not blocked; no aliasing of the original scenario; unusable responses → `(None, notes)`;
  endpoint-level: garbage scenario → `status: "error"` with valid `questions` preserved
  (malformed dropped); guard notes appended to `updateNotes`.
- Retrieval tests: enabled `waterQuality` biases retrieval to water-quality chunks that the plain
  query misses; header records the docs version + `docs built` date; mismatch produces the
  `WARNING`; matching versions produce none; missing metadata falls back.
  (Tests rebuild temp indexes via a `_rebuild_index` helper that clears the per-path connection
  cache — the cache previously made a remove+rebuild read stale data.)

Frontend (`tests/bottombar.test.tsx`, `tests/aiprompt.test.tsx`):
- New test: validate → close dialog → "AI Fill Inputs" → the AI dialog receives
  `validationFindings` matching the validation result. The dialog mock now captures props.
- New test: an error response carrying `questions` (guard rejection) surfaces them as clickable
  follow-ups.

**Verification:** 38 AI tests + 47 backend suites + 258 frontend tests pass; `tsc --noEmit` clean.

---

## Part 2.5 — Second-pass bug review (this change set)

A follow-up review of the whole branch found and fixed four issues:

1. **Multi-valued settings were misparsed** (`util.py`) — the app stores `waterQuality` as
   `"false"/"post_process"/"discrete"` and `hydraulics` as `"false"/"post_process"/"co_optimize"/"co_optimize_linearized"`.
   The original `"true"/"1"` check mislabeled `post_process` (no input tables required) as an
   enabled feature and missed `discrete`/`co_optimize*` (tables required). Fixed with per-feature
   active-value lists matching the app's dropdowns; covered by new contract tests.
2. **`df_sets` was unprotected** (`scenario_handler.py`) — the save merge replaces the whole
   `df_sets` object, so a response omitting set entries silently lost them. The guard now
   restores dropped/omitted set entries, reverts malformed ones, and flags additions, mirroring
   the `df_parameters` protection.
3. **Legacy wrapped responses were rejected** (`scenario_handler.py`) — the frontend decoder
   unwraps `{"data_input": {...}}`-shaped responses; the backend guard errored on them instead.
   It now unwraps before validating.
4. **Guard rejections discarded questions** (`scenario_handler.py`, `contracts/ai.ts`,
   `AIPromptContext.tsx`) — when the guard rejects an unusable scenario, valid `questions` from
   the same response are now preserved on the error, the decoder carries them, and the dialog
   renders them as clickable follow-ups.

---

## Part 3 — Known limitations / follow-ups (not in this change set)

- Unresolved questions are not persisted on the scenario (they live in the dialog session only).
- The autofill scenario payload is still sent untruncated (diagnosis samples at 14k chars).
- No automated eval harness running the `examples/*failure*.xlsx` fixtures through the model.
- Retrieval is keyword/BM25 only (no embeddings/synonyms).

---

## Appendix — Full diff vs `main`

```diff
diff --git a/backend/app/internal/ai/client.py b/backend/app/internal/ai/client.py
index 1ccccf6..018e87f 100644
--- a/backend/app/internal/ai/client.py
+++ b/backend/app/internal/ai/client.py
@@ -20,15 +20,46 @@ import openai
 load_dotenv()
 
 
+PARETO_SYSTEM_PROMPT = """You are a senior optimization engineer and subject-matter expert in strategic \
+produced-water management with the PARETO framework, an open-source strategic planning tool for water \
+management in shale oil and gas operations. You assist users of the PARETO UI desktop application with \
+filling, reviewing, and diagnosing PARETO strategic optimization models.
+
+Domain expertise:
+- PARETO input data model: sets and tables such as ProductionPads, CompletionsPads, SWDSites, \
+ExternalWaterSources, StorageSites, PadStorageSites, TreatmentSites, TreatmentTechnologies, ReuseOptions, \
+NetworkNodes, and their flow decisions (piped and trucked sourcing, disposal, storage, treatment, reuse), \
+pipeline capacities, hydraulics, water quality components, and air emissions.
+- The optimization layer: the project-pareto Python package building a Pyomo model, objectives such as \
+Minimize Cost and Maximize Reuse, solver choices (CBC, Gurobi), runtime and optimality-gap settings, \
+scaled vs original units, and manual override values.
+- The application: users edit scenario input tables, the network map, and optimization settings in the UI. \
+They cannot edit units or source code, so only suggest changes achievable in the app.
+
+Rules of engagement:
+- Be precise and quantitative; reference the actual node names, table names, and periods from the \
+provided scenario JSON.
+- Never invent values that are absent from the provided data; clearly distinguish observations from \
+hypotheses and acknowledge missing evidence.
+- When modifying or generating input data, preserve referential integrity: use only node names, periods, \
+and options that exist in the scenario, keep units consistent with the scenario, and change only what the \
+user asked for.
+- Respond exactly in the format the user message requests (typically pure JSON without markdown fences or \
+commentary) so the application can parse the output.
+- For failure diagnosis, be concise and practical: state the likely issue, propose realistic next steps \
+ordered from most to least practical, and say clearly what remains uncertain."""
+
+
 class OpenAIClientWrapper:
     def __init__(
         self,
         api_key: Optional[str] = None,
         base_url: Optional[str] = None,
-        model: str = "openai/gpt-5.2",
+        model: str = "cborg-coder-max",
         default_temperature: float = 0.0,
         max_retries: int = 3,
         backoff_factor: float = 1.0,
+        system_prompt: Optional[str] = PARETO_SYSTEM_PROMPT,
     ):
         """
         Create the wrapper.
@@ -40,6 +71,7 @@ class OpenAIClientWrapper:
             default_temperature: default temperature for calls.
             max_retries: number of retries for transient errors.
             backoff_factor: multiplier for exponential backoff (seconds).
+            system_prompt: system message prepended to every request; None disables it.
         """
         if api_key is None:
             api_key = os.environ.get("CBORG_API_KEY") or os.environ.get("OPENAI_API_KEY")
@@ -56,6 +88,7 @@ class OpenAIClientWrapper:
         self.default_temperature = default_temperature
         self.max_retries = max_retries
         self.backoff_factor = backoff_factor
+        self.system_prompt = system_prompt
 
         # chat history (list of message dicts as expected by OpenAI chat API)
         # Example: {"role": "system", "content": "..."}
@@ -89,6 +122,10 @@ class OpenAIClientWrapper:
         """Change the model to use for subsequent calls."""
         self.model = model_name
 
+    def set_system_prompt(self, system_prompt: Optional[str]) -> None:
+        """Change the system prompt prepended to every request; None disables it."""
+        self.system_prompt = system_prompt
+
     def set_api_key(self, api_key: Optional[str], base_url: Optional[str] = None) -> None:
         """Change API key (reinitializes underlying client)."""
         self.api_key = api_key.strip() if api_key else None
@@ -164,6 +201,10 @@ class OpenAIClientWrapper:
         if prompt is not None:
             request_messages.append({"role": "user", "content": prompt})
 
+        # Prepend the configured system prompt unless one is already present
+        if self.system_prompt and (not request_messages or request_messages[0].get("role") != "system"):
+            request_messages = [{"role": "system", "content": self.system_prompt}] + request_messages
+
         # use the client to call the chat completions endpoint
         def payload():
             create_kwargs = {
@@ -266,7 +307,7 @@ base_url = os.environ.get("CBORG_BASE_URL", "https://api.cborg.lbl.gov")
 cborg = OpenAIClientWrapper(
     api_key=os.environ.get("CBORG_API_KEY"),
     base_url=base_url,
-    model="openai/gpt-5.2",
+    model="cborg-coder-max",
     default_temperature=0.0,
     max_retries=2,
     backoff_factor=1.0,
diff --git a/backend/app/internal/ai/configuration.py b/backend/app/internal/ai/configuration.py
index f4eb5ab..c96b3b5 100644
--- a/backend/app/internal/ai/configuration.py
+++ b/backend/app/internal/ai/configuration.py
@@ -21,6 +21,10 @@ class AIConfiguration:
     def is_available(self):
         return self.active_client.is_available()
 
+    def clear_history(self):
+        """Reset the active client's conversation history."""
+        self.active_client.clear_history()
+
     def describe(self):
         client = self.active_client
         return {
diff --git a/backend/app/internal/ai/docs.py b/backend/app/internal/ai/docs.py
new file mode 100644
index 0000000..2984e76
--- /dev/null
+++ b/backend/app/internal/ai/docs.py
@@ -0,0 +1,359 @@
+"""PARETO reference documentation for AI prompt grounding.
+
+Grounding comes from the prebuilt SQLite FTS5 index built by
+backend/scripts/build_docs_index.py. The index file is expected at
+app/internal/ai/pareto_docs_index.sqlite or the path given by
+PARETO_DOCS_INDEX. The prompt builders retrieve only the chunks relevant to
+the request (user prompt or failure message) plus a small always-on
+terminology block.
+
+Without the index the helpers return empty strings, so AI features keep
+working ungrounded rather than failing. The rst/markdown parsing helpers
+below are used by the build script to (re)generate the index from the
+pareto_docs snapshot; they are not consulted at request time.
+"""
+import os
+import re
+import sqlite3
+from pathlib import Path
+
+_DOCS_SUBPATHS = {
+    "strategic": Path("model_library") / "strategic_water_management" / "index.rst",
+    "hydraulics": Path("model_library") / "Hydraulics" / "index.rst",
+    "water_treatment": Path("model_library") / "water_treatment" / "index.rst",
+    "operational": Path("model_library") / "operational_water_management" / "index.rst",
+    "ui": Path("user_interface") / "how_to_use_ui.rst",
+    "faq": Path("faq.rst"),
+    "tutorials": Path("tutorials_examples") / "index.rst",
+    "getting_started": Path("getting_started") / "index.rst",
+    "get_data": Path("utilities") / "Get_Data.rst",
+}
+
+# App-owned documentation that lives in this repository rather than in the
+# pareto_docs snapshot; resolved relative to the repo root.
+_APP_DOCS_SUBPATHS = {
+    "parameter_requirements": Path("docs") / "ui-parameter-requirements.md",
+}
+
+
+def _clean_rst(text):
+    text = re.sub(r"^\.\. _.*:\s*$", "", text, flags=re.M)
+    text = re.sub(r":math:`([^`]*)`", r"\1", text)
+    text = re.sub(r":ref:`([^`]*)`", r"\1", text)
+    text = re.sub(r"^\s*[+|][+\-=|:\s]*[+|]\s*$", "", text, flags=re.M)
+    text = re.sub(r"\n{3,}", "\n\n", text)
+    return text.strip()
+
+
+def _parse_sections(text):
+    """Split an rst document into (title, body) sections via underline headings."""
+    lines = text.split("\n")
+    sections = []
+    title, buffer = "", []
+    for index, line in enumerate(lines):
+        underline = lines[index + 1].strip() if index + 1 < len(lines) else ""
+        is_heading = (
+            line.strip()
+            and not line.startswith((" ", "\t", "+", "|"))
+            and len(underline) >= 3
+            and set(underline) <= {"=", "-"}
+            and len(underline) >= len(line.strip())
+        )
+        if is_heading:
+            if buffer:
+                sections.append((title, "\n".join(buffer).strip()))
+            title, buffer = line.strip(), []
+        else:
+            buffer.append(line)
+    if buffer:
+        sections.append((title, "\n".join(buffer).strip()))
+    return sections
+
+
+_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
+
+
+def _parse_markdown(text):
+    """Split a markdown document into (title, body) sections via # headings."""
+    sections = []
+    title, buffer = None, []
+    for line in text.split("\n"):
+        match = _MD_HEADING.match(line)
+        if match:
+            if title is not None:
+                sections.append((title, "\n".join(buffer).strip()))
+            title, buffer = match.group(2).strip(), []
+        else:
+            buffer.append(line)
+    if title is not None:
+        sections.append((title, "\n".join(buffer).strip()))
+    return sections
+
+
+def _load(path):
+    try:
+        return _parse_sections(_clean_rst(path.read_text(encoding="utf-8")))
+    except OSError:
+        return []
+
+
+def _load_markdown(path):
+    try:
+        text = path.read_text(encoding="utf-8")
+    except OSError:
+        return []
+    return _parse_markdown(re.sub(r"\n{3,}", "\n\n", text))
+
+
+def load_sections(root):
+    """Parse the reference documents under a docs root into {name: [(title, body), ...]}.
+
+    Used by the index build script (backend/scripts/build_docs_index.py) to
+    generate the FTS5 index from the pareto_docs snapshot; not consulted at
+    request time.
+    """
+    base = Path(root)
+    sections = {name: _load(base / subpath) for name, subpath in _DOCS_SUBPATHS.items()}
+    repo_root = Path(__file__).resolve().parents[4]
+    for name, subpath in _APP_DOCS_SUBPATHS.items():
+        sections[name] = _load_markdown(repo_root / subpath)
+    return sections
+
+
+def _render(header, blocks):
+    rendered = []
+    for title, text in blocks:
+        if text:
+            rendered.append(f"--- {title} ---\n{text}")
+    if not rendered:
+        return ""
+    body = "\n\n".join(rendered)
+    return f"{header}:\n\n{body}" if header else body
+
+
+# ---------------------------------------------------------------------------
+# FTS5 index retrieval
+# ---------------------------------------------------------------------------
+
+_INDEX_FILENAME = "pareto_docs_index.sqlite"
+
+# Character budgets for retrieved content per request type; terminology is on
+# top of these. Chunks are ~4000-6000 chars each, so these allow roughly 4-6
+# (autofill) and 6-8 (diagnosis) chunks.
+_AUTOFILL_RETRIEVAL_BUDGET = 22000
+_DIAGNOSIS_RETRIEVAL_BUDGET = 32000
+
+_STOPWORDS = {
+    "the", "and", "for", "with", "are", "was", "were", "not", "can", "has",
+    "have", "had", "this", "that", "then", "than", "from", "into", "onto",
+    "when", "what", "how", "why", "who", "its", "you", "your", "their",
+    "there", "here", "all", "any", "but", "out", "per", "via", "she", "him",
+    "her", "his", "our", "ours", "will", "would", "could", "should", "may",
+    "might", "must", "shall", "does", "did", "done", "being", "been", "have",
+}
+
+_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
+_CAMEL_RE = re.compile(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])")
+
+
+def _index_path():
+    configured = os.environ.get("PARETO_DOCS_INDEX")
+    if configured:
+        return Path(configured)
+    return Path(__file__).resolve().parent / _INDEX_FILENAME
+
+
+_index_connections = {}
+
+
+def _index_connection():
+    """Open (once) a read-only connection to the FTS5 index; None if unavailable."""
+    path = _index_path()
+    if not path.is_file():
+        return None
+    key = str(path)
+    if key not in _index_connections:
+        try:
+            # check_same_thread=False: connections may be created and used on
+            # different FastAPI worker threads; read-only access is safe.
+            connection = sqlite3.connect(f"file:{key}?mode=ro", uri=True, check_same_thread=False)
+            connection.execute("SELECT 1 FROM chunks LIMIT 1")
+        except (sqlite3.Error, OSError):
+            return None
+        _index_connections[key] = connection
+    return _index_connections[key]
+
+
+def query_tokens(text, limit=40):
+    """Reduce free text to a bounded list of lowercase FTS terms.
+
+    Splits camelCase identifiers (TruckingHourlyCost -> trucking hourly cost)
+    and drops stopwords so error messages and prose queries work as OR searches.
+    """
+    tokens = []
+    for word in _WORD_RE.findall(text or ""):
+        for part in (_CAMEL_RE.findall(word) or [word]):
+            part = part.lower()
+            if len(part) >= 2 and part not in _STOPWORDS and part not in tokens:
+                tokens.append(part)
+    return tokens[:limit]
+
+
+def _retrieve(query, budget_chars, max_chunks, exclude=(), extra_tokens=()):
+    """Return [(doc, title, body)] chunks ranked by bm25 within a char budget."""
+    connection = _index_connection()
+    if connection is None:
+        return []
+    tokens = query_tokens(query)
+    for term in extra_tokens:
+        for token in query_tokens(term):
+            if token and token not in tokens:
+                tokens.append(token)
+    tokens = tokens[:60]
+    if not tokens:
+        return []
+    match = " OR ".join(f'"{token}"' for token in tokens)
+    try:
+        rows = connection.execute(
+            "SELECT doc, title, body FROM chunks WHERE chunks MATCH ? "
+            "ORDER BY bm25(chunks) LIMIT ?",
+            (match, max_chunks * 3),
+        ).fetchall()
+    except sqlite3.Error:
+        return []
+    excluded = {(doc, title.split(" (part ")[0]) for doc, title in exclude}
+    selected, used = [], 0
+    for doc, title, body in rows:
+        key = (doc, title.split(" (part ")[0])
+        if key in excluded or not body:
+            continue
+        if used + len(body) > budget_chars:
+            continue
+        selected.append((doc, title, body))
+        used += len(body)
+        if len(selected) >= max_chunks:
+            break
+    return selected
+
+
+def _terminology_block():
+    """The small strategic-model terminology section, from the FTS5 index."""
+    connection = _index_connection()
+    if connection is None:
+        return ""
+    try:
+        row = connection.execute(
+            "SELECT body FROM chunks WHERE doc = 'strategic' AND title = 'Terminology' LIMIT 1"
+        ).fetchone()
+    except sqlite3.Error:
+        return ""
+    return row[0] if row else ""
+
+
+def _metadata_value(connection, key):
+    """One metadata table value from the index, or None when absent."""
+    try:
+        row = connection.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
+    except sqlite3.Error:
+        return None
+    return row[0] if row else None
+
+
+def _installed_pareto_version():
+    """The installed project-pareto package version, or None when unknown."""
+    try:
+        from importlib.metadata import version
+        return version("project-pareto")
+    except Exception:
+        return None
+
+
+def index_provenance():
+    """(pareto_version, built_at) recorded in the index, or (None, None)."""
+    connection = _index_connection()
+    if connection is None:
+        return None, None
+    return _metadata_value(connection, "pareto_version"), _metadata_value(connection, "built_at")
+
+
+def _reference_header():
+    """Header line naming the docs version, with a mismatch warning when the
+    index was built for a different PARETO version than the installed one."""
+    base = "Reference documentation for the PARETO strategic model"
+    pareto_version, built_at = index_provenance()
+    installed = _installed_pareto_version()
+    parts = []
+    if pareto_version:
+        parts.append(f"grounded in PARETO {pareto_version}")
+        if installed and installed != pareto_version:
+            parts.append(f"WARNING: this documentation was built for PARETO {pareto_version} but the "
+                         f"installed version is {installed}; treat version-specific details as potentially outdated")
+    elif installed:
+        parts.append(f"grounded in PARETO {installed} (the docs index does not record which version it was built from)")
+    if built_at:
+        parts.append(f"docs built {built_at[:10]}")
+    return f"{base} (" + "; ".join(parts) + ")" if parts else base
+
+
+def _settings_query_terms(optimization_settings):
+    """Extra retrieval tokens for model features the user enabled, so chunks
+    for those features surface even when the prompt/failure text omits them."""
+    if not isinstance(optimization_settings, dict):
+        return []
+
+    def enabled(name):
+        value = optimization_settings.get(name, "false")
+        return str(value).lower() not in ("false", "0", "", "none")
+
+    terms = []
+    if enabled("waterQuality"):
+        terms.append("water quality components removal efficiency")
+    if enabled("hydraulics"):
+        terms.append("pipeline hydraulics pump head pressure")
+    if enabled("desalination_model"):
+        terms.append("desalination treatment technologies")
+    if enabled("subsurface_risk"):
+        terms.append("subsurface risk")
+    if enabled("infrastructure_timing"):
+        terms.append("infrastructure expansion timing lead time")
+    return terms
+
+
+def prompt_reference_docs(optimization_settings=None, query=None):
+    """Reference docs for AI input filling: always-on terminology plus the
+    chunks the user's prompt and enabled model features make relevant. Empty
+    string without the index.
+    """
+    if _index_connection() is None:
+        return ""
+    blocks = []
+    terminology = _terminology_block()
+    if terminology:
+        blocks.append(("Terminology", terminology))
+    retrieved = _retrieve(
+        query, _AUTOFILL_RETRIEVAL_BUDGET, max_chunks=8,
+        exclude={("strategic", "Terminology")},
+        extra_tokens=_settings_query_terms(optimization_settings),
+    )
+    blocks.extend((f"[{doc}] {title}", body) for doc, title, body in retrieved)
+    return _render(_reference_header(), blocks)
+
+
+def diagnosis_reference_docs(optimization_settings=None, query=None):
+    """Reference docs for optimization diagnosis: always-on terminology plus
+    chunks retrieved against the failure message and enabled model features.
+    Empty string without the index.
+    """
+    if _index_connection() is None:
+        return ""
+    blocks = []
+    terminology = _terminology_block()
+    if terminology:
+        blocks.append(("Terminology", terminology))
+    retrieved = _retrieve(
+        query, _DIAGNOSIS_RETRIEVAL_BUDGET, max_chunks=12,
+        exclude={("strategic", "Terminology")},
+        extra_tokens=_settings_query_terms(optimization_settings),
+    )
+    blocks.extend((f"[{doc}] {title}", body) for doc, title, body in retrieved)
+    return _render(_reference_header(), blocks)
diff --git a/backend/app/internal/ai/pareto_docs_index.sqlite b/backend/app/internal/ai/pareto_docs_index.sqlite
new file mode 100644
index 0000000..ed6ece4
Binary files /dev/null and b/backend/app/internal/ai/pareto_docs_index.sqlite differ
diff --git a/backend/app/internal/scenario_handler.py b/backend/app/internal/scenario_handler.py
index a30199a..652f3a9 100644
--- a/backend/app/internal/scenario_handler.py
+++ b/backend/app/internal/scenario_handler.py
@@ -56,6 +56,97 @@ def serialized(method):
             return method(self, *args, **kwargs)
     return wrapped
 
+
+def sanitize_ai_updated_scenario(original_data_input, updated_scenario):
+    """Structural guard for whole-scenario AI responses.
+
+    The AI re-emits the complete scenario, so a careless response can silently
+    drop input tables or invent top-level sections; saving it would corrupt
+    the inputs. This returns (cleaned_scenario, guard_notes), or (None, notes)
+    when the response is unusable. Notes are appended to the AI's updateNotes
+    so the review dialog shows exactly what the guard changed.
+    """
+    notes = []
+    if not isinstance(updated_scenario, dict):
+        return None, ["The AI response was not a valid scenario object, so no updates were applied."]
+    # Legacy provider responses wrap the inputs in a scenario-shaped object.
+    if "df_parameters" not in updated_scenario and isinstance(updated_scenario.get("data_input"), dict):
+        updated_scenario = updated_scenario["data_input"]
+    if not isinstance(updated_scenario.get("df_parameters"), dict):
+        return None, ["The AI response did not include the df_parameters input tables, so no updates were applied."]
+    cleaned = deepcopy(updated_scenario)
+    original = original_data_input if isinstance(original_data_input, dict) else {}
+    original_params = original.get("df_parameters") or {}
+    params = cleaned["df_parameters"]
+
+    restored = sorted(table for table in original_params if table not in params)
+    for table in restored:
+        params[table] = deepcopy(original_params[table])
+    if restored:
+        notes.append("AI guard: the response dropped " + ", ".join(restored)
+                     + "; the original table(s) were kept.")
+
+    malformed = sorted(table for table, value in params.items() if not isinstance(value, dict))
+    for table in malformed:
+        if table in original_params:
+            params[table] = deepcopy(original_params[table])
+        else:
+            params.pop(table, None)
+    if malformed:
+        notes.append("AI guard: replaced malformed entries with original values for " + ", ".join(malformed) + ".")
+
+    added = sorted(table for table in params if table not in original_params)
+    if added:
+        notes.append("AI guard: the response added new table(s) " + ", ".join(added)
+                     + "; review them before saving.")
+
+    # df_sets gets the same protection: the merge on save replaces the whole
+    # section, so dropped or malformed set entries would silently lose data.
+    if "df_sets" in cleaned or "df_sets" in original:
+        original_sets = original.get("df_sets") or {}
+        sets = cleaned.get("df_sets")
+        if not isinstance(sets, dict):
+            if "df_sets" in cleaned:
+                if "df_sets" in original:
+                    cleaned["df_sets"] = deepcopy(original_sets)
+                    notes.append("AI guard: replaced the malformed df_sets section with the original sets.")
+                else:
+                    cleaned.pop("df_sets", None)
+            elif original_sets:
+                cleaned["df_sets"] = deepcopy(original_sets)
+                notes.append("AI guard: the response omitted the df_sets section; the original sets were kept.")
+            else:
+                cleaned["df_sets"] = {}
+        else:
+            restored_sets = sorted(set_name for set_name in original_sets if set_name not in sets)
+            for set_name in restored_sets:
+                sets[set_name] = deepcopy(original_sets[set_name])
+            if restored_sets:
+                notes.append("AI guard: the response dropped set entries " + ", ".join(restored_sets)
+                             + "; the original value(s) were kept.")
+            malformed_sets = sorted(set_name for set_name, value in sets.items() if not isinstance(value, list))
+            for set_name in malformed_sets:
+                if set_name in original_sets:
+                    sets[set_name] = deepcopy(original_sets[set_name])
+                else:
+                    sets.pop(set_name, None)
+            if malformed_sets:
+                notes.append("AI guard: replaced malformed set entries with original values for "
+                             + ", ".join(malformed_sets) + ".")
+            added_sets = sorted(set_name for set_name in sets if set_name not in original_sets)
+            if added_sets:
+                notes.append("AI guard: the response added new set entries " + ", ".join(added_sets)
+                             + "; review them before saving.")
+
+    allowed_keys = set(original) | {"df_sets", "df_parameters"}
+    removed = sorted(key for key in cleaned if key not in allowed_keys)
+    for key in removed:
+        cleaned.pop(key, None)
+    if removed:
+        notes.append("AI guard: removed unrecognized scenario section(s) " + ", ".join(removed) + ".")
+    return cleaned, notes
+
+
 class ScenarioHandler:
     """Manage the saved scenarios."""
 
@@ -769,7 +860,7 @@ class ScenarioHandler:
 
     
     @time_it
-    def generate_data_with_ai(self, id, user_prompt):
+    def generate_data_with_ai(self, id, user_prompt, validation_findings=None):
         _log.info(f"generate_data_with_ai user prompt: {user_prompt}")
         try:
 
@@ -785,18 +876,21 @@ class ScenarioHandler:
                 "detail": "AI client is not configured. Provide an API key to enable AI features."
             }
         if data_input:
-            prompt = FormatPrompt(user_prompt=user_prompt, data=data_input)
+            prompt = FormatPrompt(user_prompt=user_prompt, data=data_input, optimization_settings=scenario.get("optimization"), validation_findings=validation_findings)
             # _log.info(f"full prompt: {prompt}")
             _log.info(f"hitting cborg now")
-            resp = cborg.prompt(prompt)
+            # Each request is self-contained: never replay or accumulate shared
+            # client history (token growth and cross-scenario context leakage).
+            cborg.clear_history()
+            resp = cborg.prompt(prompt, add_to_history=False)
             _log.info(f"resp: {resp}")
             answer = self._parse_ai_json_response(resp)
 
-            ## TODO: 
+            ## TODO:
             ## 1) check if the prompt response was good (resp.status)
             ## 2) If ok, update scenario in DB
             ## 3) We must also update the map data (need function for this) and excel sheet
-            ## 4) Optionally, we could display the updates to the user 
+            ## 4) Optionally, we could display the updates to the user
 
             ## sample prompt: Can you fill in completions demand with 10000 barrels in each time period
 
@@ -805,8 +899,40 @@ class ScenarioHandler:
             if status == "error":
                 _log.info(f"error response from AI: {answer.get('errorMessage')}")
                 return answer
-            
+
+            guard_notes = []
             updatedScenario = answer.get("updatedScenario")
+            if updatedScenario is not None:
+                cleaned_scenario, guard_notes = sanitize_ai_updated_scenario(data_input, updatedScenario)
+                if cleaned_scenario is None:
+                    _log.info(f"AI response failed the structural guard: {guard_notes[0]}")
+                    error_response = {"status": "error", "errorMessage": guard_notes[0]}
+                    questions = answer.get("questions")
+                    if isinstance(questions, list) and all(isinstance(q, str) and q.strip() for q in questions):
+                        error_response["questions"] = [q.strip() for q in questions]
+                    return error_response
+                answer["updatedScenario"] = cleaned_scenario
+            notes = answer.get("updateNotes")
+            if isinstance(notes, str):
+                answer["updateNotes"] = [notes] if notes.strip() else []
+            elif isinstance(notes, list):
+                if all(isinstance(n, str) and n.strip() for n in notes):
+                    answer["updateNotes"] = [n for n in notes if n.strip()]
+                else:
+                    _log.info(f"dropping malformed AI updateNotes: {notes!r}")
+                    answer.pop("updateNotes", None)
+            elif notes is not None:
+                _log.info(f"dropping malformed AI updateNotes: {notes!r}")
+                answer.pop("updateNotes", None)
+            if guard_notes:
+                answer["updateNotes"] = (answer.get("updateNotes") or []) + guard_notes
+            questions = answer.get("questions")
+            if questions is not None:
+                if isinstance(questions, list) and all(isinstance(q, str) and q.strip() for q in questions):
+                    answer["questions"] = [q.strip() for q in questions]
+                else:
+                    _log.info(f"dropping malformed AI questions: {questions!r}")
+                    answer.pop("questions", None)
             return answer
         else:
             return {
@@ -877,11 +1003,14 @@ class ScenarioHandler:
         prompt = FormatOptimizationDiagnosisPrompt(
             error_message=truncated_failure_message,
             diagnosis_context=json.dumps(diagnosis_context, default=str),
+            optimization_settings=scenario.get("optimization"),
         )
         _log.info("hitting cborg for optimization diagnosis")
 
         try:
-            resp = cborg.prompt(prompt)
+            # Self-contained request, like the autofill path.
+            cborg.clear_history()
+            resp = cborg.prompt(prompt, add_to_history=False)
             answer = self._parse_ai_json_response(resp)
         except Exception as e:
             _log.error(f"unable to parse diagnosis response: {e}")
diff --git a/backend/app/internal/util.py b/backend/app/internal/util.py
index 9a3aeb2..0e7b8ad 100644
--- a/backend/app/internal/util.py
+++ b/backend/app/internal/util.py
@@ -1,3 +1,4 @@
+import json
 import math
 import time
 import functools
@@ -405,8 +406,61 @@ def build_map_data_from_json(data_input):
 
     return map_data
 
-def FormatPrompt(user_prompt, data = None):
-    user_disclosure = f"I am going to provide you with a user inputted prompt. This prompt should be directly related to manipulation or generation of input data relating to their scenario. The respective JSON scenario object will also be provided for you. If the provided user prompt does not include any sort of request to update the scenario data, or if there is anything otherwise fishy about the prompt, please do not abide by the request. Your response should be pure JSON with the updated JSON scenario object. Along with the updated scenario, I would like a status included. This will allow me to parse your output and determine if I should use the data returned by you, or discard it. Please provide the status as a key at the top level called 'status'. If there is something wrong with the prompt, status should be 'error'. Otherwise, make status 'success'. In the case that status is error, please also provide a key called 'errorMessage' where I can read and provide the error messsage. In the case that the prompt is OK, please then also provide the updated data at the top level with a key called 'updatedScenario'. Please also provide a detailed 'updateNotes', so that I can explain to the user what was updated.\n"
+def _units_defaults_block():
+    """Units and blank-cell conventions for the scenario inputs."""
+    return (
+        "Units and defaults: the scenario's display units are "
+        f"{json.dumps(DEFAULT_UNITS)}. Blank cells mean an input was never filled; they are not zeros, "
+        "so never fill a blank with 0 unless the documented default for that table is actually 0. "
+        "When you add or change values, state the units you assumed in updateNotes.\n"
+    )
+
+
+def _model_requirements_block(optimization_settings):
+    """The effective model parameters implied by the user's optimization settings.
+
+    Fills must be tailored to the configured model: features that are enabled
+    (water quality, hydraulics, desalination, ...) make their input tables
+    required, and objective/solver choices shape what values make sense.
+    """
+    if not optimization_settings:
+        return ""
+    try:
+        model_parameters = prepare_config({"optimization": optimization_settings},
+                                          expected_response="modelParameters")
+    except Exception:
+        return ""
+    if not isinstance(model_parameters, dict) or not model_parameters:
+        return ""
+
+    def _enabled(name, active_values=None):
+        value = str(model_parameters.get(name, "false")).lower()
+        if active_values is not None:
+            return value in active_values
+        return value not in ("false", "0", "", "none")
+
+    # water_quality/hydraulics are multi-valued in the app ("post_process" runs
+    # the model without requiring those input tables; "discrete"/"co_optimize*"
+    # build them into the optimization).
+    enabled = sorted(name for name, active in (
+        ("water_quality", _enabled("water_quality", ("true", "1", "discrete"))),
+        ("hydraulics", _enabled("hydraulics", ("true", "1", "co_optimize", "co_optimize_linearized"))),
+        ("desalination_model", _enabled("desalination_model")),
+        ("infrastructure_timing", _enabled("infrastructure_timing")),
+        ("subsurface_risk", _enabled("subsurface_risk")),
+    ) if active)
+    enabled_note = f" Enabled features: {', '.join(enabled)}." if enabled else ""
+    return (
+        "Model requirements for the current optimization settings (tailor fills to this configured "
+        f"model; tables required only under an enabled feature are required here too): "
+        f"{json.dumps(model_parameters)}.{enabled_note}\n"
+    )
+
+
+def FormatPrompt(user_prompt, data = None, optimization_settings = None, validation_findings = None):
+    from app.internal.ai.docs import prompt_reference_docs
+
+    user_disclosure = f"I am going to provide you with a user inputted prompt. This prompt should be directly related to manipulation or generation of input data relating to their scenario. The respective JSON scenario object will also be provided for you. If the provided user prompt does not include any sort of request to update the scenario data, or if there is anything otherwise fishy about the prompt, please do not abide by the request. Your response should be pure JSON. Along with the updated data, I would like a status included. This will allow me to parse your output and determine if I should use the data returned by you, or discard it. Please provide the status as a key at the top level called 'status'. If there is something wrong with the prompt, status should be 'error'. Otherwise, make status 'success'. In the case that status is error, please also provide a key called 'errorMessage' where I can read and provide the error messsage. In the case that the prompt is OK, please then also provide the updated data at the top level with a key called 'updatedScenario'. If essential information is missing (for example a node, table, or period the request depends on does not exist in the scenario, or an engineering value cannot be inferred from the provided data), do not guess or invent values: include a top-level key called 'questions' with a list of short questions, and return 'updatedScenario' only for the parts you can fill from the provided data; if you cannot make any changes, omit 'updatedScenario' and return only the questions. Please also provide 'updateNotes' as an array of short plain-text strings for the user to review. Format rules: one note per distinct change or finding; each note is a single sentence of at most 240 characters; no markdown, no line breaks inside a note, no numbered essays. The first note should summarize what you interpreted the request to mean, then add one note per changed table stating what changed and why. Do not bundle several changes into one long note. Anything that needs the user's decision belongs in 'questions', not in updateNotes.\n"
 
     if data:
         prompt_data = f"Here is the scenario: {data}\n\n"
@@ -416,13 +470,26 @@ def FormatPrompt(user_prompt, data = None):
     ## TODO:
     # Some of the input tables operate under a set of rules. For example, some tables can only use values from other tables.
     # If we can define these rules, it should improve how well this works.
-    dataset_rules = "" # f"Some rules about the dataset:\n"
+    dataset_rules = ("Dataset rules: only use identifiers (node names, periods, options) that already exist "
+                     "in the scenario's sets and tables; never delete existing tables or rows.\n")
+
+    units_defaults = _units_defaults_block()
+    model_requirements = _model_requirements_block(optimization_settings)
+
+    reference_docs = prompt_reference_docs(optimization_settings, user_prompt)
+    reference = f"{reference_docs}\n\n" if reference_docs else ""
 
-    prompt = f"{user_disclosure}{dataset_rules}{prompt_data}Here is the prompt:\n{user_prompt}"
+    validation = ""
+    if validation_findings:
+        validation = f"Here are the current validation findings for this scenario. Prioritize resolving these with targeted data changes:\n{validation_findings}\n\n"
+
+    prompt = f"{user_disclosure}{reference}{model_requirements}{dataset_rules}{units_defaults}{validation}{prompt_data}Here is the prompt:\n{user_prompt}"
 
     return prompt
 
-def FormatOptimizationDiagnosisPrompt(error_message, scenario = None, diagnosis_context = None):
+def FormatOptimizationDiagnosisPrompt(error_message, scenario = None, diagnosis_context = None, optimization_settings = None):
+    from app.internal.ai.docs import diagnosis_reference_docs
+
     user_disclosure = (
         "You are diagnosing a failed PARETO optimization run inside a desktop application. "
         "The optimization model comes from the project-pareto Python package and uses the pyomo Python package underneath. "
@@ -448,7 +515,9 @@ def FormatOptimizationDiagnosisPrompt(error_message, scenario = None, diagnosis_
 
     scenario_data = f"Scenario context:\n{scenario}\n\n" if scenario else ""
     diagnosis_data = f"Diagnosis context:\n{diagnosis_context}\n\n" if diagnosis_context else ""
-    return f"{user_disclosure}{scenario_data}{diagnosis_data}Optimization failure message:\n{error_message}"
+    reference_docs = diagnosis_reference_docs(optimization_settings, error_message)
+    reference = f"{reference_docs}\n\n" if reference_docs else ""
+    return f"{user_disclosure}{reference}{scenario_data}{diagnosis_data}Optimization failure message:\n{error_message}"
 
 def summarize_long_text(text, start_chars=6000, end_chars=4000):
     if text is None:
diff --git a/backend/app/routers/scenarios.py b/backend/app/routers/scenarios.py
index d799efb..b091741 100644
--- a/backend/app/routers/scenarios.py
+++ b/backend/app/routers/scenarios.py
@@ -542,8 +542,11 @@ async def request_ai_data_update(request: Request, id: int) -> dict:
     """
     req = await request.json()
     prompt = req.get("prompt", None)
+    validation_findings = req.get("validation_findings", None)
+    if validation_findings is not None and not isinstance(validation_findings, (list, dict)):
+        raise HTTPException(400, detail="validation_findings must be a list or object.")
     if prompt:
-        updatedScenario = scenario_handler.generate_data_with_ai(id, prompt)
+        updatedScenario = scenario_handler.generate_data_with_ai(id, prompt, validation_findings)
     else:
         raise HTTPException(400, detail=f"Please provide a prompt.")
     return updatedScenario
diff --git a/backend/scripts/build_docs_index.py b/backend/scripts/build_docs_index.py
new file mode 100644
index 0000000..f110d37
--- /dev/null
+++ b/backend/scripts/build_docs_index.py
@@ -0,0 +1,142 @@
+#!/usr/bin/env python
+"""Build a SQLite FTS5 retrieval index from the local PARETO docs snapshot.
+
+The output is a single .sqlite file that can ship with the app instead of the
+full pareto_docs/ folder. At query time the AI prompt builders match the user
+prompt or optimization failure message against this index and inject only the
+relevant chunks into the prompt (see app.internal.ai.docs).
+
+Usage:
+    python backend/scripts/build_docs_index.py
+    python backend/scripts/build_docs_index.py --docs-dir /path/to/pareto_docs \
+        --output /path/to/pareto_docs_index.sqlite --max-chunk-chars 4000
+"""
+import argparse
+import json
+import sqlite3
+import sys
+from datetime import datetime, timezone
+from pathlib import Path
+
+REPO_ROOT = Path(__file__).resolve().parents[2]
+sys.path.insert(0, str(REPO_ROOT / "backend"))
+
+from app.internal.ai.docs import load_sections  # noqa: E402
+
+DEFAULT_DOCS_DIR = REPO_ROOT / "pareto_docs"
+DEFAULT_OUTPUT = REPO_ROOT / "backend" / "app" / "internal" / "ai" / "pareto_docs_index.sqlite"
+
+
+def chunk_text(text, max_chars):
+    """Split a section body into chunks of at most ~max_chars on paragraph boundaries."""
+    if len(text) <= max_chars:
+        return [text]
+    chunks, current = [], ""
+    for paragraph in text.split("\n\n"):
+        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
+        if current and len(candidate) > max_chars:
+            chunks.append(current)
+            current = paragraph
+        else:
+            current = candidate
+    if current:
+        chunks.append(current)
+    # Last resort: hard-split individual paragraphs that still exceed the budget.
+    sized = []
+    for chunk in chunks:
+        while len(chunk) > max_chars * 1.5:
+            cut = chunk.rfind("\n", 0, max_chars)
+            cut = cut if cut > 0 else max_chars
+            sized.append(chunk[:cut].rstrip())
+            chunk = chunk[cut:].strip()
+        if chunk:
+            sized.append(chunk)
+    return sized
+
+
+def _check_fts5(connection):
+    try:
+        connection.execute("CREATE VIRTUAL TABLE temp.fts5_check USING fts5(x)")
+    except sqlite3.OperationalError as error:
+        sys.exit(f"SQLite FTS5 is not available in this environment: {error}")
+
+
+def _pareto_version():
+    """The installed project-pareto version the docs are grounded against."""
+    try:
+        from importlib.metadata import version
+        return version("project-pareto")
+    except Exception:
+        return "unknown"
+
+
+def build_index(docs_dir, output, max_chunk_chars):
+    if not docs_dir.is_dir():
+        sys.exit(f"Docs snapshot not found: {docs_dir}")
+
+    sections_by_doc = load_sections(docs_dir)
+    output.parent.mkdir(parents=True, exist_ok=True)
+    if output.exists():
+        output.unlink()
+
+    connection = sqlite3.connect(output)
+    try:
+        _check_fts5(connection)
+        connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
+        connection.execute(
+            "CREATE VIRTUAL TABLE chunks USING fts5(doc UNINDEXED, title UNINDEXED, body)"
+        )
+
+        total_chunks = 0
+        chunks_per_doc = {}
+        for doc, sections in sections_by_doc.items():
+            count = 0
+            for title, body in sections:
+                if not body:
+                    continue
+                base_title = title or "(preamble)"
+                for part, piece in enumerate(chunk_text(body, max_chunk_chars), start=1):
+                    chunk_title = base_title if part == 1 else f"{base_title} (part {part})"
+                    connection.execute(
+                        "INSERT INTO chunks (doc, title, body) VALUES (?, ?, ?)",
+                        (doc, chunk_title, piece),
+                    )
+                    count += 1
+            chunks_per_doc[doc] = count
+            total_chunks += count
+
+        metadata = {
+            "index_version": "1",
+            "pareto_version": _pareto_version(),
+            "built_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
+            "docs_dir": str(docs_dir),
+            "max_chunk_chars": max_chunk_chars,
+            "chunk_count": total_chunks,
+            "chunks_per_doc": json.dumps(chunks_per_doc),
+        }
+        connection.executemany("INSERT INTO metadata (key, value) VALUES (?, ?)", metadata.items())
+        connection.commit()
+    finally:
+        connection.close()
+
+    print(f"Docs root:      {docs_dir}")
+    for doc, count in chunks_per_doc.items():
+        print(f"  {doc:<16} {count:>4} chunks")
+    print(f"Total chunks:   {total_chunks}")
+    print(f"Index written:  {output} ({output.stat().st_size / 1024:.0f} KB)")
+
+
+def main():
+    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
+    parser.add_argument("--docs-dir", type=Path, default=DEFAULT_DOCS_DIR,
+                        help="Path to the pareto_docs snapshot (default: %(default)s)")
+    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
+                        help="Where to write the sqlite index (default: %(default)s)")
+    parser.add_argument("--max-chunk-chars", type=int, default=4000,
+                        help="Approximate maximum chunk size in characters (default: %(default)s)")
+    args = parser.parse_args()
+    build_index(args.docs_dir, args.output, args.max_chunk_chars)
+
+
+if __name__ == "__main__":
+    main()
diff --git a/backend/scripts/inspect_docs_index.py b/backend/scripts/inspect_docs_index.py
new file mode 100644
index 0000000..a18e2b2
--- /dev/null
+++ b/backend/scripts/inspect_docs_index.py
@@ -0,0 +1,93 @@
+"""Interactive browser for the PARETO docs FTS5 index.
+
+Run this in Spyder (F5 or %run) with an interpreter that has pandas installed
+(e.g. the pareto-ui pyenv). Everything below runs top-level so the variables
+and functions land in your variable explorer:
+
+    chunks_df              all indexed chunks (one row per chunk)
+    meta                   build metadata of the index
+    search("query")        full-text search, ranked results as a DataFrame
+    show(rowid)            print the full body of one chunk
+    doc("strategic")       all chunks of one doc
+
+Examples:
+    search("pipeline capacity")
+    search("trucking cost")
+    search("Removal efficiency")
+    show(12)
+    doc("water_treatment")
+"""
+import sqlite3
+from pathlib import Path
+
+import pandas as pd
+
+INDEX_PATH = Path(__file__).resolve().parents[1] / "app" / "internal" / "ai" / "pareto_docs_index.sqlite"
+
+con = sqlite3.connect(f"file:{INDEX_PATH}?mode=ro", uri=True)
+
+meta = dict(con.execute("SELECT key, value FROM metadata"))
+
+chunks_df = pd.read_sql_query(
+    "SELECT rowid, doc, title, length(body) AS chars, body FROM chunks ORDER BY doc, rowid",
+    con,
+)
+
+
+def _tokenize(query):
+    """Split a query into searchable tokens: whitespace plus camelCase boundaries."""
+    import re
+
+    tokens = []
+    for word in str(query).split():
+        tokens.extend(part for part in re.findall(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])", word) if part)
+    return tokens or [str(query)]
+
+
+def search(query, limit=10, mode="or"):
+    """Full-text search over the indexed docs.
+
+    mode="or" (default) ranks chunks matching any query word (best for natural
+    language and error messages); mode="and" requires every word (exact-ish).
+    Returns a DataFrame: doc, title, chars, match_score, snippet, body.
+    """
+    if mode == "and":
+        match = " AND ".join(f'"{token}"' for token in _tokenize(query))
+    else:
+        match = " OR ".join(f'"{token}"' for token in _tokenize(query))
+    sql = """
+        SELECT doc, title, length(body) AS chars,
+               bm25(chunks) AS match_score,
+               snippet(chunks, 2, '>', '<', ' ... ', 14) AS snippet,
+               body
+        FROM chunks
+        WHERE chunks MATCH ?
+        ORDER BY bm25(chunks)
+        LIMIT ?
+    """
+    result = pd.read_sql_query(sql, con, params=(match, limit))
+    if result.empty:
+        print(f"No matches for {query!r} (match expression: {match!r})")
+    return result
+
+
+def show(rowid):
+    """Print the full body of one chunk."""
+    row = con.execute("SELECT doc, title, body FROM chunks WHERE rowid = ?", (rowid,)).fetchone()
+    if row is None:
+        print(f"No chunk with rowid {rowid}")
+        return
+    doc, title, body = row
+    print(f"=== [{doc}] {title} (rowid {rowid}, {len(body)} chars) ===")
+    print(body)
+
+
+def doc(name):
+    """All chunks of one doc, e.g. doc('strategic'), doc('hydraulics')."""
+    return chunks_df[chunks_df["doc"].str.contains(str(name), case=False)].reset_index(drop=True)
+
+
+print(f"Index:   {INDEX_PATH}")
+print(f"Built:   {meta.get('built_at')} from {meta.get('docs_dir')}")
+print(f"Chunks:  {meta.get('chunk_count')} ({meta.get('chunks_per_doc')})")
+print("Try:  search('pipeline capacity')   show(0)   doc('strategic')")
diff --git a/backend/tests/test_ai_prompts.py b/backend/tests/test_ai_prompts.py
new file mode 100644
index 0000000..f44dde9
--- /dev/null
+++ b/backend/tests/test_ai_prompts.py
@@ -0,0 +1,231 @@
+import json
+import unittest
+from unittest import mock
+
+from app.internal import scenario_handler as handler_module
+from app.internal.scenario_handler import sanitize_ai_updated_scenario
+from app.internal.util import FormatPrompt
+
+
+class FormatPromptContractTests(unittest.TestCase):
+    def test_prompt_contains_response_contract(self):
+        prompt = FormatPrompt("fill completions demand", data={"df_parameters": {"PadRates": {}}},
+                              optimization_settings={})
+        for expected in ("'updatedScenario'", "'questions'", "'updateNotes'", "'status'",
+                         "one note per distinct change", "'questions', not in updateNotes",
+                         "Here is the prompt:", "fill completions demand", "PadRates"):
+            self.assertIn(expected, prompt)
+
+    def test_prompt_includes_validation_findings(self):
+        findings = [{"code": "missing_value", "table": "PadRates", "row": ["Pad1"], "severity": "error"}]
+        prompt = FormatPrompt("fix the issues", data={"df_parameters": {}},
+                              optimization_settings={}, validation_findings=findings)
+        self.assertIn("validation findings", prompt)
+        self.assertIn("PadRates", prompt)
+        self.assertIn("Prioritize resolving these", prompt)
+
+    def test_prompt_without_findings_omits_block(self):
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}}, optimization_settings={})
+        self.assertNotIn("validation findings", prompt)
+
+    def test_prompt_includes_units_and_defaults(self):
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}}, optimization_settings={})
+        self.assertIn("Units and defaults", prompt)
+        self.assertIn("bbl", prompt)
+        self.assertIn("not zeros", prompt)
+
+    def test_prompt_includes_model_requirements_from_settings(self):
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
+                              optimization_settings={"waterQuality": "true", "solver": "cbc"})
+        self.assertIn("Model requirements", prompt)
+        self.assertIn("water_quality", prompt)
+        self.assertIn("Enabled features: water_quality", prompt)
+
+    def test_prompt_without_settings_omits_model_requirements(self):
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}})
+        self.assertNotIn("Model requirements", prompt)
+
+    def test_multi_valued_feature_settings_are_parsed_like_the_app(self):
+        # "post_process" runs the model without those input tables; "discrete"
+        # and "co_optimize" build them into the optimization.
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
+                              optimization_settings={"waterQuality": "post_process"})
+        self.assertNotIn("Enabled features: water_quality", prompt)
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
+                              optimization_settings={"waterQuality": "discrete"})
+        self.assertIn("Enabled features: water_quality", prompt)
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
+                              optimization_settings={"hydraulics": "co_optimize"})
+        self.assertIn("Enabled features: hydraulics", prompt)
+        prompt = FormatPrompt("fill demand", data={"df_parameters": {}},
+                              optimization_settings={"hydraulics": "post_process"})
+        self.assertNotIn("Enabled features: hydraulics", prompt)
+
+
+class GenerateDataWithAIQuestionTests(unittest.TestCase):
+    def setUp(self):
+        self.scenario_id = 987654
+        handler_module.scenario_handler.scenario_list[self.scenario_id] = {
+            "id": self.scenario_id,
+            "name": "question test",
+            "optimization": {},
+            "data_input": {"df_sets": {}, "df_parameters": {"PadRates": {"T01": [1]}}},
+        }
+        self.addCleanup(handler_module.scenario_handler.scenario_list.pop, self.scenario_id, None)
+
+    def _run(self, model_answer):
+        with mock.patch.object(handler_module.cborg, "is_available", return_value=True), \
+             mock.patch.object(handler_module.cborg, "clear_history") as clear_mock, \
+             mock.patch.object(handler_module.cborg, "prompt",
+                               return_value=json.dumps(model_answer)) as prompt_mock:
+            result = handler_module.scenario_handler.generate_data_with_ai(self.scenario_id, "fill demand")
+        clear_mock.assert_called_once()
+        self.assertEqual(prompt_mock.call_args.kwargs.get("add_to_history"), False)
+        return result
+
+    def test_valid_questions_pass_through(self):
+        answer = self._run({"status": "success", "updatedScenario": {"df_parameters": {"PadRates": {"T01": [2]}}},
+                            "questions": ["Which unit should demand use?"], "updateNotes": ["updated"]})
+        self.assertEqual(answer["questions"], ["Which unit should demand use?"])
+        self.assertEqual(answer["updatedScenario"]["df_parameters"]["PadRates"], {"T01": [2]})
+
+    def test_malformed_questions_are_dropped(self):
+        answer = self._run({"status": "success", "updatedScenario": {"df_parameters": {}},
+                            "questions": "which unit?", "updateNotes": []})
+        self.assertNotIn("questions", answer)
+
+    def test_questions_survive_markdown_fences(self):
+        fenced = "```json\n" + json.dumps({"status": "success", "updatedScenario": {"df_parameters": {}},
+                                           "updateNotes": [], "questions": ["How many periods?"]}) + "\n```"
+        with mock.patch.object(handler_module.cborg, "is_available", return_value=True), \
+             mock.patch.object(handler_module.cborg, "prompt", return_value=fenced):
+            answer = handler_module.scenario_handler.generate_data_with_ai(self.scenario_id, "fill demand")
+        self.assertEqual(answer["questions"], ["How many periods?"])
+
+    def test_questions_only_response_has_no_updated_scenario(self):
+        answer = self._run({"status": "success", "updateNotes": [], "questions": ["Which pads?"]})
+        self.assertNotIn("updatedScenario", answer)
+        self.assertEqual(answer["questions"], ["Which pads?"])
+
+    def test_string_update_notes_become_a_list(self):
+        result = self._run({"status": "success", "updatedScenario": {"df_parameters": {}},
+                            "updateNotes": "No tables were changed.", "questions": ["Which pads?"]})
+        self.assertEqual(result["updateNotes"][0], "No tables were changed.")
+        self.assertTrue(any("AI guard" in note for note in result["updateNotes"]))
+
+    def test_guard_rejects_unusable_scenario_through_endpoint(self):
+        result = self._run({"status": "success", "updatedScenario": "garbage", "updateNotes": [], "questions": []})
+        self.assertEqual(result["status"], "error")
+        self.assertIn("no updates were applied", result["errorMessage"])
+        self.assertNotIn("updatedScenario", result)
+
+    def test_guard_rejection_preserves_valid_questions(self):
+        result = self._run({"status": "success", "updatedScenario": "garbage", "updateNotes": [],
+                            "questions": ["Which pads?", "Which units?"]})
+        self.assertEqual(result["status"], "error")
+        self.assertEqual(result["questions"], ["Which pads?", "Which units?"])
+
+    def test_guard_rejection_drops_malformed_questions(self):
+        result = self._run({"status": "success", "updatedScenario": "garbage", "updateNotes": [],
+                            "questions": ["Which pads?", "   ", 42]})
+        self.assertEqual(result["status"], "error")
+        self.assertNotIn("questions", result)
+
+    def test_guard_notes_are_appended_to_update_notes(self):
+        result = self._run({"status": "success",
+                            "updatedScenario": {"df_sets": {}, "df_parameters": {}},
+                            "updateNotes": ["Only sets were updated."], "questions": []})
+        self.assertEqual(result["updatedScenario"]["df_parameters"]["PadRates"], {"T01": [1]})
+        self.assertIn("Only sets were updated.", result["updateNotes"])
+        self.assertTrue(any("AI guard" in note and "dropped" in note for note in result["updateNotes"]))
+
+
+class SanitizeAiUpdatedScenarioTests(unittest.TestCase):
+    def setUp(self):
+        self.original = {
+            "df_sets": {"ProductionPads": ["P1"], "StorageSites": ["S1"]},
+            "df_parameters": {
+                "PadRates": {"ProductionPads": ["P1"], "T01": [100]},
+                "CapCost": {"ProductionPads": ["P1"], "VALUE": [10]},
+            },
+        }
+
+    def test_valid_response_passes_through(self):
+        response = {"df_sets": {"ProductionPads": ["P1"]}, "df_parameters": {"PadRates": {"T01": [200]}}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_parameters"]["PadRates"], {"T01": [200]})
+        self.assertEqual(cleaned["df_parameters"]["CapCost"], self.original["df_parameters"]["CapCost"])
+        self.assertTrue(any("dropped" in note and "CapCost" in note for note in notes))
+
+    def test_dropped_tables_are_restored(self):
+        response = {"df_sets": {}, "df_parameters": {"PadRates": {"T01": [200]}}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_parameters"]["CapCost"], self.original["df_parameters"]["CapCost"])
+        self.assertIn("CapCost", notes[0])
+
+    def test_unknown_top_level_keys_are_removed(self):
+        response = {"df_sets": {}, "df_parameters": {}, "surprise_section": {"a": 1}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertNotIn("surprise_section", cleaned)
+        self.assertTrue(any("surprise_section" in note for note in notes))
+
+    def test_malformed_table_entries_revert_to_original(self):
+        response = {"df_parameters": {"PadRates": "not a table", "Extra": [1, 2]}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_parameters"]["PadRates"], self.original["df_parameters"]["PadRates"])
+        self.assertNotIn("Extra", cleaned["df_parameters"])
+        self.assertTrue(any("malformed" in note for note in notes))
+
+    def test_new_tables_are_flagged_not_blocked(self):
+        response = {"df_parameters": {"PadRates": {"T01": [1]}, "NewCost": {"T01": [5]}}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertIn("NewCost", cleaned["df_parameters"])
+        self.assertTrue(any("NewCost" in note and "review" in note for note in notes))
+
+    def test_legacy_data_input_wrapper_is_unwrapped(self):
+        response = {"data_input": {"df_sets": {"ProductionPads": ["P1"]},
+                                   "df_parameters": {"PadRates": {"T01": [200]}}}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertNotIn("data_input", cleaned)
+        self.assertEqual(cleaned["df_parameters"]["PadRates"], {"T01": [200]})
+
+    def test_dropped_set_entries_are_restored(self):
+        response = {"df_sets": {"ProductionPads": ["P1"]}, "df_parameters": {}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_sets"]["ProductionPads"], ["P1"])
+        self.assertTrue(any("dropped set entries" in note for note in notes))
+
+    def test_malformed_set_entries_are_reverted(self):
+        response = {"df_sets": {"ProductionPads": "oops"}, "df_parameters": {}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_sets"]["ProductionPads"], ["P1"])
+        self.assertTrue(any("malformed set entries" in note for note in notes))
+
+    def test_new_set_entries_are_flagged_not_blocked(self):
+        response = {"df_sets": {"ProductionPads": ["P1"], "StorageSites": ["S1"], "RiverIntakes": ["R1"]},
+                    "df_parameters": {}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_sets"]["RiverIntakes"], ["R1"])
+        self.assertTrue(any("new set entries" in note and "RiverIntakes" in note for note in notes))
+
+    def test_omitted_df_sets_section_is_restored(self):
+        response = {"df_parameters": {"PadRates": {"T01": [200]}}}
+        cleaned, notes = sanitize_ai_updated_scenario(self.original, response)
+        self.assertEqual(cleaned["df_sets"], self.original["df_sets"])
+        self.assertTrue(any("omitted the df_sets section" in note for note in notes))
+
+    def test_original_objects_are_not_aliased(self):
+        response = {"df_parameters": {"PadRates": {"T01": [200]}}}
+        cleaned, _ = sanitize_ai_updated_scenario(self.original, response)
+        cleaned["df_parameters"]["PadRates"]["T01"][0] = 999
+        self.assertEqual(self.original["df_parameters"]["PadRates"]["T01"][0], 100)
+
+    def test_unusable_responses_return_none(self):
+        for bad in ("a string", 42, {"df_sets": {}}, None):
+            cleaned, notes = sanitize_ai_updated_scenario(self.original, bad)
+            self.assertIsNone(cleaned)
+            self.assertTrue(notes and "no updates were applied" in notes[0])
+
+
+if __name__ == "__main__":
+    unittest.main()
diff --git a/backend/tests/test_docs_retrieval.py b/backend/tests/test_docs_retrieval.py
new file mode 100644
index 0000000..818147a
--- /dev/null
+++ b/backend/tests/test_docs_retrieval.py
@@ -0,0 +1,136 @@
+import os
+import sqlite3
+import tempfile
+import unittest
+from pathlib import Path
+from unittest import mock
+
+from app.internal.ai import docs
+
+
+def _build_index(path, rows, metadata=None):
+    connection = sqlite3.connect(path)
+    try:
+        connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
+        connection.execute(
+            "CREATE VIRTUAL TABLE chunks USING fts5(doc UNINDEXED, title UNINDEXED, body)"
+        )
+        connection.executemany(
+            "INSERT INTO chunks (doc, title, body) VALUES (?, ?, ?)", rows
+        )
+        if metadata:
+            connection.executemany(
+                "INSERT INTO metadata (key, value) VALUES (?, ?)", metadata.items()
+            )
+        connection.commit()
+    finally:
+        connection.close()
+
+
+class DocsRetrievalTests(unittest.TestCase):
+    def setUp(self):
+        self._tmp = tempfile.TemporaryDirectory()
+        self.index_path = Path(self._tmp.name) / "index.sqlite"
+        _build_index(self.index_path, [
+            ("strategic", "Terminology", "A wellpad is a site where completions water is generated."),
+            ("strategic", "Mathematical Program Formulation (part 3)",
+             "Pipeline capacity constraints limit flow between nodes; the initial pipeline capacity "
+             "may be expanded with 1 if pipeline expansion is enabled."),
+            ("water_treatment", "Treatment Component Removal Efficiency",
+             "Removal efficiency describes the fraction of a water quality component removed by a treatment site."),
+            ("strategic", "Strategic Model Mathematical Notation (part 5)",
+             "The hourly trucking cost applies to each trucked route per period."),
+        ])
+        self._previous = os.environ.get("PARETO_DOCS_INDEX")
+        os.environ["PARETO_DOCS_INDEX"] = str(self.index_path)
+
+    def _rebuild_index(self, rows, metadata=None):
+        os.remove(self.index_path)
+        _build_index(self.index_path, rows, metadata)
+        docs._index_connections.clear()
+
+    def tearDown(self):
+        if self._previous is None:
+            os.environ.pop("PARETO_DOCS_INDEX", None)
+        else:
+            os.environ["PARETO_DOCS_INDEX"] = self._previous
+        self._tmp.cleanup()
+
+    def test_query_tokens_split_camelcase_and_drop_stopwords(self):
+        tokens = docs.query_tokens("Why is TruckingHourlyCost exceeded on the Pipeline for X1?")
+        self.assertIn("trucking", tokens)
+        self.assertIn("hourly", tokens)
+        self.assertIn("cost", tokens)
+        self.assertIn("pipeline", tokens)
+        self.assertNotIn("the", tokens)
+        self.assertNotIn("why", tokens)
+
+    def test_retrieval_includes_relevant_chunk(self):
+        result = docs.diagnosis_reference_docs({}, "pipeline capacity exceeded, model infeasible")
+        self.assertIn("Pipeline capacity constraints", result)
+        self.assertIn("[strategic]", result)
+
+    def test_camel_case_query_matches_worded_doc(self):
+        result = docs.prompt_reference_docs({}, "adjust TruckingHourlyCost for all routes")
+        self.assertIn("hourly trucking cost", result)
+
+    def test_terminology_always_included_even_without_matches(self):
+        result = docs.prompt_reference_docs({}, "zzzqqq unrelated gibberish")
+        self.assertIn("Terminology", result)
+        self.assertIn("wellpad", result)
+        self.assertNotIn("Pipeline capacity constraints", result)
+
+    def test_diagnostics_budget_limits_total_size(self):
+        big_body = "pipeline capacity " + ("filler sentence about capacity. " * 400)
+        self._rebuild_index([
+            ("strategic", f"Big section (part {part})", big_body) for part in range(1, 21)
+        ] + [("strategic", "Terminology", "terminology body")])
+        result = docs.diagnosis_reference_docs({}, "pipeline capacity")
+        self.assertLessEqual(len(result), 1000 + 32000 + 2000)
+
+    def test_missing_index_returns_empty_without_failing(self):
+        os.environ["PARETO_DOCS_INDEX"] = str(Path(self._tmp.name) / "missing.sqlite")
+        self.assertEqual(docs.prompt_reference_docs({}, "anything"), "")
+        self.assertEqual(docs.diagnosis_reference_docs({}, "anything"), "")
+
+    def test_enabled_feature_settings_bias_retrieval(self):
+        self._rebuild_index([
+            ("strategic", "Terminology", "terminology body"),
+            ("water_treatment", "Water Quality Components",
+             "Water quality components define concentration limits that reuse must satisfy."),
+        ])
+        plain = docs.prompt_reference_docs({}, "fill the demand inputs")
+        self.assertNotIn("Water Quality Components", plain)
+        biased = docs.prompt_reference_docs({"waterQuality": "true"}, "fill the demand inputs")
+        self.assertIn("Water Quality Components", biased)
+
+    def test_header_records_docs_version_and_warns_on_mismatch(self):
+        self._rebuild_index([
+            ("strategic", "Terminology", "terminology body"),
+        ], metadata={"pareto_version": "1.0.0", "built_at": "2026-01-15T00:00:00Z"})
+        with mock.patch.object(docs, "_installed_pareto_version", return_value="9.9.9"):
+            result = docs.prompt_reference_docs({}, "fill demand")
+        self.assertIn("grounded in PARETO 1.0.0", result)
+        self.assertIn("WARNING", result)
+        self.assertIn("9.9.9", result)
+        self.assertIn("docs built 2026-01-15", result)
+
+    def test_header_has_no_warning_when_versions_match(self):
+        self._rebuild_index([
+            ("strategic", "Terminology", "terminology body"),
+        ], metadata={"pareto_version": "1.2.dev0"})
+        with mock.patch.object(docs, "_installed_pareto_version", return_value="1.2.dev0"):
+            result = docs.prompt_reference_docs({}, "fill demand")
+        self.assertIn("grounded in PARETO 1.2.dev0", result)
+        self.assertNotIn("WARNING", result)
+
+    def test_header_falls_back_to_installed_version_without_metadata(self):
+        with mock.patch.object(docs, "_installed_pareto_version", return_value="1.2.dev0"):
+            result = docs.prompt_reference_docs({}, "fill demand")
+        self.assertIn("does not record", result)
+        self.assertIn("1.2.dev0", result)
+        self.assertNotIn("WARNING", result)
+
+
+if __name__ == "__main__":
+    unittest.main()
diff --git a/electron/ui/src/components/AIPromptDialog/AIPromptDialog.tsx b/electron/ui/src/components/AIPromptDialog/AIPromptDialog.tsx
index ce2d02a..856c637 100644
--- a/electron/ui/src/components/AIPromptDialog/AIPromptDialog.tsx
+++ b/electron/ui/src/components/AIPromptDialog/AIPromptDialog.tsx
@@ -1,5 +1,6 @@
-import React, { useMemo, useState } from "react";
+import React, { useEffect, useMemo, useState } from "react";
 import {
+  Alert,
   Box,
   Button,
   Chip,
@@ -23,24 +24,107 @@ interface AIPromptDialogProps {
   onClose: () => void;
   scenarioId: string | number | null | undefined;
   scenarioName?: string;
+  validationFindings?: unknown;
+  onApplied?: () => void;
+}
+
+const DIFF_PREVIEW_ROWS = 6;
+
+interface DiffTableData {
+  key: string;
+  columns: string[];
+  rows: Array<{ index: number; cells: any[]; changed: boolean[] }>;
+  totalChangedRows: number;
+}
+
+function DiffTable({ table, expanded, onToggle }: { table: DiffTableData; expanded: boolean; onToggle: () => void }): JSX.Element {
+  const visibleRows = expanded ? table.rows : table.rows.slice(0, DIFF_PREVIEW_ROWS);
+  const hasMore = table.rows.length > DIFF_PREVIEW_ROWS;
+  const headerCell = { fontWeight: 600, color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" } as const;
+  return (
+    <Box sx={{ px: 2, py: 1.5, overflowX: "auto" }}>
+      <Box
+        sx={{
+          display: "grid",
+          gridTemplateColumns: `minmax(36px, 48px) repeat(${table.columns.length}, minmax(120px, 1fr))`,
+          gap: 1.5,
+          fontSize: "0.75rem",
+          minWidth: `${(table.columns.length + 1) * 120}px`,
+        }}
+      >
+        <Box sx={headerCell}>#</Box>
+        {table.columns.map((col) => (
+          <Box key={col} sx={headerCell}>
+            {col}
+          </Box>
+        ))}
+        {visibleRows.map((row) => (
+          <React.Fragment key={`${table.key}-${row.index}`}>
+            <Box sx={{ color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}>{row.index + 1}</Box>
+            {row.cells.map((cell, idx) => (
+              <Box
+                key={`${table.key}-${row.index}-${idx}`}
+                sx={{
+                  px: 0.5,
+                  py: 0.25,
+                  borderRadius: 1,
+                  minWidth: 0,
+                  overflowWrap: "anywhere",
+                  border: row.changed[idx]
+                    ? "1px solid rgba(1, 103, 143, 0.55)"
+                    : "1px solid rgba(0, 0, 0, 0.08)",
+                  bgcolor: row.changed[idx] ? "rgba(1, 103, 143, 0.22)" : "transparent",
+                  color: row.changed[idx] ? "text.primary" : "text.secondary",
+                  fontWeight: row.changed[idx] ? 600 : 400,
+                  opacity: row.changed[idx] ? 1 : 0.55,
+                }}
+              >
+                {cell}
+              </Box>
+            ))}
+          </React.Fragment>
+        ))}
+      </Box>
+      <Box sx={{ mt: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
+        <Typography variant="caption" color="text.secondary">
+          {table.totalChangedRows === 0
+            ? "No row-level changes detected."
+            : !hasMore || expanded
+              ? `Showing all ${table.totalChangedRows} changed rows.`
+              : `Showing ${DIFF_PREVIEW_ROWS} of ${table.totalChangedRows} changed rows.`}
+        </Typography>
+        {hasMore && (
+          <Button size="small" variant="text" onClick={onToggle}>
+            {expanded ? "Show fewer" : `Show all ${table.totalChangedRows} rows`}
+          </Button>
+        )}
+      </Box>
+    </Box>
+  );
 }
 
 export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element {
-  const { open, onClose, scenarioId, scenarioName } = props;
+  const { open, onClose, scenarioId, scenarioName, validationFindings, onApplied } = props;
   const { status: requestStatus, isRunning, updatedScenario: requestUpdates, updateNotes: requestNotes,
-    errorMessage: requestError, requestKind, requestScenarioId, runPrompt, clearResult } = useAIPrompt();
+    questions: requestQuestions, errorMessage: requestError, requestKind, requestScenarioId, runPrompt, clearResult } = useAIPrompt();
   const { scenarioData, handleScenarioUpdate } = useScenario();
   const matchesScenario = requestKind === 'data-update' && scenarioId != null &&
     requestScenarioId === Number(scenarioId) && requestScenarioId === scenarioData?.id;
   const status = matchesScenario ? requestStatus : 'idle';
   const updatedScenario = matchesScenario ? requestUpdates : null;
   const updateNotes = useMemo(() => matchesScenario ? requestNotes : [], [matchesScenario, requestNotes]);
+  const questions = useMemo(() => matchesScenario ? requestQuestions : [], [matchesScenario, requestQuestions]);
   const errorMessage = matchesScenario ? requestError : null;
   const [prompt, setPrompt] = useState("");
   const [promptError, setPromptError] = useState<string | null>(null);
   const [viewMode, setViewMode] = useState<"notes" | "diff">("notes");
+  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
   const aiDataInput = updatedScenario;
 
+  useEffect(() => {
+    setExpandedTables(new Set());
+  }, [updatedScenario]);
+
   const statusLabel = useMemo(() => {
     if (status === "running") return "Running";
     if (status === "success") return "Completed";
@@ -55,10 +139,14 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
       return;
     }
     setPromptError(null);
-    await runPrompt(scenarioId, trimmed);
+    await runPrompt(scenarioId, trimmed, validationFindings);
+  };
+
+  const handleQuestionClick = (question: string): void => {
+    setPrompt((current) => (current.trim() ? `${current.trim()}\n${question}` : question));
   };
 
-  const handleSaveUpdates = (): void => {
+  const handleSaveUpdates = async (): Promise<void> => {
     if (!scenarioData || !updatedScenario) return;
     const mergedScenario = {
       ...scenarioData,
@@ -67,7 +155,20 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
         ...aiDataInput,
       },
     };
-    handleScenarioUpdate(mergedScenario, false, "json");
+    const saved = await handleScenarioUpdate(mergedScenario, false, "json");
+    if (saved) onApplied?.();
+  };
+
+  const toggleTableExpanded = (key: string): void => {
+    setExpandedTables((current) => {
+      const next = new Set(current);
+      if (next.has(key)) {
+        next.delete(key);
+      } else {
+        next.add(key);
+      }
+      return next;
+    });
   };
 
   const handleClearPrompt = (): void => {
@@ -88,7 +189,16 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
       note
         .replace(/df_parameters\[['"]([^'"]+)['"]\]/g, "$1")
         .replace(/df_parameters\./g, "");
-    return updateNotes.map(stripPrefix);
+    const bullets: string[] = [];
+    updateNotes.forEach((note) => {
+      stripPrefix(note)
+        .split(/\n+/)
+        .forEach((line) => {
+          const cleaned = line.trim().replace(/^[-*•]\s+/, "").trim();
+          if (cleaned) bullets.push(cleaned);
+        });
+    });
+    return bullets;
   }, [updateNotes]);
   const diffTables = useMemo(() => {
     if (!scenarioData || !aiDataInput) return [];
@@ -100,7 +210,6 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
       columns: string[];
       rows: Array<{ index: number; cells: any[]; changed: boolean[] }>;
       totalChangedRows: number;
-      hasMoreRows: boolean;
       nonTabular: boolean;
     }> = [];
 
@@ -131,7 +240,6 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
           columns: [],
           rows: [],
           totalChangedRows: 0,
-          hasMoreRows: false,
           nonTabular: true,
         });
         return;
@@ -171,17 +279,11 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
         }
       }
 
-      const previewRows = changedRows.slice(0, 6);
       tableDiffs.push({
         key: tableKey,
-        columns: columnKeys.slice(0, 6),
-        rows: previewRows.map((row) => ({
-          ...row,
-          cells: row.cells.slice(0, 6),
-          changed: row.changed.slice(0, 6),
-        })),
+        columns: columnKeys,
+        rows: changedRows,
         totalChangedRows: changedRows.length,
-        hasMoreRows: changedRows.length > previewRows.length,
         nonTabular: false,
       });
     });
@@ -194,7 +296,7 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
       open={open}
       onClose={handleClose}
       fullWidth
-      maxWidth="sm"
+      maxWidth="md"
       PaperProps={{
         sx: {
           borderRadius: 3,
@@ -223,6 +325,11 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
         </Stack>
       </DialogTitle>
       <DialogContent sx={{ pt: 1 }}>
+        {validationFindings != null && (
+          <Alert severity="info" sx={{ mb: 1 }}>
+            The current validation findings will be shared with the AI so it can target them.
+          </Alert>
+        )}
         <TextField
           value={prompt}
           onChange={(event) => setPrompt(event.target.value)}
@@ -248,6 +355,26 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
             {errorMessage}
           </Typography>
         )}
+        {questions.length > 0 && (
+          <Box sx={{ mt: 2, p: 2, borderRadius: 2, bgcolor: "rgba(237, 108, 2, 0.08)", border: "1px solid rgba(237, 108, 2, 0.35)" }}>
+            <Typography variant="subtitle2" sx={{ mb: 1 }}>
+              The assistant needs more information before it can proceed. Click a question to answer it:
+            </Typography>
+            <Stack spacing={0.5}>
+              {questions.map((question) => (
+                <Button
+                  key={question}
+                  onClick={() => handleQuestionClick(question)}
+                  variant="text"
+                  color="inherit"
+                  sx={{ justifyContent: "flex-start", textTransform: "none", px: 1, py: 0.25, textAlign: "left" }}
+                >
+                  {question}
+                </Button>
+              ))}
+            </Stack>
+          </Box>
+        )}
         {showSuccessPanel && (
           <Box sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: "rgba(1, 103, 143, 0.08)" }}>
             <Tabs
@@ -299,56 +426,7 @@ export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element
                         </Typography>
                       </Box>
                     ) : (
-                      <Box sx={{ px: 2, py: 1.5, overflowX: "auto" }}>
-                        <Box
-                          sx={{
-                            display: "grid",
-                            gridTemplateColumns: `minmax(36px, 48px) repeat(${table.columns.length}, minmax(120px, 1fr))`,
-                            gap: 1.5,
-                            fontSize: "0.75rem",
-                            minWidth: `${(table.columns.length + 1) * 120}px`,
-                          }}
-                        >
-                          <Box sx={{ fontWeight: 600, color: "text.secondary" }}>#</Box>
-                          {table.columns.map((col) => (
-                            <Box key={col} sx={{ fontWeight: 600, color: "text.secondary" }}>
-                              {col}
-                            </Box>
-                          ))}
-                          {table.rows.map((row) => (
-                            <React.Fragment key={`${table.key}-${row.index}`}>
-                              <Box sx={{ color: "text.secondary" }}>{row.index + 1}</Box>
-                              {row.cells.map((cell, idx) => (
-                                <Box
-                                  key={`${table.key}-${row.index}-${idx}`}
-                                  sx={{
-                                    px: 0.5,
-                                    py: 0.25,
-                                    borderRadius: 1,
-                                    border: row.changed[idx]
-                                      ? "1px solid rgba(1, 103, 143, 0.55)"
-                                      : "1px solid rgba(0, 0, 0, 0.08)",
-                                    bgcolor: row.changed[idx] ? "rgba(1, 103, 143, 0.22)" : "transparent",
-                                    color: row.changed[idx] ? "text.primary" : "text.secondary",
-                                    fontWeight: row.changed[idx] ? 600 : 400,
-                                    opacity: row.changed[idx] ? 1 : 0.55,
-                                  }}
-                                >
-                                  {cell}
-                                </Box>
-                              ))}
-                            </React.Fragment>
-                          ))}
-                        </Box>
-                        <Box sx={{ mt: 1 }}>
-                          <Typography variant="caption" color="text.secondary">
-                            {table.totalChangedRows === 0
-                              ? "No row-level changes detected."
-                              : `Showing ${table.rows.length} of ${table.totalChangedRows} changed rows.`}
-                            {table.hasMoreRows ? " Refine your prompt or review full data after saving." : ""}
-                          </Typography>
-                        </Box>
-                      </Box>
+                      <DiffTable table={table} expanded={expandedTables.has(table.key)} onToggle={() => toggleTableExpanded(table.key)} />
                     )}
                   </Box>
                 ))}
diff --git a/electron/ui/src/components/Bottombar/Bottombar.tsx b/electron/ui/src/components/Bottombar/Bottombar.tsx
index 3c7df1c..1081871 100644
--- a/electron/ui/src/components/Bottombar/Bottombar.tsx
+++ b/electron/ui/src/components/Bottombar/Bottombar.tsx
@@ -50,6 +50,7 @@ export default function Bottombar(props) {
     const [ showModalError, setShowModalError ] = useState(false)
     const [ modalError, setModalError ] = useState('')
     const [ openAIPrompt, setOpenAIPrompt ] = useState(false)
+    const [ aiValidationFindings, setAiValidationFindings ] = useState<ScenarioValidation | null>(null)
     const [ key, setKey ] =  useState(null)
     const [ hasOverride, setHasOverride ] = useState(false)
     const [ openValidationDialog, setOpenValidationDialog ] = useState(false)
@@ -61,13 +62,30 @@ export default function Bottombar(props) {
     useEffect(() => {
       setValidationResult(null); setValidationLoading(false); setValidationAdvancing(false); setValidationError(null);
       setOpenValidationDialog(false);
+      setAiValidationFindings(null);
       return () => { validationVersion.current += 1; };
     }, [id, scenario?.input_revision, props.saving, inputDataEdited]);
     const handleOpenSaveModal = () => setOpenSaveModal(true);
     const handleCloseSaveModal = () => setOpenSaveModal(false);
     const handleCloseRerunModal = () => setOpenRerunModal(false);
-    const handleOpenAIPrompt = () => setOpenAIPrompt(true);
-    const handleCloseAIPrompt = () => setOpenAIPrompt(false);
+    const handleOpenAIPrompt = () => {
+      // Ground standalone fills too: attach the latest validation findings when
+      // the dialog was not opened through "Fix with AI".
+      if (!aiValidationFindings && validationResult) {
+        setAiValidationFindings(validationResult);
+      }
+      setOpenAIPrompt(true);
+    };
+    const handleCloseAIPrompt = () => { setOpenAIPrompt(false); setAiValidationFindings(null); };
+    const handleFixValidationWithAI = (result: ScenarioValidation) => {
+      setOpenValidationDialog(false);
+      setAiValidationFindings(result);
+      setOpenAIPrompt(true);
+    };
+    const handleAIUpdatesApplied = () => {
+      handleCloseAIPrompt();
+      handleValidateScenario();
+    };
     const handleCloseValidationDialog = () => setOpenValidationDialog(false);
 
 
@@ -349,6 +367,8 @@ export default function Bottombar(props) {
         onClose={handleCloseAIPrompt}
         scenarioId={id}
         scenarioName={name}
+        validationFindings={aiValidationFindings}
+        onApplied={handleAIUpdatesApplied}
       />}
       <ScenarioValidationDialog
         open={openValidationDialog}
@@ -360,6 +380,7 @@ export default function Bottombar(props) {
         onSelectTable={handleSelectValidationTable}
         onCheckFeasibility={() => handleValidateScenario(true)}
         onSelectIssue={issue => { setOpenValidationDialog(false); props.focusInputIssue?.(issue); }}
+        onAskAI={handleFixValidationWithAI}
         onClose={handleCloseValidationDialog}
       />
     </Box>
diff --git a/electron/ui/src/components/ScenarioValidationDialog/ScenarioValidationDialog.tsx b/electron/ui/src/components/ScenarioValidationDialog/ScenarioValidationDialog.tsx
index 9cff7d9..f0f871a 100644
--- a/electron/ui/src/components/ScenarioValidationDialog/ScenarioValidationDialog.tsx
+++ b/electron/ui/src/components/ScenarioValidationDialog/ScenarioValidationDialog.tsx
@@ -13,10 +13,10 @@ const STATES: Record<string, string> = {
 };
 
 export default function ScenarioValidationDialog({open, loading, advancing = false, error, result,
-  onAdvance, onCheckFeasibility, onSelectIssue, onSelectTable, onClose}: {
+  onAdvance, onCheckFeasibility, onSelectIssue, onSelectTable, onAskAI, onClose}: {
   open: boolean; loading: boolean; advancing?: boolean; error?: string | null; result?: ScenarioValidation | null;
   onAdvance?: () => void; onCheckFeasibility?: () => void; onSelectIssue?: (issue: ValidationIssue) => void;
-  onSelectTable?: (table: string) => void; onClose: () => void;
+  onSelectTable?: (table: string) => void; onAskAI?: (result: ScenarioValidation) => void; onClose: () => void;
 }) {
   const issues = result?.issues || [];
   return <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="md">
@@ -37,6 +37,7 @@ export default function ScenarioValidationDialog({open, loading, advancing = fal
       </>}
     </DialogContent>
     <DialogActions>
+      {!loading && result && onAskAI && (issues.length > 0 || result.state === 'infeasible') && <Button onClick={() => onAskAI(result)} variant="outlined">Fix with AI</Button>}
       {!loading && result?.valid && onCheckFeasibility && result.feasibility !== 'feasible' && <Button onClick={onCheckFeasibility} variant="outlined">Check feasibility</Button>}
       {!loading && !error && result?.valid && result.state !== 'outdated' && <Button onClick={onAdvance} disabled={advancing} variant="contained">Advance to Optimization Setup</Button>}
       <Button onClick={onClose} disabled={loading}>Close</Button>
diff --git a/electron/ui/src/context/AIPromptContext.tsx b/electron/ui/src/context/AIPromptContext.tsx
index b2618ed..dc190d1 100644
--- a/electron/ui/src/context/AIPromptContext.tsx
+++ b/electron/ui/src/context/AIPromptContext.tsx
@@ -22,9 +22,10 @@ export interface AIPromptContextValue {
   diagnosis: AIOptimizationDiagnosisResponse | null;
   updatedScenario: AIPromptUpdatedScenario | null;
   updateNotes: string[];
+  questions: string[];
   errorMessage: string | null;
   lastPrompt: string | null;
-  runPrompt: (scenarioId: string | number, prompt: string) => Promise<void>;
+  runPrompt: (scenarioId: string | number, prompt: string, validationFindings?: unknown) => Promise<void>;
   runOptimizationDiagnosis: (scenarioId: string | number, errorMessage: string) => Promise<void>;
   clearResult: () => void;
 }
@@ -59,6 +60,7 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
   const [errorMessage, setErrorMessage] = useState<string | null>(null);
   const [updatedScenario, setUpdatedScenario] = useState<AIPromptUpdatedScenario | null>(null);
   const [updateNotes, setUpdateNotes] = useState<string[]>([]);
+  const [questions, setQuestions] = useState<string[]>([]);
   const [lastPrompt, setLastPrompt] = useState<string | null>(null);
 
   useEffect(() => {
@@ -93,6 +95,7 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
     kind: Exclude<AIPromptRequestKind, null>,
     id: string | number,
     text: string,
+    validationFindings?: unknown,
   ): Promise<void> => {
     if (!isAvailable || requestPending.current) return;
     requestPending.current = true;
@@ -105,22 +108,27 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
     setDiagnosis(null);
     setUpdatedScenario(null);
     setUpdateNotes([]);
+    setQuestions([]);
     setLastPrompt(text);
 
     try {
       const idNumber = parseScenarioId(id);
       setRequestScenarioId(idNumber);
       if (kind === 'data-update') {
-        const payload = await requestAIDataUpdate(port, idNumber, text);
+        const payload = await requestAIDataUpdate(port, idNumber, text, validationFindings);
         if (version !== requestVersion.current) return;
         setResponse(payload);
         if (payload.status === 'error') {
           setErrorMessage(payload.errorMessage || payload.error || 'AI request failed.');
+          // The guard can reject an unusable scenario while the response still
+          // carries valid questions; surface them for a follow-up.
+          setQuestions(payload.questions || []);
           setStatus('error');
           return;
         }
         setUpdatedScenario(payload.updatedScenario || null);
         setUpdateNotes(payload.updateNotes || []);
+        setQuestions(payload.questions || []);
       } else {
         const payload = await requestAIOptimizationDiagnosis(port, idNumber, text);
         if (version !== requestVersion.current) return;
@@ -141,8 +149,8 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
     }
   };
 
-  const runPrompt = (id: string | number, prompt: string): Promise<void> =>
-    runRequest('data-update', id, prompt);
+  const runPrompt = (id: string | number, prompt: string, validationFindings?: unknown): Promise<void> =>
+    runRequest('data-update', id, prompt, validationFindings);
   const runOptimizationDiagnosis = (id: string | number, message: string): Promise<void> =>
     runRequest('optimization-diagnosis', id, message);
 
@@ -157,6 +165,7 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
     setDiagnosis(null);
     setUpdatedScenario(null);
     setUpdateNotes([]);
+    setQuestions([]);
     setLastPrompt(null);
   };
 
@@ -172,6 +181,7 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
       diagnosis,
       updatedScenario,
       updateNotes,
+      questions,
       errorMessage,
       lastPrompt,
       runPrompt,
@@ -187,6 +197,7 @@ export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children })
       diagnosis,
       updatedScenario,
       updateNotes,
+      questions,
       errorMessage,
       lastPrompt,
     ],
diff --git a/electron/ui/src/services/app.service.ts b/electron/ui/src/services/app.service.ts
index b4f1024..575e7f2 100644
--- a/electron/ui/src/services/app.service.ts
+++ b/electron/ui/src/services/app.service.ts
@@ -192,13 +192,13 @@ export const saveAISettings = (backend_port: number, settings: {api_key?: string
 export const resetAISettings = (backend_port: number): Promise<AIBackendSettings> =>
     requestJson(`${BACKEND_URL}:${backend_port}/ai_settings`, decodeAIBackendSettings, {method: 'DELETE'});
 
-export const requestAIDataUpdate = async (backend_port: number, id: ScenarioId, prompt: string): Promise<AIPromptResponse> => {
+export const requestAIDataUpdate = async (backend_port: number, id: ScenarioId, prompt: string, validationFindings?: unknown): Promise<AIPromptResponse> => {
     const endpoint = `${BACKEND_URL}:${backend_port}/request_ai_data_update/${scenarioId(id)}`
     return requestJson(endpoint, decodeAIPromptResponse, {
-        method: 'POST', 
+        method: 'POST',
         mode: 'cors',
         headers: {'Content-Type': 'application/json'},
-        body: JSON.stringify({"prompt": prompt})
+        body: JSON.stringify(validationFindings != null ? {"prompt": prompt, "validation_findings": validationFindings} : {"prompt": prompt})
     });
 }
 
diff --git a/electron/ui/src/services/contracts/ai.ts b/electron/ui/src/services/contracts/ai.ts
index b72610f..a69ad92 100644
--- a/electron/ui/src/services/contracts/ai.ts
+++ b/electron/ui/src/services/contracts/ai.ts
@@ -102,10 +102,11 @@ const failure = (value: unknown, path: string): AIPromptResponse | null => {
     error: optional(string),
     errorMessage: optional(string),
     detail: optional(string),
+    questions: optional(array(string)),
   })(value, path);
   const message = body.errorMessage || body.detail || body.error;
   if (!message?.trim()) throw new DecodeError(path, 'an AI error message');
-  return { status: 'error', errorMessage: message };
+  return { status: 'error', errorMessage: message, questions: body.questions };
 };
 
 export const decodeAIPromptResponse: Decoder<AIPromptResponse> = (value, path) => {
@@ -113,14 +114,20 @@ export const decodeAIPromptResponse: Decoder<AIPromptResponse> = (value, path) =
   if (error) return error;
   const result = object({
     status: literal('success'),
-    updatedScenario: unknown,
+    updatedScenario: optional(unknown),
     updateNotes: optional(array(string)),
     updatedNotes: optional(array(string)),
+    questions: optional(array(string)),
   })(value, path);
+  if (result.updatedScenario === undefined && result.questions === undefined)
+    throw new DecodeError(path, 'an AI response with updates or questions');
   return {
     status: 'success',
-    updatedScenario: updatedInputs(result.updatedScenario, `${path}.updatedScenario`),
+    updatedScenario: result.updatedScenario !== undefined
+      ? updatedInputs(result.updatedScenario, `${path}.updatedScenario`)
+      : undefined,
     updateNotes: result.updateNotes ?? result.updatedNotes,
+    questions: result.questions,
   };
 };
 
diff --git a/electron/ui/src/tests/aicontracts.test.ts b/electron/ui/src/tests/aicontracts.test.ts
index 06e381b..a53beba 100644
--- a/electron/ui/src/tests/aicontracts.test.ts
+++ b/electron/ui/src/tests/aicontracts.test.ts
@@ -251,3 +251,13 @@ test('invalid scenario IDs fail before sending a paid AI request', async () => {
   });
   expect(global.fetch).not.toHaveBeenCalled();
 });
+
+test('a questions-only AI response is valid and carries no scenario', async () => {
+  respond({ status: 'success', questions: ['Which unit should demand use?'], updateNotes: [] });
+  const result = await requestAIDataUpdate(50011, 0, 'Fill');
+  expect(result).toEqual({
+    status: 'success',
+    updateNotes: [],
+    questions: ['Which unit should demand use?'],
+  });
+});
diff --git a/electron/ui/src/tests/aiprompt.test.tsx b/electron/ui/src/tests/aiprompt.test.tsx
index e547280..8a10cb1 100644
--- a/electron/ui/src/tests/aiprompt.test.tsx
+++ b/electron/ui/src/tests/aiprompt.test.tsx
@@ -185,3 +185,65 @@ test('malformed diagnosis never reports success and an explicit retry can recove
   expect(context.status).toBe('success');
   expect(context.diagnosis).toEqual(diagnosis);
 });
+
+test('validation findings are sent with the fill request when provided', async () => {
+  render(<View />);
+  await waitFor(() => expect(context.isAvailable).toBe(true));
+  const findings = [{ code: 'missing_value', table: 'PadRates', severity: 'error' }];
+  act(() => {
+    void context.runPrompt(0, 'Fix the findings', findings);
+  });
+  expect(requests).toHaveLength(1);
+  const updateCall = (global.fetch as jest.Mock).mock.calls.find((call) =>
+    String(call[0]).includes('request_ai_data_update'));
+  const body = JSON.parse(updateCall[1].body);
+  expect(body.prompt).toBe('Fix the findings');
+  expect(body.validation_findings).toEqual(findings);
+  await act(async () => requests[0].resolve(response(filled)));
+  expect(context.status).toBe('success');
+});
+
+test('multi-line update notes render as one scannable bullet per line', async () => {
+  render(<View dialog />);
+  await waitFor(() => expect(context.isAvailable).toBe(true));
+  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill' } });
+  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
+  await act(async () => requests[0].resolve(response({
+    status: 'success',
+    updatedScenario: { df_parameters: { PadRates: { T01: [0] } } },
+    updateNotes: ['Interpreted the request as filling missing set data.\n- df_sets: added ProductionPads [PP01]\n- df_sets: added StorageSites [S02]'],
+  })));
+  expect(screen.getByText('Interpreted the request as filling missing set data.')).toBeVisible();
+  expect(screen.getByText('df_sets: added ProductionPads [PP01]')).toBeVisible();
+  expect(screen.getByText('df_sets: added StorageSites [S02]')).toBeVisible();
+});
+
+test('a guard rejection with questions surfaces the questions for a follow-up', async () => {
+  render(<View dialog />);
+  await waitFor(() => expect(context.isAvailable).toBe(true));
+  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill' } });
+  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
+  await act(async () => requests[0].resolve(response({
+    status: 'error',
+    errorMessage: 'The AI response did not include the df_parameters input tables, so no updates were applied.',
+    questions: ['Which pads should demand use?'],
+  })));
+  expect(context.status).toBe('error');
+  expect(context.questions).toEqual(['Which pads should demand use?']);
+  expect(screen.getByRole('button', { name: 'Which pads should demand use?' })).toBeVisible();
+});
+
+test('questions without a patch are surfaced for a follow-up instead of a save preview', async () => {
+  render(<View dialog />);
+  await waitFor(() => expect(context.isAvailable).toBe(true));
+  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill demand' } });
+  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
+  await act(async () => requests[0].resolve(response({
+    status: 'success', updateNotes: [], questions: ['Which unit should demand use?'],
+  })));
+  expect(context.questions).toEqual(['Which unit should demand use?']);
+  expect(context.status).toBe('success');
+  expect(screen.queryByRole('button', { name: 'Save Updates' })).not.toBeInTheDocument();
+  fireEvent.click(screen.getByRole('button', { name: 'Which unit should demand use?' }));
+  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Which unit should demand use?');
+});
diff --git a/electron/ui/src/tests/bottombar.test.tsx b/electron/ui/src/tests/bottombar.test.tsx
index eb3eda0..10a9ec7 100644
--- a/electron/ui/src/tests/bottombar.test.tsx
+++ b/electron/ui/src/tests/bottombar.test.tsx
@@ -1,13 +1,24 @@
-import { render, screen } from '@testing-library/react';
+import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
 import Bottombar from "../components/Bottombar/Bottombar"
 import mockScenario from './data/mockScenario.json'
 import * as React from 'react'
+import { modelBuilt } from './fixtures/validation';
 
-jest.mock("../components/AIPromptDialog/AIPromptDialog", () => () => null);
+let dialogProps: any = null;
+jest.mock("../components/AIPromptDialog/AIPromptDialog", () => (props: any) => {
+  dialogProps = props;
+  return null;
+});
 let mockAIAvailable = false;
 jest.mock("../context/AIPromptContext", () => ({useAIPrompt: () => ({isAvailable: mockAIAvailable})}));
 
-beforeEach(() => { mockAIAvailable = false; });
+const originalFetch = global.fetch;
+beforeEach(() => {
+  mockAIAvailable = false;
+  dialogProps = null;
+  global.fetch = originalFetch;
+});
+afterEach(() => { global.fetch = originalFetch; });
 
 const mockFunction = () => {
     console.log("function");
@@ -24,6 +35,25 @@ test.each([false, true])('AI input filling follows availability (%s)', (availabl
     expect(screen.getByRole('button', {name: /Generate Spreadsheet From Network/i})).toBeEnabled();
 });
 
+test('standalone AI fill attaches the latest validation findings', async () => {
+    mockAIAvailable = true;
+    global.fetch = jest.fn((url: string) => {
+      if (String(url).includes('/validate_scenario/')) {
+        return Promise.resolve({ok: true, status: 200, json: async () => modelBuilt});
+      }
+      return Promise.resolve({ok: true, status: 200, json: async () => ({})});
+    }) as jest.Mock;
+    render(<Bottombar section={0} backgroundTasks={[]} setDisableOptimize={jest.fn()}
+      scenario={{...mockScenario, results: {status: 'Incomplete'}}} />);
+    fireEvent.click(screen.getByRole('button', {name: /Validate Scenario/i}));
+    await waitFor(() => expect(screen.getByRole('button', {name: 'Close'})).toBeEnabled());
+    await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Close'})); });
+    await waitFor(() => expect(screen.getByRole('button', {name: /AI Fill Inputs/i})).toBeEnabled());
+    await act(async () => { fireEvent.click(screen.getByRole('button', {name: /AI Fill Inputs/i})); });
+    expect(dialogProps).not.toBeNull();
+    expect(dialogProps.validationFindings).toMatchObject({state: 'model_built', model_check: 'passed'});
+});
+
 
 test('test bottom bar: data input section', () => {
     render( <Bottombar 
diff --git a/electron/ui/src/types/ai.ts b/electron/ui/src/types/ai.ts
index a94d6b0..153e172 100644
--- a/electron/ui/src/types/ai.ts
+++ b/electron/ui/src/types/ai.ts
@@ -14,6 +14,7 @@ export interface AIPromptResponse {
   status: "success" | "error";
   updatedScenario?: AIPromptUpdatedScenario;
   updateNotes?: string[];
+  questions?: string[];
   errorMessage?: string;
   error?: string;
 }
```
