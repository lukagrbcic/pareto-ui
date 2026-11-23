import {act, render, waitFor} from '@testing-library/react';
import {ScenarioProvider, useScenario, ScenarioContextValue} from '../context/ScenarioContext';
import {checkTasks, deleteScenario, fetchScenarios, updateExcel, updateScenario} from '../services/app.service';
import {copyScenario} from '../scenarioEdits';

jest.mock('../AppContext', () => ({useApp: () => ({port: 50011})}));
jest.mock('../services/app.service');

let context: ScenarioContextValue;
let initial: any;
let pending: Array<{sent: any; resolve: (response: any) => void}>;
const service = jest.requireActual('../services/app.service');
const originalFetch = global.fetch;

afterEach(() => { global.fetch = originalFetch; });

beforeEach(async () => {
  jest.resetAllMocks();
  initial = {id: 1, name: 'Saving test', results: {status: 'Draft', data: {}}, input_revision: 'r0',
    optimization: {runtime: 900, optimalityGap: 0},
    data_input: {df_sets: {ProductionPads: ['P1']}, df_parameters: {PadRates: {ProductionPads: ['P1'], T01: [100]}}}};
  pending = [];
  (checkTasks as jest.Mock).mockResolvedValue({tasks: []});
  // Exercise the production client/decoder as well as the provider. Only transport is faked.
  (fetchScenarios as jest.Mock).mockImplementation(service.fetchScenarios);
  (updateScenario as jest.Mock).mockImplementation(service.updateScenario);
  (updateExcel as jest.Mock).mockImplementation(service.updateExcel);
  (deleteScenario as jest.Mock).mockImplementation(service.deleteScenario);
  global.fetch = jest.fn((url, options) => {
    if (String(url).endsWith('/get_scenario_list/')) return Promise.resolve({ok: true, status: 200,
      json: async () => ({data: {1: copyScenario(initial)}})});
    if (String(url).endsWith('/update')) return new Promise(resolve => {
      pending.push({sent: JSON.parse(options.body).updatedScenario, resolve});
    });
    throw new Error(`Unexpected request: ${url}`);
  }) as jest.Mock;
  function Probe() { context = useScenario(); return null; }
  render(<ScenarioProvider navigate={jest.fn()}><Probe/></ScenarioProvider>);
  await waitFor(() => expect(context.scenarios[1]).toBeDefined());
  act(() => context.handleScenarioSelection(1));
});

function edit(field: string, value: number) {
  act(() => {
    const snapshot = copyScenario(context.scenarioData);
    snapshot.optimization[field] = value;
    void context.handleScenarioUpdate(snapshot);
  });
}

test('an invalid delete response retains the selected scenario and any unsaved draft', async () => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  (global.fetch as jest.Mock).mockResolvedValueOnce({ok: true, status: 200,
    json: async () => ({data: {1: copyScenario(initial)}})});
  await act(async () => {
    await expect(context.handleDeleteScenario(1)).rejects.toMatchObject({code: 'invalid_response'});
  });
  expect(context.scenarios[1]).toBeDefined();
  expect(context.scenarioData.id).toBe(1);
  expect(context.scenarioData.optimization.runtime).toBe(100);
  await acknowledge(0);
});

test('a checked delete publishes the returned scenario list', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ok: true, status: 200, json: async () => ({data: {}})});
  await act(async () => {await context.handleDeleteScenario(1);});
  expect(context.scenarios).toEqual({});
  expect(deleteScenario).toHaveBeenCalledTimes(1);
});

async function acknowledge(index: number, additions = {}) {
  await act(async () => pending[index].resolve({ok: true, json: async () => ({data: {
    ...pending[index].sent, ...additions, input_revision: `r${index + 1}`,
  }})}));
}

