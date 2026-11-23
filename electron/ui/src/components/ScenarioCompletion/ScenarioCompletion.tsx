import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import {useApp} from '../../AppContext';
import {useScenario} from '../../context/ScenarioContext';
import {useOptionalAIPrompt} from '../../context/AIPromptContext';
import {ApiClientError} from '../../services/apiClient';
import {
  advanceToOptimizationSetup,
  checkScenarioFeasibility,
  getScenarioReadiness,
  saveCompletionCells,
  savePlanningHorizon,
  validateScenario,
} from '../../services/app.service';
import type {CompletionCellEdit, Scenario, ScenarioValidation, ScenarioValidationResult, ValidationIssue} from '../../types';
import {hasScenarioValidationErrors} from '../ScenarioValidationDialog/ScenarioValidationDialog';
import ValidationIssues, {isValidDraftNumber, type InlineCellEditDraft} from '../ScenarioValidationDialog/ValidationIssues';
import IssueFill from './IssueFill';

const VALIDATION_STATES: Record<string, string> = {
  needs_input: 'Scenario inputs need attention.',
  inputs_complete: 'Required inputs are complete.',
  model_built: 'The selected model builds successfully. Feasibility has not been tested.',
  feasible: 'A feasible plan was found with slack variables disabled.',
  infeasible: 'The solver found this scenario infeasible with slack variables disabled.',
  not_determined: 'Feasibility has not been determined.',
  build_failed: 'The selected model could not be built.',
  outdated: 'Inputs changed during the check. Validate the current scenario again.',
};

const modelCheckCache = new Map<string, ScenarioValidationResult>();

