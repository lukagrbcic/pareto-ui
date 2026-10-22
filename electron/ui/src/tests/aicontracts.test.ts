import {
  getAIAvailability,
  getAISettings,
  saveAISettings,
  resetAISettings,
  requestAIDataUpdate,
  requestAIOptimizationDiagnosis,
} from '../services/app.service';
import { checkAIAvailability, updateAISettings } from '../services/ai-settings.service';
import fixture from './fixtures/scenario-contract.json';

const originalFetch = global.fetch;
const settings = {
  available: true,
  source: 'user',
  base_url: 'https://provider.example/v1',
  model: 'model',
  environment_available: false,
};
const diagnosis = {
  status: 'success',
  summary: 'Review capacity.',
  likelyCauses: [],
  cautionNotes: [],
  nextSteps: [{ title: 'Review', instruction: 'Check capacities.', reason: null, appArea: null }],
  diagnosedAt: '2026-09-16T12:00:00Z',
};
beforeEach(() => {
  global.fetch = jest.fn();
  delete window.paretoAISettings;
});
afterEach(() => {
  global.fetch = originalFetch;
  delete window.paretoAISettings;
});

function respond(body: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test('browser settings return only checked public metadata and do not send desktop preferences', async () => {
  respond({ ...settings, api_key: 'must-not-escape', provider: { key: 'must-not-escape' } });
  await expect(getAISettings(50011)).resolves.toEqual(settings);
  respond(settings);
  await expect(
    updateAISettings(50011, 'save', {
      api_key: 'entered-key',
      base_url: settings.base_url,
      model: settings.model,
      remember: true,
    }),
  ).resolves.toEqual({ ...settings, can_remember: false, remembered: false });
  expect(global.fetch).toHaveBeenLastCalledWith('http://localhost:50011/ai_settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: 'entered-key',
      base_url: settings.base_url,
      model: settings.model,
    }),
  });
  respond(settings);
  await expect(resetAISettings(50011)).resolves.toEqual(settings);
  expect(global.fetch).toHaveBeenLastCalledWith('http://localhost:50011/ai_settings', {
    method: 'DELETE',
  });
});

