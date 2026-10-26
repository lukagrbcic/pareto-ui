# AI settings

Open the hamburger menu at the top right and choose **Settings** to configure an API key, API base URL, and
model identifier for an OpenAI-compatible chat completions service. This is an
app-wide connection, shared by AI input filling and optimization diagnosis.

User settings take precedence over the optional environment configuration.
**Remove user settings** deletes the remembered connection and restores the
environment configuration. If neither provides a key, AI actions stay hidden.
Saving or removing settings updates availability immediately. A blank key field
keeps an existing user key at the same endpoint; changing the endpoint requires
entering a key again. Environment keys are never copied into the form or saved
as user credentials.

Saving settings configures the connection without making a paid AI request. Using
an AI feature sends scenario information to the configured service. The API base
URL must use HTTPS, except that local servers may use HTTP. Use the provider's
exact base URL (including `/v1` when required) and model identifier.

In the desktop app, **Remember on this device** encrypts the connection using
[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
Only encrypted data is persisted in Electron's app settings. The main process
restores credentials directly to the local backend; keys are never returned by
settings APIs or included in scenario files, exports, or browser local storage.
The preload bridge exposes only the three settings operations and accepts calls
only from the application's main window, following Electron's
[IPC guidance](https://www.electronjs.org/docs/latest/tutorial/ipc).

If protected storage is unavailable, settings work for the current session.
Browser development uses session settings. With the current Electron 20 version,
Linux also uses session settings because its API cannot identify the selected
secret store; later versions may remember keys when a real OS secret store is
confirmed. The unprotected `basic_text` backend is never used.

Environment configuration is provider-aligned: the backend checks, in order,
`CBORG_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (or
`GEMINI_API_KEY`), and `OPENROUTER_API_KEY`. Whichever key is found first is
paired with that provider's own OpenAI-compatible base URL and a default model —
a key is never sent to a different provider's endpoint. `CBORG_BASE_URL`
overrides the CBORG endpoint as before, and `PARETO_AI_MODEL` overrides the
selected provider's default model. User settings allow a different endpoint
and model without editing environment files. Restart the backend after changing
environment variables.

The browser API client and desktop settings bridge validate response metadata
before updating the form or enabling AI. Failed or malformed saves retain your
form edits and the last confirmed availability. Settings responses retain only
public configuration fields. Availability checks retry transient startup failures
quietly; fill, diagnosis, and settings changes require an explicit retry.
See [runtime AI contracts](api-contracts.md#ai-boundaries) for the checked payloads
and remaining concurrency limits.

Regression checks:

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests
npm --prefix electron/ui test -- --watchAll=false --runInBand
node --test electron/tests/*.test.cjs
./electron/ui/node_modules/.bin/tsc --noEmit --project electron/ui/tsconfig.json
```
