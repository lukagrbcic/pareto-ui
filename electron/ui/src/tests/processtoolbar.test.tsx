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

test('process toolbar renders Redo and Session Change History popover', () => {
    const onRevert = jest.fn();
    const onRedo = jest.fn();
    render(
        <ProcessToolbar
            selected={0}
            scenario={mockScenario}
            handleSelection={mockFunction}
            canRevert={true}
            revertLabel="Revert: Saved Pad Rates"
            onRevert={onRevert}
            canRedo={true}
            redoLabel="Redo: AI changes (1 table, 2 cells)"
            onRedo={onRedo}
            undoHistory={[
                { id: 'u1', label: 'Saved Pad Rates', source: 'user', timestamp: '2026-11-23T18:00:00Z', snapshot: {} },
            ]}
            redoHistory={[
                { id: 'r1', label: 'AI changes (1 table, 2 cells)', source: 'ai', timestamp: '2026-11-23T18:01:00Z', snapshot: {} },
            ]}
        />
    );

    const redoBtn = screen.getByRole('button', { name: /redo/i });
    expect(redoBtn).toBeEnabled();
    fireEvent.click(redoBtn);
    expect(onRedo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /change history/i }));
    expect(screen.getByText('Session Change History')).toBeVisible();
    expect(screen.getByText('Available to Redo (1)')).toBeVisible();
    expect(screen.getByText('Saved Undo Stack (1)')).toBeVisible();
    expect(screen.getByText('Saved Pad Rates')).toBeVisible();
    expect(screen.getByText('AI changes (1 table, 2 cells)')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Undo latest change' }));
    expect(onRevert).toHaveBeenCalledTimes(1);
});