/**
 * AI-feature review tests — personal verification suite, kept separate from the
 * main test suite (see docs/ai-feature-tests.md). These exercise the Bottombar
 * wiring: validation-findings auto-attach and the AI-availability gating of
 * "Fix with AI".
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import Bottombar from "../../components/Bottombar/Bottombar"
import mockScenario from '../data/mockScenario.json'
import * as React from 'react'
import { modelBuilt } from '../fixtures/validation';

let dialogProps: any = null;
jest.mock("../../components/AIPromptDialog/AIPromptDialog", () => (props: any) => {
  dialogProps = props;
  return null;
});
let mockAIAvailable = false;
jest.mock("../../context/AIPromptContext", () => ({useAIPrompt: () => ({isAvailable: mockAIAvailable})}));

const originalFetch = global.fetch;
beforeEach(() => {
  mockAIAvailable = false;
  dialogProps = null;
  global.fetch = originalFetch;
});
afterEach(() => { global.fetch = originalFetch; });

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

test.each([false, true])('Fix with AI follows AI availability (%s)', async (available) => {
    mockAIAvailable = available;
    const infeasible = {...modelBuilt, valid: false, state: 'infeasible', feasibility: 'infeasible'};
    global.fetch = jest.fn((url: string) => {
      if (String(url).includes('/validate_scenario/')) {
        return Promise.resolve({ok: true, status: 200, json: async () => infeasible});
      }
      return Promise.resolve({ok: true, status: 200, json: async () => ({})});
    }) as jest.Mock;
    render(<Bottombar section={0} backgroundTasks={[]} setDisableOptimize={jest.fn()}
      scenario={{...mockScenario, results: {status: 'Incomplete'}}} />);
    fireEvent.click(screen.getByRole('button', {name: /Validate Scenario/i}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Close'})).toBeEnabled());
    expect(Boolean(screen.queryByRole('button', {name: /Fix with AI/i}))).toBe(available);
});
