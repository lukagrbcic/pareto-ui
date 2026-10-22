import { render, screen } from '@testing-library/react';
import Bottombar from "../components/Bottombar/Bottombar"
import mockScenario from './data/mockScenario.json'
import * as React from 'react'

jest.mock("../components/AIPromptDialog/AIPromptDialog", () => () => null);
let mockAIAvailable = false;
jest.mock("../context/AIPromptContext", () => ({useAIPrompt: () => ({isAvailable: mockAIAvailable})}));

beforeEach(() => { mockAIAvailable = false; });

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
