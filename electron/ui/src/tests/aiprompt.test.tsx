import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIPromptProvider, useAIPrompt, AIPromptContextValue } from '../context/AIPromptContext';
import AIPromptDialog from '../components/AIPromptDialog/AIPromptDialog';
import fixture from './fixtures/scenario-contract.json';

jest.mock('../AppContext', () => ({ useApp: () => ({ port: 50011 }) }));
const mockSave = jest.fn();
let mockScenario = { ...fixture };
jest.mock('../context/ScenarioContext', () => ({
  useScenario: () => ({ scenarioData: mockScenario, handleScenarioUpdate: mockSave }),
}));

const originalFetch = global.fetch;
const filled = {
  status: 'success',
  updatedScenario: { df_parameters: { PadRates: { T01: [0] } } },
  updateNotes: ['Filled rates.'],
};
let context: AIPromptContextValue;
let requests: Array<{ resolve: (value: unknown) => void; reject: (reason: Error) => void }>;
const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete window.paretoAISettings;
  mockScenario = { ...fixture };
  requests = [];
  global.fetch = jest.fn((url) => {
    if (String(url).endsWith('/ai_available'))
      return Promise.resolve(response({ available: true }));
    return new Promise((resolve, reject) => {
      requests.push({ resolve, reject });
    });
  }) as jest.Mock;
});
afterEach(() => {
  global.fetch = originalFetch;
});

function Probe() {
  context = useAIPrompt();
  return null;
}
function View({ dialog = false }: { dialog?: boolean }) {
  return (
    <AIPromptProvider>
      <Probe />
      {dialog && <AIPromptDialog open onClose={jest.fn()} scenarioId={mockScenario.id} />}
    </AIPromptProvider>
  );
}

test.each([
  [
    200,
    { status: 'success', updatedScenario: { df_parameters: { PadRates: { T01: 100 } } } },
    /invalid response/i,
  ],
  [200, { error: 'ai_unavailable', detail: 'Configure a key.' }, /Configure a key/],
  [400, { detail: 'Please provide a prompt.' }, /Please provide a prompt/],
])('failed fill responses cannot populate the save preview: %#', async (status, body, message) => {
  render(<View dialog />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  act(() => {
    void context.runPrompt(0, 'Fill');
  });
  await act(async () => requests[0].resolve(response(body, status)));
  expect(context.status).toBe('error');
  expect(context.errorMessage).toMatch(message);
  expect(context.updatedScenario).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save Updates' })).not.toBeInTheDocument();
  expect(requests).toHaveLength(1);
  expect(mockSave).not.toHaveBeenCalled();
});

test('scenario zero can request, review and explicitly save checked fill inputs', async () => {
  render(<View dialog />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill zero rates' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].resolve(response(filled)));
  expect(mockSave).not.toHaveBeenCalled();
  expect(screen.getByText('Filled rates.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save Updates' }));
  expect(mockSave).toHaveBeenCalledWith(
    { ...fixture, data_input: { ...fixture.data_input, ...filled.updatedScenario } },
    false,
    'json',
  );
});

test('a result arriving after switching scenarios cannot be previewed or saved onto the other scenario', async () => {
  const view = render(<View dialog />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  act(() => {
    void context.runPrompt(0, 'Fill');
  });
  mockScenario = { ...fixture, id: 2 };
  view.rerender(<View dialog />);
  await act(async () => requests[0].resolve(response(filled)));
  expect(context.requestScenarioId).toBe(0);
  expect(screen.queryByRole('button', { name: 'Save Updates' })).not.toBeInTheDocument();
  expect(screen.queryByText('Filled rates.')).not.toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
  mockScenario = { ...fixture };
  view.rerender(<View dialog />);
  expect(screen.getByRole('button', { name: 'Save Updates' })).toBeEnabled();
});

test('duplicate clicks cannot start a second request while AI is running', async () => {
  render(<View />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  act(() => {
    void context.runPrompt(0, 'Fill');
    void context.runOptimizationDiagnosis(0, 'Failed');
  });
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].resolve(response(filled)));
  expect(context.status).toBe('success');
  expect(context.requestKind).toBe('data-update');
});

test('clearing a request prevents its late success from replacing a newer result', async () => {
  render(<View />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  act(() => {
    void context.runPrompt(0, 'Old');
  });
  act(() => context.clearResult());
  act(() => {
    void context.runPrompt(2, 'New');
  });
  await act(async () => requests[1].resolve(response({ ...filled, updateNotes: ['New result'] })));
  await act(async () => requests[0].resolve(response(filled)));
  expect(context.requestScenarioId).toBe(2);
  expect(context.updateNotes).toEqual(['New result']);
  expect(context.lastPrompt).toBe('New');
});

test('clearing a request also ignores late failures and unmount ignores late results', async () => {
  const view = render(<View />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  act(() => {
    void context.runPrompt(0, 'Fill');
  });
  act(() => context.clearResult());
  await act(async () => requests[0].reject(new Error('Disconnected')));
  expect(context.status).toBe('idle');
  expect(context.errorMessage).toBeNull();
  act(() => {
    void context.runPrompt(0, 'Fill');
  });
  view.unmount();
  await act(async () => requests[1].resolve(response(filled)));
  expect(context.status).toBe('running'); // No publication after the provider was removed.
});

test('malformed diagnosis never reports success and an explicit retry can recover', async () => {
  render(<View />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  act(() => {
    void context.runOptimizationDiagnosis(0, 'Failed');
  });
  await act(async () => requests[0].resolve(response({ status: 'success' })));
  expect(context.status).toBe('error');
  expect(context.diagnosis).toBeNull();
  expect(requests).toHaveLength(1);
  const diagnosis = {
    status: 'success',
    summary: 'Review capacity',
    likelyCauses: [],
    nextSteps: [],
    cautionNotes: [],
    diagnosedAt: 'now',
  };
  act(() => {
    void context.runOptimizationDiagnosis(0, 'Failed');
  });
  await act(async () => requests[1].resolve(response(diagnosis)));
  expect(context.status).toBe('success');
  expect(context.diagnosis).toEqual(diagnosis);
});
