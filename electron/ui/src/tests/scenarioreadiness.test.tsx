import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import ScenarioValidationDialog from '../components/ScenarioValidationDialog/ScenarioValidationDialog';
import ForecastFill from '../components/ScenarioCompletion/ForecastFill';

test('building a model is not presented as proof of feasibility', () => {
  render(<ScenarioValidationDialog open loading={false} result={{valid: true, state: 'model_built', model_check: 'passed', feasibility: 'not_run'}}
    onClose={jest.fn()} onCheckFeasibility={jest.fn()}/>);
  expect(screen.getByText(/Feasibility has not been tested/)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Check feasibility'})).toBeInTheDocument();
});

test('infeasibility blocks advance and links an issue to its row and period', () => {
  const select = jest.fn();
  const issue = {code: 'invalid_value', section: 'forecasts', severity: 'error' as const,
    table: 'PadRates', row: ['P1'], period: 'T02', message: 'Enter a nonnegative production forecast.'};
  render(<ScenarioValidationDialog open loading={false} result={{valid: false, state: 'infeasible', issues: [issue]}}
    onClose={jest.fn()} onSelectIssue={select}/>);
  expect(screen.queryByRole('button', {name: 'Advance to Optimization Setup'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: /Open PadRates · P1 · T02/}));
  expect(select).toHaveBeenCalledWith(issue);
});

test('forecast fill previews the scope and preserves entered values by default', async () => {
  const save = jest.fn().mockResolvedValue(true);
  render(<ForecastFill name="PadRates" unit="bbl/day" disabled={false} periods={['T01','T02']}
    table={{ProductionPads: ['P1','P2'], T01: [100, ''], T02: ['', 20]}} onSave={save}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Fill forecast values'}));
  expect(screen.getByRole('button', {name: 'Apply changes'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {name: 'Preview changes'}));
  expect(screen.getByText(/2 cells will change to 0/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Apply changes'}));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ProductionPads: ['P1','P2'], T01: [100,0], T02: [0,20]}));
});

test('editing a fill value invalidates the preview and prevents accidental bulk overwrite', () => {
  render(<ForecastFill name="PadRates" unit="bbl/day" disabled={false} periods={['T01']}
    table={{ProductionPads: ['P1'], T01: ['']}} onSave={jest.fn()}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Fill forecast values'}));
  fireEvent.click(screen.getByRole('button', {name: 'Preview changes'}));
  fireEvent.change(screen.getByLabelText('Value (bbl/day)'), {target: {value: '500'}});
  expect(screen.getByRole('button', {name: 'Apply changes'})).toBeDisabled();
});

test('validation dialog shows Review with AI when there are no errors and Fix with AI only for errors', () => {
  const onAskAI = jest.fn();
  const warning = {code: 'default_used', section: 'costs', severity: 'warning' as const,
    table: 'BeneficialReuseCost', row: ['O1'], message: 'Uses default 0.'};
  const error = {code: 'missing_value', section: 'forecasts', severity: 'error' as const,
    table: 'PadRates', row: ['P1'], period: 'T01', message: 'Enter a forecast.'};

  const {rerender} = render(
    <ScenarioValidationDialog open loading={false}
      result={{valid: true, state: 'model_built', error_count: 0, warning_count: 0, issues: []}}
      onAskAI={onAskAI} onClose={jest.fn()}/>
  );
  expect(screen.getByRole('button', {name: 'Review with AI'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Fix with AI'})).not.toBeInTheDocument();

  rerender(
    <ScenarioValidationDialog open loading={false}
      result={{valid: true, state: 'model_built', error_count: 0, warning_count: 1, issues: [warning]}}
      onAskAI={onAskAI} onClose={jest.fn()}/>
  );
  expect(screen.getByRole('button', {name: 'Review with AI'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Fix with AI'})).not.toBeInTheDocument();

  rerender(
    <ScenarioValidationDialog open loading={false}
      result={{valid: false, state: 'needs_input', error_count: 1, warning_count: 0, issues: [error]}}
      onAskAI={onAskAI} onClose={jest.fn()}/>
  );
  fireEvent.click(screen.getByRole('button', {name: 'Fix with AI'}));
  expect(screen.queryByRole('button', {name: 'Review with AI'})).not.toBeInTheDocument();
  expect(onAskAI).toHaveBeenCalledTimes(1);

  rerender(
    <ScenarioValidationDialog open loading={false}
      result={{valid: false, state: 'infeasible', error_count: 0, warning_count: 0, issues: []}}
      onAskAI={onAskAI} onClose={jest.fn()}/>
  );
  expect(screen.getByRole('button', {name: 'Fix with AI'})).toBeInTheDocument();
});
