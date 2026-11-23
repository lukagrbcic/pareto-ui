import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import SendIcon from '@mui/icons-material/Send';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import { useOptionalAIPrompt } from '../../context/AIPromptContext';
import { CategoryNames } from '../../util';
import type { Scenario, ScenarioUndoEntry } from '../../types';
import type { ScenarioAIDiff } from '../../utils/aiStaging';

export const AI_PANEL_WIDTH = 400;
export const AI_PANEL_EXPANDED_WIDTH = 540;

interface AISidePanelProps {
  scenario: Scenario;
  aiDiff: ScenarioAIDiff;
  currentCategory: string | null;
  isApplying?: boolean;
  hasUnsavedTableEdits?: boolean;
  onSelectTable: (tableKey: string) => void;
  onApplyStaged: () => Promise<void>;
  onDiscardStaged: () => void;
  onRevertStagedTable?: (tableKey: string) => void;
  onRevertStagedSet?: (setName: string) => void;
  latestUndoEntry?: ScenarioUndoEntry | null;
  canRevertSaved?: boolean;
  isReverting?: boolean;
  onRevertAppliedAI?: () => Promise<void>;
}

const tableLabel = (key: string): string => CategoryNames[key] || key;

export default function AISidePanel({
  scenario,
  aiDiff,
  currentCategory,
  isApplying = false,
  hasUnsavedTableEdits = false,
  onSelectTable,
  onApplyStaged,
  onDiscardStaged,
  onRevertStagedTable,
  onRevertStagedSet,
  latestUndoEntry = null,
  canRevertSaved = false,
  isReverting = false,
  onRevertAppliedAI,
}: AISidePanelProps): JSX.Element | null {
  const {
    isAvailable,
    isPanelOpen,
    isPanelExpanded,
    setIsPanelExpanded,
    closePanel,
    isRunning,
    requestScenarioId,
    getThread,
    sendChatMessage,
    clearConversation,
  } = useOptionalAIPrompt();

  const [input, setInput] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const thread = getThread ? getThread(scenario.id) : { messages: [], stagedScenario: null, validationFindings: null };
  const { messages } = thread;
  const isRunningForScenario = Boolean(isRunning && requestScenarioId === Number(scenario.id));
  const isAnyAIRunning = Boolean(isRunning);
  const isBlockedByOtherRun = isAnyAIRunning && !isRunningForScenario;
  const activeWidth = isPanelExpanded ? AI_PANEL_EXPANDED_WIDTH : AI_PANEL_WIDTH;

  const latestQuestions = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const msg = messages[idx];
      if (msg.role === 'assistant' && msg.status !== 'applied') {
        return msg.questions || [];
      }
    }
    return [];
  }, [messages]);

  useEffect(() => {
    setAnswers({});
  }, [latestQuestions]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isRunningForScenario]);

  if (!isAvailable || !isPanelOpen) return null;

  const starterPrompts = [
    'Review this scenario and highlight any missing or unusual inputs',
    'Summarize production forecasts vs disposal and treatment capacity',
  ];

  const buildOutgoingMessage = (baseText: string): string => {
    const answered = latestQuestions
      .map(question => ({ question, answer: (answers[question] || '').trim() }))
      .filter(entry => entry.answer.length > 0);
    const transcript = answered.length
      ? `Answers to your previous questions:\n${answered
          .map(({ question, answer }) => `Q: ${question}\nA: ${answer}`)
          .join('\n')}`
      : '';
    return [baseText.trim(), transcript].filter(Boolean).join('\n\n');
  };

  const handleSend = async (overridePrompt?: string) => {
    const outgoing = overridePrompt
      ? overridePrompt.trim()
      : buildOutgoingMessage(input);
    if (!outgoing || isAnyAIRunning || hasUnsavedTableEdits || !sendChatMessage) return;
    const prevInput = input;
    const prevAnswers = answers;
    if (!overridePrompt) {
      setInput('');
      setAnswers({});
    }
    const accepted = await sendChatMessage(scenario.id, outgoing, scenario.data_input, {
      baseRevision: scenario.input_revision,
    });
    if (accepted === false && !overridePrompt) {
      setInput(prevInput);
      setAnswers(prevAnswers);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const canSend =
    !isAnyAIRunning &&
    !isApplying &&
    !hasUnsavedTableEdits &&
    (input.trim().length > 0 ||
      latestQuestions.some(q => (answers[q] || '').trim().length > 0));

  const statusChipLabel = isRunningForScenario
    ? 'Thinking…'
    : isBlockedByOtherRun
      ? 'Busy…'
      : aiDiff.hasStagedChanges
        ? `${aiDiff.totalChangedTables + aiDiff.changedSets.length} staged`
        : 'Ready';

  return (
    <Paper
      component="aside"
      aria-label="AI Scenario Assistant"
      elevation={0}
      sx={{
        position: 'fixed',
        top: '158px',
        bottom: '60px',
        right: 0,
        width: activeWidth,
        zIndex: 2,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #d5e0e6',
        backgroundColor: '#f8fbfd',
        transition: 'width 180ms ease',
      }}
    >
      {/* Width expand/collapse handle matching left Sidebar */}
      <Box
        sx={{
          position: 'absolute',
          top: 10,
          left: -16,
          zIndex: 3,
          backgroundColor: '#ffffff',
          border: '1px solid #d9dde3',
          borderRadius: '999px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
        }}
      >
        <Tooltip title={isPanelExpanded ? 'Narrow AI panel' : 'Widen AI panel'}>
          <IconButton
            size="small"
            aria-label={isPanelExpanded ? 'Narrow AI panel' : 'Widen AI panel'}
            onClick={() => setIsPanelExpanded?.(prev => !prev)}
          >
            {isPanelExpanded ? (
              <KeyboardDoubleArrowRightIcon fontSize="small" />
            ) : (
              <KeyboardDoubleArrowLeftIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Panel Header */}
      <Box
        sx={{
          px: 2,
          py: 1.25,
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2eaef',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <AutoAwesomeIcon sx={{ color: '#01678f', fontSize: 20 }} />
          <Box sx={{ minWidth: 0, textAlign: 'left' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              AI Scenario Assistant
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {scenario.name}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip
            size="small"
            label={statusChipLabel}
            color={aiDiff.hasStagedChanges ? 'primary' : 'default'}
            variant={isRunningForScenario ? 'filled' : 'outlined'}
          />
          {messages.length > 0 && (
            <Tooltip title="Clear chat & staged AI edits">
              <span>
                <IconButton
                  size="small"
                  aria-label="Clear AI conversation"
                  disabled={isRunningForScenario || isApplying}
                  onClick={() => clearConversation?.(scenario.id)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title="Hide AI panel">
            <IconButton size="small" aria-label="Close AI panel" onClick={closePanel}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* Sticky Staged Changes Bar */}
      {aiDiff.hasStagedChanges && (
        <Box
          sx={{
            px: 2,
            py: 1.25,
            backgroundColor: 'rgba(1, 103, 143, 0.09)',
            borderBottom: '1px solid rgba(1, 103, 143, 0.25)',
            textAlign: 'left',
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#015272' }}>
              Staged live in tabs:{' '}
              {aiDiff.totalChangedTables > 0 &&
                `${aiDiff.totalChangedTables} table${aiDiff.totalChangedTables === 1 ? '' : 's'} (${aiDiff.totalChangedCells} cell${aiDiff.totalChangedCells === 1 ? '' : 's'})`}
              {aiDiff.totalChangedTables > 0 && aiDiff.changedSets.length > 0 ? ' · ' : ''}
              {aiDiff.changedSets.length > 0 &&
                `${aiDiff.changedSets.length} set${aiDiff.changedSets.length === 1 ? '' : 's'}`}
            </Typography>
            <Stack direction="row" spacing={0.75}>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                disabled={isApplying || isRunningForScenario}
                onClick={onDiscardStaged}
                sx={{ py: 0.2, px: 1, fontSize: '0.72rem' }}
              >
                Discard
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={isApplying || isRunningForScenario || hasUnsavedTableEdits}
                onClick={() => void onApplyStaged()}
                sx={{
                  py: 0.2,
                  px: 1.25,
                  fontSize: '0.72rem',
                  backgroundColor: '#01678f',
                  '&:hover': { backgroundColor: '#015272' },
                }}
              >
                {isApplying ? 'Saving…' : 'Apply AI Changes'}
              </Button>
            </Stack>
          </Stack>
          {Object.keys(aiDiff.changedTables).length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
              {Object.values(aiDiff.changedTables).map(table => (
                <Box key={table.tableKey} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                  <Chip
                    size="small"
                    icon={<TableChartOutlinedIcon />}
                    label={`${tableLabel(table.tableKey)} · ${table.changedCellCount}`}
                    title={table.tableKey}
                    aria-label={`Open ${tableLabel(table.tableKey)} (${table.tableKey})`}
                    onClick={() => onSelectTable(table.tableKey)}
                    color={currentCategory === table.tableKey ? 'primary' : 'default'}
                    variant={currentCategory === table.tableKey ? 'filled' : 'outlined'}
                    sx={{ cursor: 'pointer', fontSize: '0.72rem' }}
                  />
                  {onRevertStagedTable && (
                    <Tooltip title={`Revert staged changes in ${tableLabel(table.tableKey)}`}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Revert staged ${tableLabel(table.tableKey)}`}
                          disabled={isApplying || isRunningForScenario}
                          onClick={() => onRevertStagedTable(table.tableKey)}
                          sx={{ p: 0.25 }}
                        >
                          <UndoIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {aiDiff.changedSets.map(setDiff => (
            <Box key={setDiff.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Set <b>{setDiff.name}</b>: {setDiff.before.join(', ') || 'empty'} →{' '}
                {setDiff.after.join(', ') || 'empty'}
              </Typography>
              {onRevertStagedSet && (
                <Tooltip title={`Revert staged set ${setDiff.name}`}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Revert staged set ${setDiff.name}`}
                      disabled={isApplying || isRunningForScenario}
                      onClick={() => onRevertStagedSet(setDiff.name)}
                      sx={{ p: 0.25 }}
                    >
                      <UndoIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Scrollable Chat Thread */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 2,
          py: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {messages.length === 0 && !isRunningForScenario && (
          <Box sx={{ my: 'auto', py: 2, textAlign: 'left' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Chat with your scenario while browsing tabs
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Ask questions to review inputs, or ask the AI to fill/adjust values. Proposed edits
              appear highlighted directly inside the input tabs on the left so you can inspect or
              tweak cells before applying.
            </Typography>
            <Stack spacing={0.75}>
              {starterPrompts.map(starter => (
                <Button
                  key={starter}
                  size="small"
                  variant="outlined"
                  disabled={isAnyAIRunning || isApplying || hasUnsavedTableEdits}
                  onClick={() => void handleSend(starter)}
                  sx={{
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    textTransform: 'none',
                    borderColor: '#c5d8e0',
                    color: '#015272',
                    backgroundColor: '#ffffff',
                    py: 0.75,
                    px: 1.25,
                  }}
                >
                  {starter}
                </Button>
              ))}
            </Stack>
          </Box>
        )}

        {messages.map((msg, msgIdx) => {
          if (msg.status === 'applied') {
            const canRevertThisApply = Boolean(
              onRevertAppliedAI &&
              msg.undoEntryId &&
              latestUndoEntry?.id === msg.undoEntryId,
            );
            return (
              <Box
                key={msg.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 1.5,
                  backgroundColor: 'rgba(46, 125, 50, 0.1)',
                  color: 'success.dark',
                  alignSelf: 'center',
                }}
              >
                <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {msg.content}
                </Typography>
                {canRevertThisApply && (
                  <Button
                    size="small"
                    color="inherit"
                    aria-label="Revert applied AI changes"
                    disabled={!canRevertSaved || isReverting || isApplying || isRunningForScenario || hasUnsavedTableEdits}
                    startIcon={<UndoIcon sx={{ fontSize: 14 }} />}
                    onClick={() => void onRevertAppliedAI?.()}
                    sx={{ ml: 0.5, py: 0, px: 0.75, minWidth: 0, fontSize: '0.7rem', textTransform: 'none' }}
                  >
                    {isReverting ? 'Reverting…' : 'Revert'}
                  </Button>
                )}
              </Box>
            );
          }

          const isUser = msg.role === 'user';
          const isLatestAssistant =
            !isUser &&
            msgIdx === messages.length - 1 &&
            Boolean(msg.questions && msg.questions.length > 0);

          return (
            <Box
              key={msg.id}
              sx={{
                alignSelf: isUser ? 'flex-end' : 'stretch',
                maxWidth: isUser ? '88%' : '100%',
                textAlign: 'left',
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1.1,
                  borderRadius: 2,
                  backgroundColor: isUser
                    ? '#01678f'
                    : msg.status === 'error'
                      ? 'rgba(211, 47, 47, 0.07)'
                      : '#ffffff',
                  color: isUser ? '#ffffff' : 'text.primary',
                  border: isUser
                    ? 'none'
                    : msg.status === 'error'
                      ? '1px solid rgba(211, 47, 47, 0.35)'
                      : '1px solid #dde7ec',
                  boxShadow: isUser ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    color: msg.status === 'error' ? 'error.main' : 'inherit',
                  }}
                >
                  {msg.content}
                </Typography>

                {msg.updateNotes && msg.updateNotes.length > 0 && (
                  <Box component="ul" sx={{ pl: 2.2, mt: 0.75, mb: 0, color: 'text.secondary' }}>
                    {msg.updateNotes.map((note, noteIdx) => (
                      <Typography
                        key={`${msg.id}-note-${noteIdx}`}
                        component="li"
                        variant="caption"
                        sx={{ display: 'list-item', mb: 0.35, overflowWrap: 'anywhere' }}
                      >
                        {note}
                      </Typography>
                    ))}
                  </Box>
                )}

                {msg.changedTables && msg.changedTables.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.4, fontWeight: 600 }}
                    >
                      Inspect updated fields:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {msg.changedTables.map(table => (
                        <Chip
                          key={`${msg.id}-${table.name}`}
                          size="small"
                          icon={<TableChartOutlinedIcon />}
                          label={`${tableLabel(table.name)} (${table.cellCount})`}
                          title={table.name}
                          aria-label={`Open ${tableLabel(table.name)} (${table.name})`}
                          onClick={() => onSelectTable(table.name)}
                          color={currentCategory === table.name ? 'primary' : 'default'}
                          variant={currentCategory === table.name ? 'filled' : 'outlined'}
                          sx={{ cursor: 'pointer', fontSize: '0.72rem' }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                {msg.questions && msg.questions.length > 0 && (
                  <Box
                    sx={{
                      mt: 1.25,
                      p: 1.25,
                      borderRadius: 1.5,
                      backgroundColor: 'rgba(237, 108, 2, 0.07)',
                      border: '1px solid rgba(237, 108, 2, 0.3)',
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.75 }}>
                      Questions from assistant:
                    </Typography>
                    <Stack spacing={1}>
                      {msg.questions.map(question => (
                        <Box key={`${msg.id}-${question}`}>
                          <Typography variant="caption" sx={{ display: 'block', mb: 0.35 }}>
                            {question}
                          </Typography>
                          {isLatestAssistant && (
                            <TextField
                              size="small"
                              fullWidth
                              placeholder="Type an answer (optional)…"
                              value={answers[question] || ''}
                              onChange={e =>
                                setAnswers(curr => ({ ...curr, [question]: e.target.value }))
                              }
                              disabled={isRunningForScenario}
                              inputProps={{ 'aria-label': `Answer to: ${question}` }}
                              sx={{ backgroundColor: '#ffffff' }}
                            />
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}

        {isRunningForScenario && (
          <Alert
            icon={<AutoAwesomeIcon fontSize="small" />}
            severity="info"
            sx={{ py: 0.5, '& .MuiAlert-message': { width: '100%', textAlign: 'left' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
              Assistant is analyzing {scenario.name}…
            </Typography>
            <LinearProgress />
          </Alert>
        )}

        <div ref={scrollEndRef} />
      </Box>

      <Divider />

      {/* Chat Composer */}
      <Box sx={{ p: 1.5, backgroundColor: '#ffffff' }}>
        {hasUnsavedTableEdits && (
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 0.75, textAlign: 'left' }}>
            Save or discard your manual table edits before sending AI requests.
          </Typography>
        )}
        {!hasUnsavedTableEdits && isBlockedByOtherRun && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, textAlign: 'left' }}>
            Waiting for another AI request to finish…
          </Typography>
        )}
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <TextField
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about inputs or describe changes to stage…"
            multiline
            minRows={1}
            maxRows={4}
            size="small"
            fullWidth
            disabled={isRunningForScenario}
            inputProps={{ 'aria-label': 'Message AI Scenario Assistant' }}
          />
          <Tooltip title="Send message (Enter)">
            <span>
              <IconButton
                color="primary"
                aria-label="Send AI message"
                disabled={!canSend}
                onClick={() => void handleSend()}
                sx={{
                  backgroundColor: canSend ? '#01678f' : undefined,
                  color: canSend ? '#ffffff' : undefined,
                  '&:hover': { backgroundColor: canSend ? '#015272' : undefined },
                }}
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>
    </Paper>
  );
}
