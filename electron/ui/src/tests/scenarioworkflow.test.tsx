import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import ScenarioCompletion from '../components/ScenarioCompletion/ScenarioCompletion';
import Bottombar from '../components/Bottombar/Bottombar';
import fixture from './fixtures/scenario-contract.json';
import {modelBuilt, readiness} from './fixtures/validation';

jest.mock('../AppContext', () => ({useApp: () => ({port: 50011})}));
const mockSaved = jest.fn();
jest.mock('../context/ScenarioContext', () => ({useScenario: () => ({acceptSavedScenario: mockSaved, inputFocus: null})}));
jest.mock('../components/AIPromptDialog/AIPromptDialog', () => () => null);
jest.mock('../context/AIPromptContext', () => ({
  useAIPrompt: () => ({isAvailable: false}),
  useOptionalAIPrompt: () => ({isAvailable: false}),
}));

const originalFetch = global.fetch;
let consoleError: jest.SpyInstance;
beforeEach(() => {
  mockSaved.mockReset(); global.fetch = jest.fn();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {global.fetch = originalFetch; consoleError.mockRestore();});
function response(body: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ok: status >= 200 && status < 300, status, json: async () => body});
}
const props = {port: 50011, scenario: fixture, section: 0, backgroundTasks: [],
  syncScenarioData: jest.fn(), handleSelection: jest.fn()};
beforeEach(() => {props.syncScenarioData.mockReset(); props.handleSelection.mockReset();});

test('an empty readiness response cannot claim inputs are complete', async () => {
  response({});
  render(<ScenarioCompletion scenario={fixture} disabled={false} onSelect={jest.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid response/i);
  expect(screen.queryByText(/Required inputs are complete/)).not.toBeInTheDocument();
});

test('an obsolete readiness request cannot display an error after inputs change', async () => {
  let reject: (reason: unknown) => void;
  (global.fetch as jest.Mock).mockReturnValueOnce(new Promise((_resolve, fail) => {reject = fail;}));
  const {rerender} = render(<ScenarioCompletion scenario={fixture} disabled={false} onSelect={jest.fn()}/>);
  const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal;
  response({...readiness, revision: 'new-revision'});
  rerender(<ScenarioCompletion scenario={{...fixture, input_revision: 'new-revision'}} disabled={false} onSelect={jest.fn()}/>);
  await screen.findByText(/Required inputs are complete/);
  await act(async () => reject(new DOMException('Request cancelled', 'AbortError')));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a malformed planning-period save keeps the form open without accepting a scenario', async () => {
  response(readiness);
  response({...fixture, id: 1});
  render(<ScenarioCompletion scenario={fixture} disabled={false} onSelect={jest.fn()}/>);
  await screen.findByText(/Required inputs are complete/);
  fireEvent.click(screen.getByRole('button', {name: 'Planning periods (2)'}));
  fireEvent.change(screen.getByLabelText('Periods in chronological order'), {target: {value: 'T01\nT03'}});
  fireEvent.click(screen.getByRole('button', {name: 'Apply planning periods'}));
  expect(await screen.findByText(/Invalid response at/)).toBeVisible();
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByLabelText('Periods in chronological order')).toHaveValue('T01\nT03');
  expect(mockSaved).not.toHaveBeenCalled();
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual({periods: ['T01', 'T03'], revision: fixture.input_revision});
});