test('three rapid settings edits survive older acknowledgements and retain server normalization', async () => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  edit('optimalityGap', 1);
  const normalized = {...initial.data_input, df_parameters: {...initial.data_input.df_parameters, NodeCapacities: {NetworkNodes: ['N1'], VALUE: [500]}}};
  await acknowledge(0, {data_input: normalized});
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(context.scenarioData.optimization.optimalityGap).toBe(1);
  expect(pending[1].sent.data_input).toEqual(normalized);
  expect(pending[1].sent.input_revision).toBe('r1');
  edit('runtime', 200);
  await acknowledge(1);
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(pending[2].sent.optimization).toEqual({runtime: 200, optimalityGap: 1});
  expect(pending[2].sent.input_revision).toBe('r2');
  await acknowledge(2);
  expect(context.scenarioData.optimization).toEqual({runtime: 200, optimalityGap: 1});
  expect(context.scenarioData.data_input).toEqual(normalized);
  expect(context.isSaving).toBe(false);
});

test('queued settings retain a preceding table edit and its server-generated map data', async () => {
  let resolveTable: (response: any) => void;
  (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveTable = resolve; }));
  const table = {ProductionPads: ['P1'], T01: [250]};
  act(() => { void context.handleUpdateExcel(1, 'PadRates', table); });
  await waitFor(() => expect(updateExcel).toHaveBeenCalledTimes(1));
  edit('runtime', 120);
  const updated = {...copyScenario(initial), input_revision: 'table-revision', data_input: {
    df_sets: initial.data_input.df_sets, df_parameters: {PadRates: table},
    map_data: {all_nodes: {P1: {node_type: 'ProductionPad'}}, arcs: {}, connections: {all_connections: {}}},
  }};
  await act(async () => resolveTable({ok: true, json: async () => updated}));
  await waitFor(() => expect(pending).toHaveLength(1));
  expect(pending[0].sent.input_revision).toBe('table-revision');
  expect(pending[0].sent.data_input).toEqual(updated.data_input);
  await acknowledge(0);
  expect(context.scenarioData.data_input.df_parameters.PadRates).toEqual(table);
});

test('failed saves stop later requests and retain the draft until an explicit reload', async () => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  edit('optimalityGap', 1);
  await act(async () => pending[0].resolve({ok: false, json: async () => ({detail: 'Inputs changed. Refresh first.'})}));
  await waitFor(() => expect(context.isSaving).toBe(false));
  expect(pending).toHaveLength(1);
  expect(context.saveError).toMatch(/previous save failed/i);
  expect(context.scenarioData.optimization).toEqual({runtime: 100, optimalityGap: 1});
  act(() => context.syncScenarioData());
  await waitFor(() => expect(context.saveError).toBeNull());
  expect(context.scenarioData.optimization).toEqual(initial.optimization);
  edit('runtime', 200);
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[1].sent.input_revision).toBe('r0');
  await acknowledge(1);
});

test('a form mutating its prop cannot mutate the saved baseline', async () => {
  act(() => {
    context.scenarioData.optimization.runtime = 120;
    void context.handleScenarioUpdate({...context.scenarioData});
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  expect(pending[0].sent.optimization.runtime).toBe(120);
  await acknowledge(0);
});

test('renaming during a settings save preserves the queued setting', async () => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => context.handleEditScenarioName('Renamed scenario', 1, true));
  await acknowledge(0);
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(context.scenarioData.name).toBe('Renamed scenario');
  expect(pending[1].sent.optimization.runtime).toBe(100);
  await acknowledge(1);
  expect(context.scenarioData.name).toBe('Renamed scenario');
});

test('saving one scenario cannot replace another selected scenario', async () => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  const second = {...copyScenario(initial), id: 2, name: 'Second scenario'};
  act(() => context.handleNewScenario(second));
  edit('runtime', 300);
  await acknowledge(0);
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(context.scenarioData.id).toBe(2);
  expect(context.scenarioData.optimization.runtime).toBe(300);
  expect(pending[1].sent.id).toBe(2);
  await acknowledge(1);
  act(() => context.handleScenarioSelection(1));
  expect(context.scenarioData.optimization.runtime).toBe(100);
});

