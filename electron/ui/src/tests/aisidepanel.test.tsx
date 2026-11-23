import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIPromptProvider, useAIPrompt } from '../context/AIPromptContext';
import AISidePanel from '../components/AISidePanel/AISidePanel';
import Bottombar from '../components/Bottombar/Bottombar';
import ScenarioCompletion from '../components/ScenarioCompletion/ScenarioCompletion';
import DataInput from '../views/DataInput/DataInput';
import { buildMergedSaveScenario, buildPreviewScenario, computeAIDiff } from '../utils/aiStaging';
import fixture from './fixtures/scenario-contract.json';
import type { Scenario } from '../types';

jest.mock('../AppContext', () => ({ useApp: () => ({ port: 50011 }) }));
const mockSave = jest.fn();
jest.mock('../context/ScenarioContext', () => ({
  useScenario: () => ({
    inputFocus: null,
    isSaving: false,
    acceptSavedScenario: jest.fn(),
  }),
}));

const originalFetch = global.fetch;
let requests: Array<{
  url: string;
  body: Record<string, unknown>;
  resolve: (value: unknown) => void;
}>;

const okJson = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete window.paretoAISettings;
  requests = [];
  global.fetch = jest.fn((url, init) => {
    if (String(url).endsWith('/ai_available')) {
      return Promise.resolve(okJson({ available: true }));
    }
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
    return new Promise(resolve => {
      requests.push({ url: String(url), body: parsedBody, resolve });
    });
  }) as jest.Mock;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function InteractiveHarness({
  initialScenario,
  initialCategory = 'Input Summary',
  withBottombar = false,
  edited = false,
  onRevertAppliedMock,
}: {
  initialScenario: Scenario;
  initialCategory?: string;
  withBottombar?: boolean;
  edited?: boolean;
  onRevertAppliedMock?: () => void;
}) {
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [localEdited, setLocalEdited] = useState<boolean>(edited);
  const [category, setCategory] = useState<string>(initialCategory);
  const [validateSignal, setValidateSignal] = useState<number>(0);
  const [appliedUndoId, setAppliedUndoId] = useState<string | null>(null);
  const {
    openPanel,
    isRunning,
    requestScenarioId,
    getThread,
    updateStagedParameterTable,
    invalidateStaleStagedUpdates,
    discardStagedUpdates,
    markStagedUpdatesApplied,
    revertStagedTable,
    revertStagedSet,
    revertStagedCell,
  } = useAIPrompt();

  React.useEffect(() => {
    setLocalEdited(edited);
  }, [edited]);

  const thread = getThread(scenario.id);
  const aiDiff = computeAIDiff(scenario.data_input, thread.stagedScenario);
  const previewScenario = buildPreviewScenario(scenario, thread.stagedScenario)!;
  const isAIRunningForScenario = Boolean(isRunning && requestScenarioId === Number(scenario.id));

  React.useEffect(() => {
    if (
      thread.stagedScenario &&
      thread.stagedBaseRevision &&
      scenario.input_revision &&
      thread.stagedBaseRevision !== scenario.input_revision
    ) {
      invalidateStaleStagedUpdates(scenario.id, scenario.input_revision);
    }
  }, [
    scenario.id,
    scenario.input_revision,
    thread.stagedScenario,
    thread.stagedBaseRevision,
    invalidateStaleStagedUpdates,
  ]);

  const handleApply = async () => {
    if (!thread.stagedScenario || localEdited || isAIRunningForScenario) return;
    const merged = buildMergedSaveScenario(scenario, thread.stagedScenario);
    const undoId = `undo-${Date.now()}`;
    setAppliedUndoId(undoId);
    mockSave(merged);
    setScenario(merged);
    markStagedUpdatesApplied(scenario.id, 'Applied AI changes.', undoId);
  };

  return (
    <div>
      <button onClick={() => openPanel({ scenarioId: scenario.id })}>Open AI</button>
      <button
        onClick={() =>
          setScenario(prev => ({
            ...prev,
            input_revision: 'rev-external-update',
          }))
        }
      >
        Simulate External Save
      </button>
      <div data-testid="active-category">{category}</div>
      {category === 'Complete Scenario Inputs' ? (
        <ScenarioCompletion
          scenario={scenario}
          disabled={aiDiff.hasStagedChanges}
          onSelect={issue => issue.table && setCategory(issue.table)}
          validateSignal={validateSignal}
          syncScenarioData={jest.fn()}
          onAdvance={jest.fn()}
        />
      ) : (
        <DataInput
          scenario={previewScenario}
          category={category}
          handleSetCategory={setCategory}
          syncScenarioData={jest.fn()}
          handleUpdateExcel={jest.fn()}
          handleEditInput={setLocalEdited}
          edited={localEdited}
          updateScenario={setScenario}
          aiDiff={aiDiff}
          isAIRunning={isAIRunningForScenario}
          onApplyAIStaged={handleApply}
          onDiscardAIStaged={() => discardStagedUpdates(scenario.id)}
          onRevertStagedCell={(tblKey, r, c) =>
            revertStagedCell(scenario.id, tblKey, r, c, scenario.data_input)
          }
          onUpdateStagedTable={(key, tbl) =>
            updateStagedParameterTable(scenario.id, key, tbl, scenario.data_input, scenario.input_revision)
          }
        />
      )}
      <AISidePanel
        scenario={scenario}
        aiDiff={aiDiff}
        currentCategory={category}
        hasUnsavedTableEdits={localEdited}
        onSelectTable={setCategory}
        onApplyStaged={handleApply}
        onDiscardStaged={() => discardStagedUpdates(scenario.id)}
        onRevertStagedTable={tblKey => revertStagedTable(scenario.id, tblKey, scenario.data_input)}
        onRevertStagedSet={setName => revertStagedSet(scenario.id, setName, scenario.data_input)}
        latestUndoEntry={
          appliedUndoId
            ? {
                id: appliedUndoId,
                label: 'Applied AI changes',
                source: 'ai',
                timestamp: '2026-11-23T00:00:00Z',
                snapshot: {
                  name: initialScenario.name,
                  data_input: initialScenario.data_input,
                  optimization: initialScenario.optimization,
                },
              }
            : null
        }
        canRevertSaved={Boolean(appliedUndoId)}
        onRevertAppliedAI={async () => {
          onRevertAppliedMock?.();
          setScenario(initialScenario);
          setAppliedUndoId(null);
        }}
      />
      {withBottombar && (
        <Bottombar
          section={0}
          scenario={scenario}
          backgroundTasks={[]}
          port={50011}
          syncScenarioData={jest.fn()}
          handleSelection={jest.fn()}
          handleRunModel={jest.fn()}
          onRequestValidation={() => {
            setCategory('Complete Scenario Inputs');
            setValidateSignal(prev => prev + 1);
          }}
        />
      )}
    </div>
  );
}