test('scenario zero can build and check feasibility without treating an inconclusive solve as infeasible', async () => {
  response(modelBuilt);
  response({...modelBuilt, state: 'not_determined', feasibility: 'not_determined', error: 'Solve budget reached.'});
  render(<Bottombar {...props}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Validate Scenario'}));
  await screen.findByText(/Feasibility has not been tested/);
  expect(global.fetch).toHaveBeenNthCalledWith(1, 'http://localhost:50011/validate_scenario/0', expect.any(Object));
  fireEvent.click(screen.getByRole('button', {name: 'Check feasibility'}));
  await screen.findByText('Feasibility has not been determined.');
  expect(screen.queryByText(/solver found this scenario infeasible/)).not.toBeInTheDocument();
  expect(props.syncScenarioData).toHaveBeenCalledTimes(2);
});

test('advance conflicts retain server recovery information and do not navigate', async () => {
  response(modelBuilt);
  response({detail: {message: 'Validate the current inputs before advancing.',
    validation: {...modelBuilt, state: 'outdated', valid: false}}}, 409);
  render(<Bottombar {...props}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Validate Scenario'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Advance to Optimization Setup'}));
  await screen.findByText('Validate the current inputs before advancing.');
  expect(screen.getByText(/Inputs changed during the check/)).toBeVisible();
  expect(props.handleSelection).not.toHaveBeenCalled();
  expect(props.syncScenarioData).toHaveBeenCalledTimes(1);
});

test('malformed validation does not enable advance or reload the draft', async () => {
  response({valid: true});
  render(<Bottombar {...props}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Validate Scenario'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid response/i);
  expect(screen.queryByRole('button', {name: 'Advance to Optimization Setup'})).not.toBeInTheDocument();
  expect(props.syncScenarioData).not.toHaveBeenCalled();
});

test('a delayed validation result cannot act on a different selected scenario', async () => {
  let resolve: (value: unknown) => void;
  (global.fetch as jest.Mock).mockReturnValueOnce(new Promise(done => {resolve = done;}));
  const {rerender} = render(<Bottombar {...props}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Validate Scenario'}));
  rerender(<Bottombar {...props} scenario={{...fixture, id: 1}}/>);
  await act(async () => resolve({ok: true, status: 200, json: async () => modelBuilt}));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(props.syncScenarioData).not.toHaveBeenCalled();
  expect(props.handleSelection).not.toHaveBeenCalled();
});

test('inline completion editing quick-fills defaults and batch-saves multiple cells without leaving the checklist', async () => {
  const readinessWithFlowback = {
    ...readiness,
    warning_count: 2,
    sections: [
      {
        id: 'forecasts',
        title: 'Planning periods and forecasts',
        error_count: 0,
        warning_count: 2,
        fillable_count: 2,
      },
    ],
    issues: [
      {
        code: 'default_used',
        section: 'forecasts',
        severity: 'warning' as const,
        table: 'FlowbackRates',
        row: ['CP01'],
        period: 'T01',
        message: 'FlowbackRates: CP01 / T01 is blank. The model uses 0, following the imported Excel convention; review this assumption.',
      },
      {
        code: 'default_used',
        section: 'forecasts',
        severity: 'warning' as const,
        table: 'FlowbackRates',
        row: ['CP01'],
        period: 'T02',
        message: 'FlowbackRates: CP01 / T02 is blank. The model uses 0, following the imported Excel convention; review this assumption.',
      },
    ],
  };

  const savedScenario = {
    ...fixture,
    input_revision: 'rev-after-inline-save',
  };

  response(readinessWithFlowback);
  response(savedScenario);
  const onSelect = jest.fn();

  render(<ScenarioCompletion scenario={fixture} disabled={false} onSelect={onSelect} />);

  // Auto-expands the section with warnings and renders inline inputs + Use 0 quick buttons
  const useZeroT01 = await screen.findByRole('button', { name: 'Use 0 for FlowbackRates CP01 / T01' });
  fireEvent.click(useZeroT01);

  const inputT02 = screen.getByLabelText('Value for FlowbackRates CP01 / T02');
  fireEvent.change(inputT02, { target: { value: '250' } });

  const saveBtn = screen.getByRole('button', { name: 'Save 2 edits' });
  fireEvent.click(saveBtn);

  await waitFor(() => expect(mockSaved).toHaveBeenCalledWith(savedScenario));
  expect(onSelect).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenNthCalledWith(
    2,
    'http://localhost:50011/save_completion_cells/0',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual({
    revision: readiness.revision,
    edits: [
      { table: 'FlowbackRates', keys: ['CP01', 'T01'], value: 0 },
      { table: 'FlowbackRates', keys: ['CP01', 'T02'], value: 250 },
    ],
  });
});
