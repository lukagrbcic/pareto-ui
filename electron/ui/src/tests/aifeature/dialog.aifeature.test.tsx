/**
 * AI-feature review tests — personal verification suite, kept separate from the
 * main test suite (see docs/ai-feature-tests.md). These exercise the AI
 * autofill dialog: findings attachment, notes formatting, and the questions /
 * answers transcript flow.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIPromptProvider, useAIPrompt, AIPromptContextValue } from '../../context/AIPromptContext';
import AIPromptDialog from '../../components/AIPromptDialog/AIPromptDialog';
import fixture from '../fixtures/scenario-contract.json';

jest.mock('../../AppContext', () => ({ useApp: () => ({ port: 50011 }) }));
const mockSave = jest.fn();
let mockScenario = { ...fixture };
jest.mock('../../context/ScenarioContext', () => ({
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

test('validation findings are sent with the fill request when provided', async () => {
  render(<View />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  const findings = [{ code: 'missing_value', table: 'PadRates', severity: 'error' }];
  act(() => {
    void context.runPrompt(0, 'Fix the findings', findings);
  });
  expect(requests).toHaveLength(1);
  const updateCall = (global.fetch as jest.Mock).mock.calls.find((call) =>
    String(call[0]).includes('request_ai_data_update'));
  const body = JSON.parse(updateCall[1].body);
  expect(body.prompt).toBe('Fix the findings');
  expect(body.validation_findings).toEqual(findings);
  await act(async () => requests[0].resolve(response(filled)));
  expect(context.status).toBe('success');
});

test('multi-line update notes render as one scannable bullet per line', async () => {
  render(<View dialog />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
  await act(async () => requests[0].resolve(response({
    status: 'success',
    updatedScenario: { df_parameters: { PadRates: { T01: [0] } } },
    updateNotes: ['Interpreted the request as filling missing set data.\n- df_sets: added ProductionPads [PP01]\n- df_sets: added StorageSites [S02]'],
  })));
  expect(screen.getByText('Interpreted the request as filling missing set data.')).toBeVisible();
  expect(screen.getByText('df_sets: added ProductionPads [PP01]')).toBeVisible();
  expect(screen.getByText('df_sets: added StorageSites [S02]')).toBeVisible();
});

test('a guard rejection with questions surfaces the questions for a follow-up', async () => {
  render(<View dialog />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
  await act(async () => requests[0].resolve(response({
    status: 'error',
    errorMessage: 'The AI response did not include the df_parameters input tables, so no updates were applied.',
    questions: ['Which pads should demand use?'],
  })));
  expect(context.status).toBe('error');
  expect(context.questions).toEqual(['Which pads should demand use?']);
  expect(screen.getByLabelText('Answer to: Which pads should demand use?')).toBeVisible();
});

test('questions are answered inline and sent as a Q/A transcript on the next run', async () => {
  render(<View dialog />);
  await waitFor(() => expect(context.isAvailable).toBe(true));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fill demand' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
  await act(async () => requests[0].resolve(response({
    status: 'success', updateNotes: [],
    questions: ['Which unit should demand use?', 'Which solver should the scenario use?'],
  })));
  expect(context.questions).toEqual(['Which unit should demand use?', 'Which solver should the scenario use?']);
  expect(context.status).toBe('success');
  expect(screen.queryByRole('button', { name: 'Save Updates' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Answer to: Which unit should demand use?'),
    { target: { value: 'Unit W1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run AI Fill' }));
  expect(requests).toHaveLength(2);
  const followUp = (global.fetch as jest.Mock).mock.calls
    .filter((call) => call[1] && typeof call[1].body === 'string')
    .map((call) => JSON.parse(call[1].body))
    .filter((parsed) => typeof parsed.prompt === 'string'
      && parsed.prompt.includes('Answers to your previous questions:'));
  expect(followUp).toHaveLength(1);
  expect(followUp[0].prompt).toContain('Fill demand');
  expect(followUp[0].prompt).toContain('Q: Which unit should demand use?');
  expect(followUp[0].prompt).toContain('A: Unit W1');
  expect(followUp[0].prompt).not.toContain('Which solver');
  await act(async () => requests[1].resolve(response({ status: 'success', updateNotes: [], questions: [] })));
  expect(context.status).toBe('success');
});
