import React, {useEffect, useState} from 'react';
import {Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Tooltip, Typography} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type {ValidationIssue} from '../../types';

export interface InlineCellEditDraft {
  table: string;
  keys: string[];
  rawValue: string;
}

export interface EditableIssueTarget {
  editKey: string;
  table: string;
  keys: string[];
  quickValue: number | null;
  quickLabel: string | null;
}

export function getEditableIssueTarget(issue: ValidationIssue): EditableIssueTarget | null {
  if (!issue.table || issue.table === 'TimePeriods' || issue.table === 'Units' || issue.area === 'map') {
    return null;
  }
  let keys: string[] = [];
  if (issue.code === 'missing_value' || issue.code === 'default_used' || issue.code === 'invalid_value') {
    keys = [...(issue.row || []), ...(issue.period ? [issue.period] : [])];
  } else if (
    issue.code === 'nonnumeric_value' ||
    issue.code === 'initial_storage_capacity' ||
    issue.code === 'network_capacity'
  ) {
    keys = [...(issue.row || [])];
  } else {
    return null;
  }
  if (!keys.length) return null;

  let quickValue: number | null = null;
  let quickLabel: string | null = null;
  if (issue.code === 'default_used') {
    const match = issue.message.match(/The model uses (-?\d+(?:\.\d+)?)\b/);
    if (match) {
      quickValue = Number(match[1]);
      quickLabel = `Use ${match[1]}`;
    }
  } else if (issue.code === 'missing_value' && /explicit zero/i.test(issue.message)) {
    quickValue = 0;
    quickLabel = 'Set 0';
  }

  return {
    editKey: JSON.stringify([issue.table, ...keys]),
    table: issue.table,
    keys,
    quickValue,
    quickLabel,
  };
}

export const isValidDraftNumber = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
};

export default function ValidationIssues({
  issues,
  onSelect,
  limit = 12,
  cellEdits,
  onCellEditChange,
  onSubmitCellEdits,
  unitsByTable,
  editingDisabled = false,
}: {
  issues: ValidationIssue[];
  onSelect?: (issue: ValidationIssue) => void;
  limit?: number;
  cellEdits?: Record<string, InlineCellEditDraft>;
  onCellEditChange?: (editKey: string, draft: InlineCellEditDraft | null) => void;
  onSubmitCellEdits?: () => void;
  unitsByTable?: Record<string, string>;
  editingDisabled?: boolean;
}) {
  const [helpIssue, setHelpIssue] = useState<ValidationIssue | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(limit);
  useEffect(() => {
    setVisibleLimit(limit);
  }, [limit, issues.length]);

  const effectiveLimit = onCellEditChange ? visibleLimit : limit;

  return <><Box component="ul" sx={{pl: 2.5, my: 1, textAlign: 'left'}}>
    {issues.slice(0, effectiveLimit).map((issue, index) => {
      const editableTarget = onCellEditChange ? getEditableIssueTarget(issue) : null;
      const draftRaw = editableTarget ? cellEdits?.[editableTarget.editKey]?.rawValue ?? '' : '';
      const hasDraftText = draftRaw.trim().length > 0;
      const isInvalidNumber = hasDraftText && !isValidDraftNumber(draftRaw);
      const unitLabel = editableTarget ? unitsByTable?.[editableTarget.table] || '' : '';

      return <Box component="li" key={editableTarget ? `${editableTarget.editKey}-${index}` : `${issue.code}-${index}`} sx={{mb: 1.25}}>
        <Box sx={{display: 'flex', alignItems: 'flex-start', gap: 0.5}}>
          <Typography variant="body2" color={issue.severity === 'error' ? 'error.main' : 'text.secondary'}>{issue.message}</Typography>
          {issue.help && <Tooltip title="How to address this issue">
            <IconButton size="small" aria-label={`How to address: ${issue.message}`} onClick={() => setHelpIssue(issue)}>
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{mt: editableTarget ? 0.5 : 0}}>
          {editableTarget && onCellEditChange && (
            <>
              <TextField
                size="small"
                value={draftRaw}
                disabled={editingDisabled}
                error={isInvalidNumber}
                placeholder="Enter value…"
                onChange={event => {
                  const nextVal = event.target.value;
                  if (!nextVal.trim()) {
                    onCellEditChange(editableTarget.editKey, null);
                  } else {
                    onCellEditChange(editableTarget.editKey, {
                      table: editableTarget.table,
                      keys: editableTarget.keys,
                      rawValue: nextVal,
                    });
                  }
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && onSubmitCellEdits && !isInvalidNumber) {
                    event.preventDefault();
                    onSubmitCellEdits();
                  }
                }}
                inputProps={{
                  'aria-label': `Value for ${editableTarget.table} ${editableTarget.keys.join(' / ')}`,
                  inputMode: 'decimal',
                }}
                sx={{width: 150, bgcolor: hasDraftText && !isInvalidNumber ? 'rgba(1, 103, 143, 0.06)' : '#ffffff'}}
              />
              {unitLabel && (
                <Typography variant="caption" color="text.secondary">
                  {unitLabel}
                </Typography>
              )}
              {editableTarget.quickLabel !== null && draftRaw.trim() !== String(editableTarget.quickValue) && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={editingDisabled}
                  aria-label={`${editableTarget.quickLabel} for ${editableTarget.table} ${editableTarget.keys.join(' / ')}`}
                  onClick={() =>
                    onCellEditChange(editableTarget.editKey, {
                      table: editableTarget.table,
                      keys: editableTarget.keys,
                      rawValue: String(editableTarget.quickValue),
                    })
                  }
                  sx={{textTransform: 'none', py: 0.25}}
                >
                  {editableTarget.quickLabel}
                </Button>
              )}
              {isInvalidNumber && (
                <Typography variant="caption" color="error">
                  Enter a finite number
                </Typography>
              )}
            </>
          )}
          {onSelect && <Button size="small" onClick={() => onSelect(issue)}>
            {issue.table === 'TimePeriods' ? 'Review planning periods' : issue.area === 'map' ? 'Review network' : `Open ${issue.table || 'optimization settings'}`}
            {issue.row?.length ? ` · ${issue.row.join(' / ')}` : ''}{issue.period ? ` · ${issue.period}` : ''}
          </Button>}
        </Stack>
      </Box>;
    })}
    {issues.length > effectiveLimit && (
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{mt: 0.5}}>
        <Typography variant="body2">{issues.length - effectiveLimit} more items in this section. Resolve these and check again.</Typography>
        {onCellEditChange && (
          <Button size="small" onClick={() => setVisibleLimit(curr => curr + 25)} sx={{textTransform: 'none'}}>
            Show more
          </Button>
        )}
      </Stack>
    )}
  </Box>
    <Dialog open={!!helpIssue} onClose={() => setHelpIssue(null)} fullWidth maxWidth="sm" aria-labelledby="issue-help-title">
      <DialogTitle id="issue-help-title">How to address this issue</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{mb: 2}}>{helpIssue?.message}</Typography>
        <Typography>{helpIssue?.help?.rule}</Typography>
        <Box component="ol" sx={{pl: 2.5}}>{helpIssue?.help?.steps.map((step, index) =>
          <Typography component="li" variant="body2" key={index} sx={{mb: 1}}>{step}</Typography>)}</Box>
      </DialogContent>
      <DialogActions><Button onClick={() => setHelpIssue(null)}>Close</Button>
        {onSelect && helpIssue && <Button onClick={() => { onSelect(helpIssue); setHelpIssue(null); }}>Review affected input</Button>}
      </DialogActions>
    </Dialog>
  </>;
}
