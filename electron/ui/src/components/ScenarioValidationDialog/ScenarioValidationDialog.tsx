import React from 'react';
import {Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography} from '@mui/material';
import type {ScenarioValidation, ValidationIssue} from '../../types';
import ValidationIssues from './ValidationIssues';

const STATES: Record<string, string> = {
  needs_input: 'Scenario inputs need attention.', inputs_complete: 'Required inputs are complete.',
  model_built: 'The selected model builds successfully. Feasibility has not been tested.',
  feasible: 'A feasible plan was found with slack variables disabled.',
  infeasible: 'The solver found this scenario infeasible with slack variables disabled.',
  not_determined: 'Feasibility has not been determined.', build_failed: 'The selected model could not be built.',
  outdated: 'Inputs changed during the check. Validate the current scenario again.',
};

export default function ScenarioValidationDialog({open, loading, advancing = false, error, result,
  onAdvance, onCheckFeasibility, onSelectIssue, onSelectTable, onAskAI, onClose}: {
  open: boolean; loading: boolean; advancing?: boolean; error?: string | null; result?: ScenarioValidation | null;
  onAdvance?: () => void; onCheckFeasibility?: () => void; onSelectIssue?: (issue: ValidationIssue) => void;
  onSelectTable?: (table: string) => void; onAskAI?: (result: ScenarioValidation) => void; onClose: () => void;
}) {
  const issues = result?.issues || [];
  return <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="md">
    <DialogTitle>Scenario Validation</DialogTitle>
    <DialogContent dividers>
      {loading && <Box sx={{display: 'flex', gap: 2, alignItems: 'center'}}><CircularProgress size={20}/><Typography>Checking the saved scenario… A feasibility solve has a 20-second solver budget.</Typography></Box>}
      {!loading && error && <Alert severity="error">{error}</Alert>}
      {!loading && result && <>
        <Alert severity={result.state === 'feasible' ? 'success' : result.valid ? 'info' : 'warning'}>
          {STATES[result.state || ''] || 'Review the scenario checks below.'}
        </Alert>
        {result.error && <Alert severity="error" sx={{mt: 1}}>{result.error}</Alert>}
        <Typography variant="body2" sx={{mt: 2}}>Input checks: {result.error_count || 0} issues, {result.warning_count || 0} assumptions to review. Model construction: {result.model_check || 'not run'}. Feasibility: {result.feasibility || 'not run'}.</Typography>
        {result.state === 'infeasible' && <Typography variant="body2" sx={{mt: 1}}>Review routes, available capacities, period forecasts, storage balances, and fixed decisions. Passing total supply/capacity checks does not prove that water can travel through the network.</Typography>}
        <ValidationIssues issues={[...issues.filter(i => i.severity === 'error'), ...issues.filter(i => i.severity === 'warning')]}
          limit={40} onSelect={issue => onSelectIssue ? onSelectIssue(issue) : issue.table && onSelectTable?.(issue.table)}/>
        {result.truncated && <Typography variant="body2">Additional issues remain. Resolve these and validate again.</Typography>}
      </>}
    </DialogContent>
    <DialogActions>
      {!loading && result && onAskAI && (issues.length > 0 || result.state === 'infeasible') && <Button onClick={() => onAskAI(result)} variant="outlined">Fix with AI</Button>}
      {!loading && result?.valid && onCheckFeasibility && result.feasibility !== 'feasible' && <Button onClick={onCheckFeasibility} variant="outlined">Check feasibility</Button>}
      {!loading && !error && result?.valid && result.state !== 'outdated' && <Button onClick={onAdvance} disabled={advancing} variant="contained">Advance to Optimization Setup</Button>}
      <Button onClick={onClose} disabled={loading}>Close</Button>
    </DialogActions>
  </Dialog>;
}