const scenarioWithTables: Scenario = {
  ...(fixture as unknown as Scenario),
  data_input: {
    ...fixture.data_input,
    df_sets: {
      ...fixture.data_input.df_sets,
      ProductionPads: ['P1', 'P2'],
      SWDSites: ['K1'],
      TimePeriods: ['T01', 'T02'],
    },
    df_parameters: {
      ...fixture.data_input.df_parameters,
      PadRates: {
        ProductionPads: ['P1', 'P2'],
        T01: [100, 200],
        T02: [150, 250],
      },
      InitialDisposalCapacity: {
        SWDSites: ['K1'],
        Capacity: [1000],
      },
    },
  },
};

test('multi-turn chat stages changes live into DataTable tabs, carries history + staged updates, and applies cleanly', async () => {
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');

  // Turn 1: conversational review without data mutations
  fireEvent.change(composer, { target: { value: 'Review my scenario capacities' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toEqual({ prompt: 'Review my scenario capacities' });

  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Disposal capacity of 1,000 bbl/d exceeds peak production of 400 bbl/d.',
      }),
    );
  });
  expect(
    await screen.findByText(/Disposal capacity of 1,000 bbl\/d exceeds peak production/),
  ).toBeVisible();
  expect(mockSave).not.toHaveBeenCalled();

  // Turn 2: stage an update to PadRates
  fireEvent.change(composer, { target: { value: 'Set P1 PadRates in T01 to 550' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));
  expect(requests).toHaveLength(2);
  expect(requests[1].body.conversation_history).toEqual([
    { role: 'user', content: 'Review my scenario capacities' },
    {
      role: 'assistant',
      content: 'Disposal capacity of 1,000 bbl/d exceeds peak production of 400 bbl/d.',
    },
  ]);

  await act(async () => {
    requests[1].resolve(
      okJson({
        status: 'success',
        reply: 'Updated P1 rate in T01 to 550.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2'],
              T01: [550, 200],
              T02: [150, 250],
            },
          },
        },
      }),
    );
  });

  // Click changed-table chip in chat to jump straight to PadRates tab
  const tableChips = await screen.findAllByRole('button', { name: /Open Pad Rates \(PadRates\)/i });
  fireEvent.click(tableChips[tableChips.length - 1]);
  expect(screen.getByTestId('active-category')).toHaveTextContent('PadRates');

  // Verify the staged value 550 is live in DataTable with data-ai-staged="true" and tooltip
  const stagedCell = await screen.findByRole('cell', { name: /Saved: 100 → AI staged: 550/i });
  expect(stagedCell).toHaveAttribute('data-ai-staged', 'true');
  expect(stagedCell).toHaveTextContent('550');

  // Turn 3: stage a second table without losing PadRates
  fireEvent.change(composer, { target: { value: 'Also raise K1 disposal capacity to 2500' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));
  expect(requests).toHaveLength(3);
  expect(requests[2].body.staged_updates).toEqual({
    df_parameters: {
      PadRates: {
        ProductionPads: ['P1', 'P2'],
        T01: [550, 200],
        T02: [150, 250],
      },
    },
  });

  await act(async () => {
    requests[2].resolve(
      okJson({
        status: 'success',
        reply: 'Raised K1 disposal capacity to 2,500.',
        updatedScenario: {
          df_parameters: {
            InitialDisposalCapacity: {
              SWDSites: ['K1'],
              Capacity: [2500],
            },
          },
        },
      }),
    );
  });

  expect(await screen.findByText(/2 tables \(2 cells\)/)).toBeVisible();

  // Apply all staged AI changes
  const applyButtons = screen.getAllByRole('button', { name: 'Apply AI Changes' });
  fireEvent.click(applyButtons[0]);

  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  const savedArg = mockSave.mock.calls[0][0] as Scenario;
  expect(savedArg.data_input.df_parameters.PadRates).toEqual({
    ProductionPads: ['P1', 'P2'],
    T01: [550, 200],
    T02: [150, 250],
  });
  expect(savedArg.data_input.df_parameters.InitialDisposalCapacity).toEqual({
    SWDSites: ['K1'],
    Capacity: [2500],
  });
});