test.each([
  ['missing data', {}],
  ['wrong scenario', {data: {id: 2}}],
  ['invalid table', {data: {data_input: {df_sets: {}, df_parameters: {PadRates: {T01: 100}}}}}],
  ['missing revision', {data: {input_revision: undefined}}],
])('a successful HTTP response with %s cannot acknowledge an edit', async (_label, payload) => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  const body = 'data' in payload ? {data: {...pending[0].sent, ...payload.data}} : payload;
  await act(async () => pending[0].resolve({ok: true, status: 200, json: async () => body}));
  expect(context.isSaving).toBe(false);
  expect(context.saveError).toMatch(/invalid response/i);
  expect(context.scenarioData.optimization.runtime).toBe(100);
  expect(context.scenarioData.input_revision).toBe('r0');
  edit('optimalityGap', 2);
  await waitFor(() => expect(context.isSaving).toBe(false));
  expect(pending).toHaveLength(1);
  expect(context.scenarioData.optimization.optimalityGap).toBe(2);
});

test('malformed reloads retain a failed draft until a valid reload succeeds', async () => {
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0].resolve({ok: false, status: 409, json: async () => ({detail: 'Reload first.'})}));
  (global.fetch as jest.Mock).mockResolvedValueOnce({ok: true, status: 200, json: async () => ({data: []})});
  act(() => context.syncScenarioData());
  await waitFor(() => expect(context.saveError).toMatch(/invalid response/i));
  expect(context.scenarioData.optimization.runtime).toBe(100);
  act(() => context.syncScenarioData());
  await waitFor(() => expect(context.saveError).toBeNull());
  expect(context.scenarioData.optimization.runtime).toBe(900);
});

test('a delayed reload cannot discard an edit made after the request', async () => {
  let resolveReload: (response: unknown) => void;
  (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => {resolveReload = resolve;}));
  act(() => context.syncScenarioData());
  edit('runtime', 100);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => resolveReload({ok: true, status: 200, json: async () => ({data: {1: copyScenario(initial)}})}));
  expect(context.scenarioData.optimization.runtime).toBe(100);
  await acknowledge(0);
  expect(context.scenarioData.optimization.runtime).toBe(100);
});