test.each([
  {},
  null,
  { available: 'true' },
  { ...settings, source: 'unknown' },
  { ...settings, model: 5 },
  { ...settings, environment_available: undefined },
])('malformed settings fail on reads, saves, and resets: %#', async (body) => {
  for (const operation of [
    () => getAISettings(50011),
    () => saveAISettings(50011, { base_url: settings.base_url, model: 'model' }),
    () => resetAISettings(50011),
  ]) {
    respond(body);
    await expect(operation()).rejects.toMatchObject({ code: 'invalid_response' });
  }
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('availability is a checked boolean and forwards cancellation', async () => {
  const controller = new AbortController();
  respond({ available: false });
  await expect(getAIAvailability(50011, controller.signal)).resolves.toEqual({ available: false });
  expect(global.fetch).toHaveBeenLastCalledWith('http://localhost:50011/ai_available', {
    signal: controller.signal,
  });
  respond({ available: 'true' });
  await expect(checkAIAvailability(50011, controller.signal)).rejects.toMatchObject({
    code: 'invalid_response',
  });
  respond({ detail: 'Starting' }, 503);
  await expect(checkAIAvailability(50011, controller.signal)).rejects.toMatchObject({
    code: 'http_error',
    status: 503,
  });
});

test('desktop bridge results are checked and stripped of unexpected credentials', async () => {
  const publicSettings = { ...settings, can_remember: true, remembered: true };
  const bridge = jest
    .fn()
    .mockResolvedValue({ ok: true, settings: { ...publicSettings, api_key: 'must-not-escape' } });
  window.paretoAISettings = { get: bridge, save: bridge, reset: bridge };
  for (const operation of ['get', 'save', 'reset'] as const) {
    await expect(
      updateAISettings(50011, operation, {
        base_url: settings.base_url,
        model: 'model',
        remember: false,
      }),
    ).resolves.toEqual(publicSettings);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([
  null,
  {},
  { ok: 'true', settings },
  { ok: true, settings },
  { ok: true, settings: { ...settings, can_remember: 'yes', remembered: true } },
])('malformed desktop metadata cannot enable AI or update the settings form: %#', async (body) => {
  window.paretoAISettings = {
    get: jest.fn().mockResolvedValue(body),
    save: jest.fn(),
    reset: jest.fn(),
  };
  await expect(updateAISettings(50011, 'get')).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(checkAIAvailability(50011, new AbortController().signal)).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

test('desktop restore retains retryable startup errors and actionable nonretryable settings errors', async () => {
  const get = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, error: 'Starting.', retryable: true })
    .mockResolvedValue({ ok: false, error: 'Saved settings cannot be unlocked.' });
  window.paretoAISettings = { get, save: jest.fn(), reset: jest.fn() };
  await expect(checkAIAvailability(50011, new AbortController().signal)).rejects.toMatchObject({
    code: 'network_error',
  });
  await expect(checkAIAvailability(50011, new AbortController().signal)).resolves.toBe(false);
  await expect(updateAISettings(50011, 'get')).rejects.toThrow(
    'Saved settings cannot be unlocked.',
  );
  get.mockRejectedValueOnce(new Error('IPC failure containing a key'));
  await expect(updateAISettings(50011, 'get')).rejects.toMatchObject({
    code: 'network_error',
    message: 'Unable to reach desktop AI settings. Please try again.',
  });
});

test('fill checks input data, normalizes legacy wrappers/notes, and preserves zero, blanks and scalar metadata', async () => {
  const inputs = {
    ...fixture.data_input,
    df_parameters: { ...fixture.data_input.df_parameters, PadRates: { T01: [0, '', null, '10'] } },
  };
  respond({
    status: 'success',
    updatedScenario: { id: 99, data_input: inputs },
    updatedNotes: ['Filled inputs.'],
  });
  const result = await requestAIDataUpdate(50011, '0', 'Fill inputs');
  const { vendor, ...checkedInputs } = inputs;
  expect(result).toEqual({
    status: 'success',
    updatedScenario: checkedInputs,
    updateNotes: ['Filled inputs.'],
  });
  expect(result.updatedScenario).not.toHaveProperty('id');
  expect(result.updatedScenario).not.toHaveProperty('vendor');
  expect(vendor).toEqual(fixture.data_input.vendor);
  expect(global.fetch).toHaveBeenLastCalledWith('http://localhost:50011/request_ai_data_update/0', {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: '{"prompt":"Fill inputs"}',
  });
});

test.each([
  {},
  { status: 'success' },
  { status: 'success', updatedScenario: {} },
  { status: 'success', updatedScenario: { df_parameters: { PadRates: { T01: 100 } } } },
  { status: 'success', updatedScenario: { df_sets: { ProductionPads: 'P1' } } },
  { status: 'success', updatedScenario: { map_data: { all_nodes: {} } } },
  { status: 'success', updatedScenario: { df_parameters: {} }, updateNotes: 'Filled' },
  { status: 'error', errorMessage: { message: 'Failure' } },
])('invalid AI fill data cannot be offered for saving: %#', async (body) => {
  respond(body);
  await expect(requestAIDataUpdate(50011, 0, 'Fill')).rejects.toMatchObject({
    code: 'invalid_response',
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('AI application errors with HTTP 200 remain failures, including legacy missing status', async () => {
  respond({ error: 'ai_unavailable', detail: 'Configure an API key.' });
  await expect(requestAIDataUpdate(50011, 0, 'Fill')).resolves.toEqual({
    status: 'error',
    errorMessage: 'Configure an API key.',
  });
  respond({ status: 'error', errorMessage: 'No failure to diagnose.' });
  await expect(requestAIOptimizationDiagnosis(50011, 0, 'Failure')).resolves.toEqual({
    status: 'error',
    errorMessage: 'No failure to diagnose.',
  });
  respond({ detail: 'Please provide a prompt.' }, 400);
  await expect(requestAIDataUpdate(50011, 0, '')).rejects.toMatchObject({
    code: 'http_error',
    message: 'Please provide a prompt.',
  });
});

test('diagnosis requires complete checked evidence and retains nullable step hints', async () => {
  respond(diagnosis);
  await expect(requestAIOptimizationDiagnosis(50011, '0', 'Failed')).resolves.toEqual(diagnosis);
  for (const invalid of [
    { ...diagnosis, diagnosedAt: undefined },
    { ...diagnosis, nextSteps: [{}] },
    { ...diagnosis, likelyCauses: 'capacity' },
    { status: 'success' },
  ]) {
    respond(invalid);
    await expect(requestAIOptimizationDiagnosis(50011, 0, 'Failed')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  }
});

test('invalid scenario IDs fail before sending a paid AI request', async () => {
  await expect(requestAIDataUpdate(50011, '01', 'Fill')).rejects.toMatchObject({
    code: 'invalid_request',
  });
  await expect(requestAIOptimizationDiagnosis(50011, -1, 'Failed')).rejects.toMatchObject({
    code: 'invalid_request',
  });
  expect(global.fetch).not.toHaveBeenCalled();
});
