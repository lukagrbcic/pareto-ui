import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import Bottombar from "../components/Bottombar/Bottombar"
import mockScenario from './data/mockScenario.json'
import * as React from 'react'
import { modelBuilt } from './fixtures/validation';

let dialogProps: any = null;
jest.mock("../components/AIPromptDialog/AIPromptDialog", () => (props: any) => {
  dialogProps = props;
  return null;
});
let mockAIAvailable = false;
jest.mock("../context/AIPromptContext", () => ({useAIPrompt: () => ({isAvailable: mockAIAvailable})}));

const originalFetch = global.fetch;
beforeEach(() => {
  mockAIAvailable = false;
  dialogProps = null;
  global.fetch = originalFetch;
});
afterEach(() => { global.fetch = originalFetch; });

const mockFunction = () => {
    console.log("function");
};

const mockSections = [ 0, 1, 2 ] ;
const mockCategory = null;

test.each([false, true])('AI input filling follows availability (%s)', (available) => {
    mockAIAvailable = available;
    render(<Bottombar section={0} backgroundTasks={[]} setDisableOptimize={jest.fn()}
      scenario={{...mockScenario, results: {status: 'Incomplete'}}} />);
    expect(Boolean(screen.queryByRole('button', {name: /AI Fill Inputs/i}))).toBe(available);
    expect(screen.getByRole('button', {name: /Generate Spreadsheet From Network/i})).toBeEnabled();
});

test('standalone AI fill attaches the latest validation findings', async () => {
    mockAIAvailable = true;
    global.fetch = jest.fn((url: string) => {
      if (String(url).includes('/validate_scenario/')) {
        return Promise.resolve({ok: true, status: 200, json: async () => modelBuilt});
      }
      return Promise.resolve({ok: true, status: 200, json: async () => ({})});
    }) as jest.Mock;
    render(<Bottombar section={0} backgroundTasks={[]} setDisableOptimize={jest.fn()}
      scenario={{...mockScenario, results: {status: 'Incomplete'}}} />);
    fireEvent.click(screen.getByRole('button', {name: /Validate Scenario/i}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Close'})).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Close'})); });
    await waitFor(() => expect(screen.getByRole('button', {name: /AI Fill Inputs/i})).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: /AI Fill Inputs/i})); });
    expect(dialogProps).not.toBeNull();
    expect(dialogProps.validationFindings).toMatchObject({state: 'model_built', model_check: 'passed'});
});


test('test bottom bar: data input section', () => {
    render( <Bottombar 
            section={mockSections[0]} 
            scenario={mockScenario}
            handleSelection={mockFunction}
            handleRunModel={mockFunction}
            /> )

    expect(screen.getByRole('button', {  name: /continue to optimization/i})).toBeInTheDocument();

})

test('test bottom bar: optimize section', () => {
    render( <Bottombar 
            section={mockSections[1]} 
            scenario={mockScenario}
            handleSelection={mockFunction}
            handleRunModel={mockFunction}
            /> )

    expect(screen.getByRole('button', {  name: /back/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {  name: /Optimize/i})).toBeInTheDocument();

})

test('test bottom bar: results section', () => {
    render( <Bottombar 
            section={mockSections[2]} 
            scenario={mockScenario}
            handleSelection={mockFunction}
            handleRunModel={mockFunction}
            /> )

            expect(screen.getByRole('button', {  name: /review inputs & settings/i})).toBeInTheDocument();

})