test('multi-step undoHistory tracks manual and AI saves and reverts in reverse order, while discardDraftEdits restores baseline synchronously', async () => {
  expect(context.canRevertSaved).toBe(false);
  expect(context.undoHistory).toEqual([]);

  // Step 1: manual table save
  let resolveTable: (response: any) => void;
  (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveTable = resolve; }));
  const updatedTable = {ProductionPads: ['P1'], T01: [250]};
  act(() => { void context.handleUpdateExcel(1, 'PadRates', updatedTable); });
  await waitFor(() => expect(updateExcel).toHaveBeenCalledTimes(1));
  const afterTableSave = {
    ...copyScenario(initial),
    input_revision: 'r-table',
    data_input: {
      df_sets: initial.data_input.df_sets,
      df_parameters: {PadRates: updatedTable},
    },
  };
  await act(async () => resolveTable({ok: true, json: async () => afterTableSave}));

  expect(context.undoHistory).toHaveLength(1);
  expect(context.undoHistory[0].source).toBe('user');
  expect(context.canRevertSaved).toBe(true);

  // Step 2: AI-tagged scenario save
  act(() => {
    context.markNextSaveMeta(1, {label: 'AI changes (1 table, 1 cell)', source: 'ai'});
    const aiSnapshot = copyScenario(context.scenarioData);
    aiSnapshot.data_input.df_parameters.PadRates.T01[0] = 600;
    void context.handleScenarioUpdate(aiSnapshot, false, 'json');
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  await acknowledge(0);

  expect(context.undoHistory).toHaveLength(2);
  expect(context.undoHistory[1]).toMatchObject({
    label: 'AI changes (1 table, 1 cell)',
    source: 'ai',
  });
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(600);

  // Revert step 2 (AI save -> back to 250)
  let revertedAI: any;
  const revertPromise1 = act(async () => {
    const p = context.revertLastSavedChange(1);
    await waitFor(() => expect(pending).toHaveLength(2));
    await acknowledge(1);
    revertedAI = await p;
  });
  await revertPromise1;
  expect(revertedAI?.source).toBe('ai');
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(250);
  expect(context.undoHistory).toHaveLength(1);

  // Revert step 1 (table save -> back to 100)
  let revertedUser: any;
  const revertPromise2 = act(async () => {
    const p = context.revertLastSavedChange(1);
    await waitFor(() => expect(pending).toHaveLength(3));
    await acknowledge(2);
    revertedUser = await p;
  });
  await revertPromise2;
  expect(revertedUser?.source).toBe('user');
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(100);
  expect(context.undoHistory).toHaveLength(0);
  expect(context.canRevertSaved).toBe(false);
  expect(context.redoHistory).toHaveLength(2);
  expect(context.canRedoSaved).toBe(true);

  // Redo step 1 (table save -> back to 250) and step 2 (AI save -> back to 600)
  let redoneUser: any;
  const redoPromise1 = act(async () => {
    const p = context.redoLastRevertedChange(1);
    await waitFor(() => expect(pending).toHaveLength(4));
    await acknowledge(3);
    redoneUser = await p;
  });
  await redoPromise1;
  expect(redoneUser?.source).toBe('user');
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(250);
  expect(context.undoHistory).toHaveLength(1);
  expect(context.redoHistory).toHaveLength(1);

  let redoneAI: any;
  const redoPromise2 = act(async () => {
    const p = context.redoLastRevertedChange(1);
    await waitFor(() => expect(pending).toHaveLength(5));
    await acknowledge(4);
    redoneAI = await p;
  });
  await redoPromise2;
  expect(redoneAI?.source).toBe('ai');
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(600);
  expect(context.undoHistory).toHaveLength(2);
  expect(context.redoHistory).toHaveLength(0);
  expect(context.canRedoSaved).toBe(false);

  // Reverting once then saving a new edit clears redoHistory cleanly
  const revertOncePromise = act(async () => {
    const p = context.revertLastSavedChange(1);
    await waitFor(() => expect(pending).toHaveLength(6));
    await acknowledge(5);
    await p;
  });
  await revertOncePromise;
  expect(context.redoHistory).toHaveLength(1);

  act(() => {
    const nextSnapshot = copyScenario(context.scenarioData);
    nextSnapshot.data_input.df_parameters.PadRates.T01[0] = 333;
    void context.handleScenarioUpdate(nextSnapshot, false, 'json');
  });
  await waitFor(() => expect(pending).toHaveLength(7));
  await acknowledge(6);
  expect(context.redoHistory).toHaveLength(0);
  expect(context.canRedoSaved).toBe(false);

  // Revert back to 100 before testing synchronous discardDraftEdits
  for (let i = 0; i < 2; i += 1) {
    let p: any;
    act(() => { p = context.revertLastSavedChange(1); });
    await waitFor(() => expect(pending).toHaveLength(8 + i));
    await acknowledge(7 + i);
    await act(async () => { await p; });
  }
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(100);

  // discardDraftEdits restores the saved baseline synchronously with zero network calls
  const callsBeforeDiscard = (global.fetch as jest.Mock).mock.calls.length;
  act(() => {
    context.scenarioData.data_input.df_parameters.PadRates.T01[0] = 999;
    context.discardDraftEdits(1);
  });
  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(100);
  expect((global.fetch as jest.Mock).mock.calls.length).toBe(callsBeforeDiscard);
});

test('in-place draft mutations on scenarioData cannot corrupt savedScenarios when switching scenarios and re-selecting', async () => {
  const second = {...copyScenario(initial), id: 2, name: 'Other'};
  act(() => context.handleNewScenario(second));
  act(() => context.handleScenarioSelection(1));

  // Simulate DataTable mutating scenarioData in place without saving
  act(() => {
    context.scenarioData.data_input.df_parameters.PadRates.T01[0] = 777;
  });

  // Switch away and back without fetchScenarios having completed yet
  act(() => context.handleScenarioSelection(2));
  act(() => context.handleScenarioSelection(1));

  expect(context.scenarioData.data_input.df_parameters.PadRates.T01[0]).toBe(100);
});