test('discarding staged AI changes immediately restores original table values without saving', async () => {
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');
  fireEvent.change(composer, { target: { value: 'Change P1 T01 to 999' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));

  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Staged 999 for P1 in T01.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2'],
              T01: [999, 200],
              T02: [150, 250],
            },
          },
        },
      }),
    );
  });

  const tableChips = await screen.findAllByRole('button', { name: /Open Pad Rates \(PadRates\)/i });
  fireEvent.click(tableChips[tableChips.length - 1]);
  expect(await screen.findByText('999')).toBeVisible();

  const discardButtons = screen.getAllByRole('button', { name: 'Discard' });
  fireEvent.click(discardButtons[0]);

  await waitFor(() => expect(screen.queryByText('999')).not.toBeInTheDocument());
  expect(screen.getByText('100')).toBeVisible();
  expect(mockSave).not.toHaveBeenCalled();
});

test('Validate Scenario unifies directly into Complete Scenario Inputs without a popup dialog and runs Review with AI inline', async () => {
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} withBottombar />
    </AIPromptProvider>,
  );

  await screen.findByRole('button', { name: /AI Assistant|AI Fill Inputs/i });

  fireEvent.click(screen.getByRole('button', { name: /Validate Scenario/i }));

  // Opens Complete Scenario Inputs directly — no duplicate modal dialog!
  expect(screen.getByTestId('active-category')).toHaveTextContent('Complete Scenario Inputs');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toMatch(/\/validate_scenario\//);

  const cleanValidation = {
    revision: scenarioWithTables.input_revision || 'rev-1',
    valid: true,
    error_count: 0,
    warning_count: 0,
    issues: [],
    sections: [],
    periods: ['T01', 'T02'],
    state: 'model_built',
    model_check: 'passed',
    feasibility: 'not_run',
  };

  await act(async () => {
    requests[0].resolve(okJson(cleanValidation));
  });

  expect(await screen.findByText(/The selected model builds successfully/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Advance to Optimization Setup' })).toBeVisible();

  const reviewButton = await screen.findByRole('button', { name: 'Review with AI' });
  fireEvent.click(reviewButton);

  // Side panel opens beside Complete Scenario Inputs and immediately dispatches the AI review request
  expect(screen.queryByText(/Validation summary attached/i)).not.toBeInTheDocument();
  expect(requests).toHaveLength(2);
  expect(requests[1].url).toMatch(/\/request_ai_data_update\//);
  expect(requests[1].body.prompt).toMatch(/Review my scenario inputs/i);
  expect(requests[1].body.validation_findings).toEqual(cleanValidation);

  await act(async () => {
    requests[1].resolve(
      okJson({
        status: 'success',
        reply: 'All forecasts and disposal capacities are consistent and well balanced.',
      }),
    );
  });

  expect(
    await screen.findByText(/All forecasts and disposal capacities are consistent and well balanced/),
  ).toBeVisible();
});

test('tweaking cells across staged and unstaged tables preserves input focus across keystrokes and keeps baseline unmutated', async () => {
  const baselineClone = JSON.parse(JSON.stringify(scenarioWithTables)) as Scenario;
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={baselineClone} />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');
  fireEvent.change(composer, { target: { value: 'Set P1 T01 to 500' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));

  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Staged 500 for P1 in T01.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2'],
              T01: [500, 200],
              T02: [150, 250],
            },
          },
        },
      }),
    );
  });

  const tableChips = await screen.findAllByRole('button', { name: /Open Pad Rates \(PadRates\)/i });
  fireEvent.click(tableChips[tableChips.length - 1]);

  const stagedCell = await screen.findByRole('cell', { name: /Saved: 100 → AI staged: 500/i });
  fireEvent.doubleClick(stagedCell);

  // Simulate multi-keystroke typing — input must stay mounted across keystrokes!
  const cellInput = screen.getByDisplayValue('500');
  fireEvent.change(cellInput, { target: { value: '5' } });
  expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  fireEvent.change(cellInput, { target: { value: '57' } });
  expect(screen.getByDisplayValue('57')).toBeInTheDocument();
  fireEvent.change(cellInput, { target: { value: '575' } });
  expect(screen.getByDisplayValue('575')).toBeInTheDocument();
  fireEvent.keyDown(cellInput, { key: 'Enter' });

  expect(await screen.findByRole('cell', { name: /Saved: 100 → AI staged: 575/i })).toHaveTextContent('575');
  expect(baselineClone.data_input.df_parameters.PadRates.T01[0]).toBe(100);
  expect(baselineClone.data_input.df_parameters.InitialDisposalCapacity.Capacity[0]).toBe(1000);
});

