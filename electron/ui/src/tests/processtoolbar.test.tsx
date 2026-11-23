import { fireEvent, render, screen } from '@testing-library/react';
import ProcessToolbar from "../components/ProcessToolbar/ProcessToolbar"
import mockScenario from './data/mockScenario.json'
import * as React from 'react'

const mockFunction = () => {
    console.log("function");
};

const mockSelected = 0;


test('test process toolbar', () => {
    render( <ProcessToolbar 
            selected={mockSelected} 
            scenarioData={mockScenario}
            handleSelection={mockFunction}
            /> )

    expect(screen.getByRole('button', {  name: /data_input/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {  name: /optimization/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {  name: /results/i})).toBeInTheDocument();
    expect(screen.getByRole('separator', {  name: /bottom_divider/i})).toBeInTheDocument();

})

test('process toolbar blocks optimization setup while staged AI edits are pending', () => {
    const { rerender } = render(
        <ProcessToolbar
            selected={0}
            scenario={mockScenario}
            handleSelection={mockFunction}
            aiStagedCount={0}
        />
    );
    expect(screen.getByRole('button', { name: /optimization/i })).toBeEnabled();

    rerender(
        <ProcessToolbar
            selected={0}
            scenario={mockScenario}
            handleSelection={mockFunction}
            aiStagedCount={2}
        />
    );
    expect(screen.getByRole('button', { name: /optimization/i })).toBeDisabled();
});

test('process toolbar global revert button reflects canRevert and invokes onRevert', () => {
    const onRevert = jest.fn();
    const { rerender } = render(
        <ProcessToolbar
            selected={0}
            scenario={mockScenario}
            handleSelection={mockFunction}
            canRevert={false}
            revertLabel="No changes to revert"
            onRevert={onRevert}
        />
    );
    const revertBtn = screen.getByRole('button', { name: /revert/i });
    expect(revertBtn).toBeDisabled();

    rerender(
        <ProcessToolbar
            selected={0}
            scenario={mockScenario}
            handleSelection={mockFunction}
            canRevert={true}
            revertLabel="Revert: Saved PadRates"
            onRevert={onRevert}
        />
    );
    expect(screen.getByRole('button', { name: /revert/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /revert/i }));
    expect(onRevert).toHaveBeenCalledTimes(1);
});