export default function ScenarioCompletion({
  scenario,
  disabled,
  onSelect,
  validateSignal = 0,
  onAdvance,
  syncScenarioData,
}: {
  scenario: Scenario;
  disabled: boolean;
  onSelect: (issue: ValidationIssue) => void;
  validateSignal?: number;
  onAdvance?: () => void;
  syncScenarioData?: () => void;
}) {
  const {port} = useApp();
  const {acceptSavedScenario, inputFocus} = useScenario();
  const {isAvailable: isAIAvailable, openPanel, sendChatMessage} = useOptionalAIPrompt();
  const [readiness, setReadiness] = useState<ScenarioValidationResult | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const [periodText, setPeriodText] = useState('');
  const [saving, setSaving] = useState(false);
  const [cellEdits, setCellEdits] = useState<Record<string, InlineCellEditDraft>>({});
  const [savingCells, setSavingCells] = useState(false);
  const [cellSaveError, setCellSaveError] = useState<string | null>(null);
  const [validatingModel, setValidatingModel] = useState(false);
  const [checkingFeasibility, setCheckingFeasibility] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const validationVersion = useRef(0);
  const handledValidateSignal = useRef(0);

  const autoSelectSectionIfNeeded = (result: ScenarioValidation) => {
    setSection(prev => {
      if (prev !== null) return prev;
      const firstWithErrors = result.sections?.find(s => s.error_count > 0);
      if (firstWithErrors) return firstWithErrors.id;
      const firstWithWarnings = result.sections?.find(s => s.warning_count > 0);
      return firstWithWarnings ? firstWithWarnings.id : null;
    });
  };

  useEffect(() => {
    setCellEdits({});
    setCellSaveError(null);
    setSection(null);
    setValidatingModel(false);
    setCheckingFeasibility(false);
    setAdvancing(false);
    validationVersion.current += 1;
  }, [scenario.id]);

  const handleRunValidation = async (solve = false) => {
    if (disabled) return;
    const version = ++validationVersion.current;
    setValidatingModel(true);
    setCheckingFeasibility(solve);
    setError(null);
    try {
      const result = await (solve
        ? checkScenarioFeasibility(port, scenario.id)
        : validateScenario(port, scenario.id));
      if (validationVersion.current !== version) return;
      modelCheckCache.set(`${scenario.id}:${result.revision}`, result);
      setReadiness(result);
      autoSelectSectionIfNeeded(result);
      syncScenarioData?.();
    } catch (err) {
      if (validationVersion.current !== version) return;
      setError(err instanceof Error ? err.message : 'Unable to validate scenario.');
    } finally {
      if (validationVersion.current === version) {
        setValidatingModel(false);
        setCheckingFeasibility(false);
      }
    }
  };

  useEffect(() => {
    if (disabled) return;
    if (validateSignal > handledValidateSignal.current) {
      handledValidateSignal.current = validateSignal;
      void handleRunValidation(false);
      return;
    }
    const controller = new AbortController();
    const version = ++validationVersion.current;
    setReadiness(null);
    getScenarioReadiness(port, scenario.id, controller.signal).then(result => {
      if (!controller.signal.aborted && validationVersion.current === version) {
        const cached = modelCheckCache.get(`${scenario.id}:${result.revision}`);
        const effective = cached || result;
        setReadiness(effective);
        setError(null);
        autoSelectSectionIfNeeded(effective);
      }
    }).catch(err => {
      if (!controller.signal.aborted && validationVersion.current === version) {
        setError(err.message);
      }
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, scenario.id, scenario.input_revision, scenario.data_input, scenario.optimization, disabled, validateSignal]);

  const openPeriods = () => {
    setPeriodText((readiness?.periods || scenario.data_input.df_sets.TimePeriods || []).join('\n'));
    setPeriodsOpen(true);
  };
  useEffect(() => {
    if (inputFocus?.table === 'TimePeriods') openPeriods();
    // Focus follows an explicit issue selection, not every readiness refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputFocus]);
  const selectIssue = (issue: ValidationIssue) => {
    if (issue.table === 'TimePeriods') { openPeriods(); return; }
    onSelect(issue);
  };
  const periods = periodText.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
  const removed = (readiness?.periods || []).filter(period => !periods.includes(period));
  const selectedSection = readiness?.sections?.find(item => item.id === section);
  const sectionIssues = useMemo(
    () => (readiness?.issues || []).filter(issue => issue.section === section),
    [readiness?.issues, section],
  );

  const pendingDraftEntries = useMemo(
    () => Object.entries(cellEdits).filter(([, draft]) => draft.rawValue.trim().length > 0),
    [cellEdits],
  );
  const hasInvalidDraft = useMemo(
    () => pendingDraftEntries.some(([, draft]) => !isValidDraftNumber(draft.rawValue)),
    [pendingDraftEntries],
  );

  const handleCellEditChange = (editKey: string, draft: InlineCellEditDraft | null) => {
    setCellSaveError(null);
    setCellEdits(prev => {
      const next = {...prev};
      if (!draft || !draft.rawValue.trim()) {
        delete next[editKey];
      } else {
        next[editKey] = draft;
      }
      return next;
    });
  };

  const handleSaveInlineEdits = async () => {
    if (!readiness?.revision || !pendingDraftEntries.length || hasInvalidDraft || savingCells || disabled) {
      return;
    }
    const editsPayload: CompletionCellEdit[] = pendingDraftEntries.map(([, draft]) => ({
      table: draft.table,
      keys: draft.keys,
      value: Number(draft.rawValue.trim()),
    }));
    setSavingCells(true);
    setCellSaveError(null);
    try {
      const saved = await saveCompletionCells(port, scenario.id, {
        revision: readiness.revision,
        edits: editsPayload,
      });
      setCellEdits({});
      acceptSavedScenario(saved);
    } catch (err) {
      setCellSaveError(err instanceof Error ? err.message : 'Unable to save inline edits.');
    } finally {
      setSavingCells(false);
    }
  };

  const handleAskAI = () => {
    if (!readiness) return;
    openPanel?.({
      scenarioId: scenario.id,
      revalidateOnApply: true,
    });
    const hasErrors = hasScenarioValidationErrors(readiness);
    const hasWarnings =
      (readiness.warning_count ?? 0) > 0 ||
      (readiness.issues || []).some(issue => issue.severity === 'warning');
    const autoPrompt = hasErrors
      ? 'Fix the validation issues in this scenario using reasonable defaults and explain what you changed.'
      : hasWarnings
        ? 'Review my scenario inputs and validation assumptions, check for potential bottlenecks or unusual values, and let me know if anything should be adjusted.'
        : 'Review my scenario inputs, check capacities and forecasts for any potential bottlenecks or unusual assumptions, and summarize your findings.';
    void sendChatMessage?.(scenario.id, autoPrompt, scenario.data_input, {
      validationFindings: readiness,
      revalidateOnApply: true,
      baseRevision: scenario.input_revision,
    });
  };

  const handleAdvance = async () => {
    if (advancing || disabled) return;
    const version = ++validationVersion.current;
    setAdvancing(true);
    setError(null);
    try {
      const response = await advanceToOptimizationSetup(port, scenario.id);
      if (validationVersion.current !== version) return;
      if (response?.data) {
        acceptSavedScenario(response.data);
      } else {
        syncScenarioData?.();
      }
      onAdvance?.();
    } catch (err) {
      if (validationVersion.current !== version) return;
      setError(err instanceof Error ? err.message : 'Unable to advance to optimization setup.');
      if (err instanceof ApiClientError && err.validation && readiness) {
        setReadiness({
          ...readiness,
          ...err.validation,
          valid: Boolean(err.validation.valid),
          state: err.validation.state || 'outdated',
        });
      }
    } finally {
      if (validationVersion.current === version) setAdvancing(false);
    }
  };

  const savePeriods = async () => {
    setSaving(true); setError(null);
    try {
      const data = await savePlanningHorizon(port, scenario.id, periods, readiness?.revision);
      acceptSavedScenario(data);
      setPeriodsOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save planning periods.'); }
    finally { setSaving(false); }
  };

  const busy = disabled || saving || savingCells || validatingModel || advancing;
  const hasValidationErrors = hasScenarioValidationErrors(readiness);
  const modelWasChecked = Boolean(readiness && (readiness.model_check !== 'not_run' || readiness.state === 'outdated'));

  return <Box sx={{m: 3, p: 2, border: '1px solid #c5d8e0', borderRadius: 1, bgcolor: 'white', textAlign: 'left'}}>
    <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', mb: 1}}>
      <Typography variant="subtitle1" sx={{fontWeight: 600}}>Complete &amp; validate scenario inputs</Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Button size="small" onClick={openPeriods} disabled={busy}>
          Planning periods ({readiness?.periods?.length ?? scenario.data_input.df_sets.TimePeriods?.length ?? 0})
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<FactCheckIcon />}
          disabled={busy || pendingDraftEntries.length > 0}
          onClick={() => void handleRunValidation(false)}
        >
          {validatingModel && !checkingFeasibility ? 'Validating…' : 'Validate model'}
        </Button>
        {readiness?.valid && readiness.feasibility !== 'feasible' && (
          <Button
            size="small"
            variant="outlined"
            disabled={busy || pendingDraftEntries.length > 0}
            onClick={() => void handleRunValidation(true)}
          >
            {checkingFeasibility ? 'Checking feasibility…' : 'Check feasibility'}
          </Button>
        )}
        {isAIAvailable && readiness && readiness.state !== 'outdated' && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            disabled={busy || pendingDraftEntries.length > 0}
            onClick={handleAskAI}
          >
            {hasValidationErrors ? 'Fix with AI' : 'Review with AI'}
          </Button>
        )}
        {!error && readiness?.valid && readiness.model_check === 'passed' && readiness.state !== 'outdated' && onAdvance && (
          <Button
            size="small"
            variant="contained"
            disabled={busy || pendingDraftEntries.length > 0}
            onClick={() => void handleAdvance()}
            sx={{bgcolor: '#01678f', '&:hover': {bgcolor: '#015272'}}}
          >
            {advancing ? 'Advancing…' : 'Advance to Optimization Setup'}
          </Button>
        )}
      </Stack>
    </Box>
    {disabled ? (
      <Typography variant="body2">Save your edits before checking completion.</Typography>
    ) : validatingModel ? (
      <Alert severity="info" icon={<CircularProgress size={18} />} sx={{mb: 1.5}}>
        Checking the saved scenario…{' '}
        {checkingFeasibility
          ? 'A feasibility solve has a 20-second solver budget.'
          : 'Verifying inputs and building the selected optimization model.'}
      </Alert>
    ) : !readiness && !error ? (
      <CircularProgress size={20} />
    ) : null}
    {error && !periodsOpen && <Alert severity="error" sx={{mb: 1}}>{error}</Alert>}
    {cellSaveError && <Alert severity="error" sx={{mt: 1, mb: 1}}>{cellSaveError}</Alert>}
    {readiness && !disabled && <>
      {!validatingModel && modelWasChecked && (
        <Box sx={{mb: 1.5}}>
          <Alert severity={readiness.state === 'feasible' ? 'success' : readiness.valid ? 'info' : 'warning'}>
            {VALIDATION_STATES[readiness.state || ''] || 'Review the scenario checks below.'}
          </Alert>
          {readiness.error && <Alert severity="error" sx={{mt: 1}}>{readiness.error}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{mt: 1}}>
            Input checks: {readiness.error_count || 0} issues, {readiness.warning_count || 0} assumptions to review.{' '}
            Model construction: {readiness.model_check || 'not run'}. Feasibility: {readiness.feasibility || 'not run'}.
          </Typography>
          {readiness.state === 'infeasible' && (
            <Typography variant="body2" sx={{mt: 0.75}}>
              Review routes, available capacities, period forecasts, storage balances, and fixed decisions. Passing total supply/capacity checks does not prove that water can travel through the network.
            </Typography>
          )}
        </Box>
      )}
      {!modelWasChecked && (
        <Typography variant="body2" sx={{mb: 1}}>
          {readiness.error_count ? `${readiness.error_count} input items need attention.` : 'Required inputs are complete. Use Validate Scenario to build the selected model and check feasibility.'}
          {readiness.warning_count ? ` ${readiness.warning_count} assumptions to review.` : ''}
        </Typography>
      )}
      <Box sx={{display: 'flex', gap: 1, flexWrap: 'wrap'}}>
        {(readiness.sections || []).map(item => <Chip key={item.id}
          label={`${item.title} · ${item.error_count || item.warning_count || 'complete'}`}
          color={item.error_count ? 'error' : item.warning_count ? 'warning' : 'success'}
          variant={section === item.id ? 'filled' : 'outlined'}
          onClick={() => setSection(section === item.id ? null : item.id)} />)}
      </Box>
      {pendingDraftEntries.length > 0 && (
        <Box
          sx={{
            position: 'sticky',
            top: 166,
            zIndex: 1,
            mt: 1.5,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            bgcolor: '#eef6fa',
            border: '1px solid #b5d3e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" sx={{fontWeight: 600, color: '#015272'}}>
            {pendingDraftEntries.length} inline edit{pendingDraftEntries.length === 1 ? '' : 's'} ready to save
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              color="inherit"
              disabled={savingCells}
              onClick={() => { setCellEdits({}); setCellSaveError(null); }}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={savingCells || hasInvalidDraft}
              onClick={() => void handleSaveInlineEdits()}
              sx={{bgcolor: '#01678f', '&:hover': {bgcolor: '#015272'}}}
            >
              {savingCells ? 'Saving…' : `Save ${pendingDraftEntries.length} edit${pendingDraftEntries.length === 1 ? '' : 's'}`}
            </Button>
          </Stack>
        </Box>
      )}
      {section && <>
        {!!selectedSection?.fillable_count && readiness.revision && <IssueFill key={`${scenario.id}-${section}`}
          port={port} scenarioId={scenario.id} revision={readiness.revision} section={section}
          title={selectedSection.title} count={selectedSection.fillable_count} disabled={disabled || saving || savingCells}
          onSaved={acceptSavedScenario} />}
        {sectionIssues.length === 0 ? (
          <Typography variant="body2" color="success.main" sx={{mt: 1.5}}>
            All items in {selectedSection?.title || 'this section'} are complete.
          </Typography>
        ) : (
          <ValidationIssues
            issues={sectionIssues}
            onSelect={selectIssue}
            cellEdits={cellEdits}
            onCellEditChange={handleCellEditChange}
            onSubmitCellEdits={() => void handleSaveInlineEdits()}
            unitsByTable={scenario.data_input.display_units}
            editingDisabled={disabled || saving || savingCells}
          />
        )}
      </>}
      {readiness.truncated && <Typography variant="caption">Showing the first issues. Completion counts include all checked inputs.</Typography>}
    </>}
    <Dialog open={periodsOpen} onClose={() => !saving && setPeriodsOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>Planning periods</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{mb: 2}}>Each period represents one {readiness?.units?.['decision period'] || 'week'}. Forecast rates use {readiness?.units?.volume || 'bbl'}/{readiness?.units?.time || 'day'}.</Typography>
        <TextField fullWidth multiline minRows={5} maxRows={10} label="Periods in chronological order" value={periodText}
          onChange={event => setPeriodText(event.target.value)} helperText="Separate names with commas or new lines, for example T01, T02, T03. Values stay with matching period names." />
        <Typography variant="body2" sx={{mt: 1}}>{periods.length} periods. New forecast cells will be blank.</Typography>
        {!!removed.length && <Alert severity="warning" sx={{mt: 1}}>Applying this change removes forecast values for: {removed.join(', ')}.</Alert>}
        {error && <Alert severity="error" sx={{mt: 1}}>{error}</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setPeriodsOpen(false)}>Cancel</Button>
        <Button disabled={saving || !periods.length || new Set(periods).size !== periods.length} variant="contained" onClick={savePeriods}>{saving ? 'Saving…' : 'Apply planning periods'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