test('tweaking the sole staged cell through its baseline value (500 -> 100 -> 1000) keeps staging latched and guards ForecastFill', async () => {
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');
  fireEvent.change(composer, { target: { value: 'Set P1 T01 to 500' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));

  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Staged 500 for P1 in T01.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2'],
              T01: [500, 200],
              T02: [150, 250],
            },
          },
        },
      }),
    );
  });

  const tableChips = await screen.findAllByRole('button', { name: /Open Pad Rates \(PadRates\)/i });
  fireEvent.click(tableChips[tableChips.length - 1]);

  // ForecastFill must be disabled while AI edits are staged
  expect(screen.getByRole('button', { name: 'Fill forecast values' })).toBeDisabled();

  const stagedCell = await screen.findByRole('cell', { name: /Saved: 100 → AI staged: 500/i });
  fireEvent.doubleClick(stagedCell);
  const cellInput = screen.getByDisplayValue('500');

  // Keystrokes pass directly through the saved baseline value (100) before reaching 1000
  fireEvent.change(cellInput, { target: { value: '1' } });
  fireEvent.change(cellInput, { target: { value: '10' } });
  fireEvent.change(cellInput, { target: { value: '100' } });
  expect(screen.queryByRole('button', { name: 'Apply AI Changes' })).not.toBeInTheDocument();
  fireEvent.change(cellInput, { target: { value: '1000' } });
  fireEvent.keyDown(cellInput, { key: 'Enter' });

  expect(await screen.findByRole('cell', { name: /Saved: 100 → AI staged: 1000/i })).toHaveTextContent('1,000');
  expect(screen.getAllByRole('button', { name: 'Apply AI Changes' })[0]).toBeEnabled();

  // While an AI request is in flight, DataInput banner Apply is disabled too
  fireEvent.change(composer, { target: { value: 'Check values' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));
  for (const btn of screen.getAllByRole('button', { name: 'Apply AI Changes' })) {
    expect(btn).toBeDisabled();
  }
  await act(async () => {
    requests[1].resolve(okJson({ status: 'success', reply: 'Looks good.' }));
  });
});

test('external input_revision change clears stale staged AI edits and disables DataInput banner Apply when edited', async () => {
  const { rerender } = render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');
  fireEvent.change(composer, { target: { value: 'Set P1 T01 to 500' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));

  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Staged 500.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2'],
              T01: [500, 200],
              T02: [150, 250],
            },
          },
        },
      }),
    );
  });

  expect(await screen.findByText(/1 table \(1 cell\)/)).toBeVisible();

  rerender(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} edited />
    </AIPromptProvider>,
  );
  for (const btn of screen.getAllByRole('button', { name: 'Apply AI Changes' })) {
    expect(btn).toBeDisabled();
  }

  fireEvent.click(screen.getByRole('button', { name: 'Simulate External Save' }));
  expect(
    await screen.findByText('Cleared staged AI edits because scenario inputs were updated elsewhere.'),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Apply AI Changes' })).not.toBeInTheDocument();
});

test('supports per-cell staged revert, per-table staged revert, post-apply revert, and inline DataInput Revert', async () => {
  const onRevertApplied = jest.fn();
  const baselineClone = JSON.parse(JSON.stringify(scenarioWithTables)) as Scenario;
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={baselineClone} onRevertAppliedMock={onRevertApplied} />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');
  fireEvent.change(composer, { target: { value: 'Update two cells in PadRates and raise disposal capacity' } });
  fireEvent.click(screen.getByLabelText('Send AI message'));

  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Updated PadRates and InitialDisposalCapacity.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2'],
              T01: [550, 200],
              T02: [350, 250],
            },
            InitialDisposalCapacity: {
              SWDSites: ['K1'],
              Capacity: [2500],
            },
          },
        },
      }),
    );
  });

  expect(await screen.findByText(/2 tables \(3 cells\)/)).toBeVisible();

  // Open PadRates and revert just cell (0, 1) from 550 back to 100
  const padChip = await screen.findAllByRole('button', { name: /Open Pad Rates \(PadRates\)/i });
  fireEvent.click(padChip[padChip.length - 1]);
  const revertCellBtn = await screen.findByRole('button', { name: /Revert cell 0:1 to 100/i });
  fireEvent.click(revertCellBtn);

  expect(screen.queryByRole('cell', { name: /Saved: 100 → AI staged: 550/i })).not.toBeInTheDocument();
  expect(await screen.findByRole('cell', { name: /Saved: 150 → AI staged: 350/i })).toBeVisible();
  expect(await screen.findByText(/2 tables \(2 cells\)/)).toBeVisible();

  // Revert the entire staged PadRates table via the chip's Revert button, keeping InitialDisposalCapacity staged
  fireEvent.click(screen.getByRole('button', { name: /Revert staged Pad Rates/i }));
  expect(await screen.findByText(/1 table \(1 cell\)/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Revert staged Pad Rates/i })).not.toBeInTheDocument();

  // Apply remaining staged change (InitialDisposalCapacity) and then click Revert on the applied message
  fireEvent.click(screen.getAllByRole('button', { name: 'Apply AI Changes' })[0]);
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));

  const revertAppliedBtn = await screen.findByRole('button', { name: /Revert applied AI changes/i });
  fireEvent.click(revertAppliedBtn);
  await waitFor(() => expect(onRevertApplied).toHaveBeenCalledTimes(1));

  // Manual table edit without AI: Revert button next to Save Changes restores cell value and clears Save Changes
  const cell100 = await screen.findByText('100');
  fireEvent.doubleClick(cell100);
  const input = screen.getByDisplayValue('100');
  fireEvent.change(input, { target: { value: '777' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeVisible();
  const inlineRevertBtn = screen.getByRole('button', { name: 'Revert' });
  fireEvent.click(inlineRevertBtn);

  expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  expect(screen.getByText('100')).toBeVisible();
  expect(screen.queryByText('777')).not.toBeInTheDocument();
});

test('blocks DataTable double-click editing while AI is thinking, and cleanly reverts appended rows in multi-index tables without leaving blank->blank diffs', async () => {
  render(
    <AIPromptProvider>
      <InteractiveHarness initialScenario={scenarioWithTables} initialCategory="PadRates" />
    </AIPromptProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
  const composer = await screen.findByLabelText('Message AI Scenario Assistant');
  fireEvent.change(composer, {
    target: { value: 'Add PipelineCapexCapacityBased row and append PadRates row P3' },
  });
  fireEvent.click(screen.getByLabelText('Send AI message'));
  expect(requests).toHaveLength(1);

  // While AI is in flight (Thinking...), double-clicking a table cell must be ignored
  const existingCell = await screen.findByText('100');
  fireEvent.doubleClick(existingCell);
  expect(screen.queryByDisplayValue('100')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();

  // AI resolves with an appended row on PadRates AND a newly created 2-index matrix PipelineCapexCapacityBased
  await act(async () => {
    requests[0].resolve(
      okJson({
        status: 'success',
        reply: 'Added PipelineCapexCapacityBased row and P3 row to PadRates.',
        updatedScenario: {
          df_parameters: {
            PadRates: {
              ProductionPads: ['P1', 'P2', 'P3'],
              T01: [100, 200, 300],
              T02: [150, 250, 350],
            },
            PipelineCapexCapacityBased: {
              NODES: ['P1'],
              'NODES.1': ['N1'],
              D04: [12000],
            },
          },
        },
      }),
    );
  });

  // Switch to the new 2-index table: NODES.1 (index 1) must NOT get a revert icon, only D04 (index 2) gets one
  const pipeChip = await screen.findAllByRole('button', {
    name: /Open .*\(PipelineCapexCapacityBased\)/i,
  });
  fireEvent.click(pipeChip[pipeChip.length - 1]);

  expect(screen.queryByRole('button', { name: /Revert cell 0:1/i })).not.toBeInTheDocument();
  const pipeRevertBtn = await screen.findByRole('button', { name: /Revert cell 0:2 to blank/i });
  fireEvent.click(pipeRevertBtn);

  // Reverting D04 clears the newly staged table completely — no "Saved: blank -> AI staged: blank" ghost cell!
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Revert cell 0:2/i })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole('cell', { name: /AI staged: blank/i })).not.toBeInTheDocument();
  expect(await screen.findByText(/1 table \(3 cells\)/)).toBeVisible();

  // Switch to PadRates (appended row P3 has 2 value cells T01=300, T02=350 + appended ProductionPads=P3)
  const padChip = await screen.findAllByRole('button', { name: /Open Pad Rates \(PadRates\)/i });
  fireEvent.click(padChip[padChip.length - 1]);
  fireEvent.click(await screen.findByRole('button', { name: /Revert cell 2:1 to blank/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Revert cell 2:2 to blank/i }));

  // Once both value columns on the appended row are reverted, the appended row is pruned and staging returns to Ready
  await waitFor(() => expect(screen.queryByText('P3')).not.toBeInTheDocument());
  expect(screen.queryByRole('cell', { name: /AI staged: blank/i })).not.toBeInTheDocument();
  expect(screen.getByText('Ready')).toBeVisible();
});
