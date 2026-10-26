import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useAIPrompt } from "../../context/AIPromptContext";
import { useScenario } from "../../context/ScenarioContext";

interface AIPromptDialogProps {
  open: boolean;
  onClose: () => void;
  scenarioId: string | number | null | undefined;
  scenarioName?: string;
  validationFindings?: unknown;
  onApplied?: () => void;
}

const DIFF_PREVIEW_ROWS = 6;

/**
 * One table of the AI review diff. Renders only rows that actually changed,
 * all columns (horizontal scroll), with a row preview cap plus a
 * "Show all N rows" toggle so large fills stay reviewable. Headers and cells
 * wrap long camelCase names (overflowWrap) instead of overlapping neighbors;
 * changed cells get the highlighted border/background.
 */
interface DiffTableData {
  key: string;
  columns: string[];
  rows: Array<{ index: number; cells: any[]; changed: boolean[] }>;
  totalChangedRows: number;
}

function DiffTable({ table, expanded, onToggle }: { table: DiffTableData; expanded: boolean; onToggle: () => void }): JSX.Element {
  const visibleRows = expanded ? table.rows : table.rows.slice(0, DIFF_PREVIEW_ROWS);
  const hasMore = table.rows.length > DIFF_PREVIEW_ROWS;
  const headerCell = { fontWeight: 600, color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" } as const;
  return (
    <Box sx={{ px: 2, py: 1.5, overflowX: "auto" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `minmax(36px, 48px) repeat(${table.columns.length}, minmax(120px, 1fr))`,
          gap: 1.5,
          fontSize: "0.75rem",
          minWidth: `${(table.columns.length + 1) * 120}px`,
        }}
      >
        <Box sx={headerCell}>#</Box>
        {table.columns.map((col) => (
          <Box key={col} sx={headerCell}>
            {col}
          </Box>
        ))}
        {visibleRows.map((row) => (
          <React.Fragment key={`${table.key}-${row.index}`}>
            <Box sx={{ color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}>{row.index + 1}</Box>
            {row.cells.map((cell, idx) => (
              <Box
                key={`${table.key}-${row.index}-${idx}`}
                sx={{
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 1,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                  border: row.changed[idx]
                    ? "1px solid rgba(1, 103, 143, 0.55)"
                    : "1px solid rgba(0, 0, 0, 0.08)",
                  bgcolor: row.changed[idx] ? "rgba(1, 103, 143, 0.22)" : "transparent",
                  color: row.changed[idx] ? "text.primary" : "text.secondary",
                  fontWeight: row.changed[idx] ? 600 : 400,
                  opacity: row.changed[idx] ? 1 : 0.55,
                }}
              >
                {cell}
              </Box>
            ))}
          </React.Fragment>
        ))}
      </Box>
      <Box sx={{ mt: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {table.totalChangedRows === 0
            ? "No row-level changes detected."
            : !hasMore || expanded
              ? `Showing all ${table.totalChangedRows} changed rows.`
              : `Showing ${DIFF_PREVIEW_ROWS} of ${table.totalChangedRows} changed rows.`}
        </Typography>
        {hasMore && (
          <Button size="small" variant="text" onClick={onToggle}>
            {expanded ? "Show fewer" : `Show all ${table.totalChangedRows} rows`}
          </Button>
        )}
      </Box>
    </Box>
  );
}

export default function AIPromptDialog(props: AIPromptDialogProps): JSX.Element {
  const { open, onClose, scenarioId, scenarioName, validationFindings, onApplied } = props;
  const { status: requestStatus, isRunning, updatedScenario: requestUpdates, updateNotes: requestNotes,
    questions: requestQuestions, errorMessage: requestError, requestKind, requestScenarioId, runPrompt, clearResult } = useAIPrompt();
  const { scenarioData, handleScenarioUpdate } = useScenario();
  const matchesScenario = requestKind === 'data-update' && scenarioId != null &&
    requestScenarioId === Number(scenarioId) && requestScenarioId === scenarioData?.id;
  const status = matchesScenario ? requestStatus : 'idle';
  const updatedScenario = matchesScenario ? requestUpdates : null;
  const updateNotes = useMemo(() => matchesScenario ? requestNotes : [], [matchesScenario, requestNotes]);
  const questions = useMemo(() => matchesScenario ? requestQuestions : [], [matchesScenario, requestQuestions]);
  const errorMessage = matchesScenario ? requestError : null;
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"notes" | "diff">("notes");
  // Per-table expansion state for the review diff; reset whenever a new AI
  // result arrives so a fresh response always starts at the preview size.
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  // Answers to the assistant's questions, keyed by question text; assembled
  // into a Q/A transcript on the next run (see questionTranscript).
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const aiDataInput = updatedScenario;

  useEffect(() => {
    setExpandedTables(new Set());
  }, [updatedScenario]);

  // New questions from a fresh response start with empty answer fields.
  useEffect(() => {
    setAnswers({});
  }, [questions]);

  const statusLabel = useMemo(() => {
    if (status === "running") return "Running";
    if (status === "success") return "Completed";
    if (status === "error") return "Needs Review";
    return "Ready";
  }, [status]);

  /**
   * Turns answered questions into a self-describing transcript appended to the
   * outgoing prompt. The AI calls are stateless — the model never saw its own
   * questions — so the transcript carries the Q/A pairs explicitly:
   *   "Answers to your previous questions:\nQ: ...\nA: ..."
   * Unanswered questions are omitted.
   */
  const questionTranscript = useMemo(() => {
    const answered = questions
      .map((question) => ({ question, answer: (answers[question] || "").trim() }))
      .filter(({ answer }) => answer.length > 0);
    if (!answered.length) return "";
    return `Answers to your previous questions:\n${answered
      .map(({ question, answer }) => `Q: ${question}\nA: ${answer}`)
      .join("\n")}`;
  }, [answers, questions]);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if ((!trimmed && !questionTranscript) || scenarioId == null) {
      setPromptError("Please add a prompt first.");
      return;
    }
    setPromptError(null);
    const outgoing = [trimmed, questionTranscript].filter(Boolean).join("\n\n");
    await runPrompt(scenarioId, outgoing, validationFindings);
  };

  // Review-before-apply: nothing is saved automatically. The merged scenario
  // (original data_input + AI data_input) is saved only when the user clicks
  // "Save Updates", and a successful save triggers onApplied (Bottombar then
  // re-runs validation).
  const handleSaveUpdates = async (): Promise<void> => {
    if (!scenarioData || !updatedScenario) return;
    const mergedScenario = {
      ...scenarioData,
      data_input: {
        ...scenarioData.data_input,
        ...aiDataInput,
      },
    };
    const saved = await handleScenarioUpdate(mergedScenario, false, "json");
    if (saved) onApplied?.();
  };

  const toggleTableExpanded = (key: string): void => {
    setExpandedTables((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleClearPrompt = (): void => {
    clearResult();
    setPrompt("");
    setPromptError(null);
    setViewMode("notes");
    setAnswers({});
  };

  const handleClose = (): void => {
    onClose();
  };

  const hasUpdates = updateNotes.length > 0;
  const showSuccessPanel = status === "success";
  // Flattens each note onto its own bullet and strips leading markdown
  // markers, so a model that ignores the one-note-per-bullet contract still
  // renders as a scannable list instead of a wall of text. Also removes the
  // "df_parameters['Table']" prefix the model sometimes adds.
  const sanitizedUpdateNotes = useMemo(() => {
    const stripPrefix = (note: string): string =>
      note
        .replace(/df_parameters\[['"]([^'"]+)['"]\]/g, "$1")
        .replace(/df_parameters\./g, "");
    const bullets: string[] = [];
    updateNotes.forEach((note) => {
      stripPrefix(note)
        .split(/\n+/)
        .forEach((line) => {
          const cleaned = line.trim().replace(/^[-*•]\s+/, "").trim();
          if (cleaned) bullets.push(cleaned);
        });
    });
    return bullets;
  }, [updateNotes]);
  const diffTables = useMemo(() => {
    if (!scenarioData || !aiDataInput) return [];
    const currentTables = scenarioData.data_input?.df_parameters || {};
    const nextTables = aiDataInput.df_parameters || {};
    const tableKeys = new Set<string>([...Object.keys(currentTables), ...Object.keys(nextTables)]);
    const tableDiffs: Array<{
      key: string;
      columns: string[];
      rows: Array<{ index: number; cells: any[]; changed: boolean[] }>;
      totalChangedRows: number;
      nonTabular: boolean;
    }> = [];

      const formatCell = (value: any): string => {
        if (value === "" || value === null || value === undefined) return "—";
        if (typeof value === "object") return "…";
        return String(value);
      };

    tableKeys.forEach((tableKey) => {
      const prevTable = currentTables[tableKey] || {};
      const nextTable = nextTables[tableKey] || {};
      if (JSON.stringify(prevTable) === JSON.stringify(nextTable)) return;

      const columnKeys = Array.from(
        new Set<string>([...Object.keys(prevTable || {}), ...Object.keys(nextTable || {})])
      );
      const nonTabular = columnKeys.some((key) => {
        const prevVal = (prevTable as any)[key];
        const nextVal = (nextTable as any)[key];
        const testVal = nextVal !== undefined ? nextVal : prevVal;
        return testVal !== undefined && !Array.isArray(testVal);
      });

      if (nonTabular) {
        tableDiffs.push({
          key: tableKey,
          columns: [],
          rows: [],
          totalChangedRows: 0,
          nonTabular: true,
        });
        return;
      }

      const maxRows = Math.max(
        ...columnKeys.map((key) => {
          const prevVal = (prevTable as any)[key] || [];
          const nextVal = (nextTable as any)[key] || [];
          return Math.max(prevVal.length || 0, nextVal.length || 0);
        }),
        0
      );

      const changedRows: Array<{ index: number; cells: any[]; changed: boolean[] }> = [];
      for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        let rowChanged = false;
        const cells = columnKeys.map((key) => {
          const nextVal = (nextTable as any)[key] || [];
          return nextVal[rowIndex];
        });
        const changed = columnKeys.map((key, idx) => {
          const prevVal = (prevTable as any)[key] || [];
          const nextVal = (nextTable as any)[key] || [];
          const prevCell = prevVal[rowIndex];
          const nextCell = nextVal[rowIndex];
          const cellChanged = JSON.stringify(prevCell) !== JSON.stringify(nextCell);
          if (cellChanged) rowChanged = true;
          return cellChanged;
        });
        if (rowChanged) {
          changedRows.push({
            index: rowIndex,
            cells: cells.map(formatCell),
            changed,
          });
        }
      }

      tableDiffs.push({
        key: tableKey,
        columns: columnKeys,
        rows: changedRows,
        totalChangedRows: changedRows.length,
        nonTabular: false,
      });
    });

    return tableDiffs;
  }, [aiDataInput, scenarioData]);

  // df_sets changes are not tables, so the diff tab renders them as a compact
  // list — essential for set-only responses (e.g. adding a missing pad), which
  // would otherwise look like "no differences" in the review step.
  const setDiffs = useMemo(() => {
    if (!scenarioData || !aiDataInput) return [];
    const currentSets: Record<string, unknown> = (scenarioData.data_input as any)?.df_sets || {};
    const nextSets: Record<string, unknown> = (aiDataInput as any).df_sets || {};
    const keys = Array.from(new Set([...Object.keys(currentSets), ...Object.keys(nextSets)]));
    const diffs: Array<{ name: string; before: string[]; after: string[] }> = [];
    keys.forEach((name) => {
      const before = Array.isArray(currentSets[name]) ? (currentSets[name] as string[]) : [];
      const after = Array.isArray(nextSets[name]) ? (nextSets[name] as string[]) : [];
      if (JSON.stringify(before) !== JSON.stringify(after)) diffs.push({ name, before, after });
    });
    return diffs;
  }, [aiDataInput, scenarioData]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          borderRadius: 3,
          border: "1px solid rgba(1, 103, 143, 0.15)",
          boxShadow: "0 22px 60px rgba(0,0,0,0.18)",
          background: "linear-gradient(160deg, #ffffff 0%, #f6f9fb 100%)",
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              AI Scenario Assistant
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Describe what to fill or adjust in {scenarioName || "this scenario"}.
            </Typography>
          </Box>
          <Chip
            icon={<AutoAwesomeIcon fontSize="small" />}
            label={statusLabel}
            color={status === "error" ? "warning" : "primary"}
            variant={status === "running" ? "filled" : "outlined"}
          />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {validationFindings != null && (
          <Alert severity="info" sx={{ mb: 1 }}>
            The current validation findings will be shared with the AI so it can target them.
          </Alert>
        )}
        <TextField
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Example: Fill missing pipeline costs using distance assumptions and set all reuse options to 10% capacity."
          multiline
          minRows={4}
          fullWidth
          error={Boolean(promptError)}
          helperText={promptError || "Your prompt will drive an AI assistant to populate incomplete inputs."}
          disabled={isRunning}
          sx={{ mt: 1 }}
        />
        {isRunning && (
          <Box sx={{ mt: 3 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              Working on your request. You can close this dialog and keep working while it runs.
            </Typography>
          </Box>
        )}
        {errorMessage && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Typography>
        )}
        {questions.length > 0 && (
          <Box sx={{ mt: 2, p: 2, borderRadius: 2, bgcolor: "rgba(237, 108, 2, 0.08)", border: "1px solid rgba(237, 108, 2, 0.35)" }}>
            <Typography variant="subtitle2">
              The assistant needs more information before it can proceed. Type your answers below,
              then run AI Fill again; leave a field blank to skip that question.
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              {questions.map((question) => (
                <Box key={question}>
                  <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
                    {question}
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    multiline
                    minRows={1}
                    placeholder="Type your answer…"
                    value={answers[question] || ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question]: event.target.value }))
                    }
                    inputProps={{ "aria-label": `Answer to: ${question}` }}
                    disabled={isRunning}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        )}
        {showSuccessPanel && (
          <Box sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: "rgba(1, 103, 143, 0.08)" }}>
            <Tabs
              value={viewMode}
              onChange={(_, value) => setViewMode(value as "notes" | "diff")}
              textColor="primary"
              indicatorColor="primary"
              sx={{ mb: 2 }}
            >
              <Tab value="notes" label="Update Notes" />
              <Tab value="diff" label="View Diff" />
            </Tabs>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {viewMode === "notes" ? "Update Notes" : "Data Diff"}
            </Typography>
            {viewMode === "notes" ? (
              hasUpdates ? (
                <Box component="ul" sx={{ paddingLeft: "18px", margin: 0, color: "text.secondary" }}>
                  {sanitizedUpdateNotes.map((note, index) => (
                    <Typography key={`${index}-${note}`} component="li" variant="body2" sx={{ mb: 0.5 }}>
                      {note}
                    </Typography>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No update notes returned. You can still save the changes if needed.
                </Typography>
              )
            ) : diffTables.length || setDiffs.length ? (
              <Stack spacing={2}>
                {setDiffs.length > 0 && (
                  <Box sx={{ border: "1px solid rgba(237, 108, 2, 0.35)", borderRadius: 2 }}>
                    <Box
                      sx={{
                        px: 2,
                        py: 1,
                        bgcolor: "rgba(237, 108, 2, 0.08)",
                        borderTopLeftRadius: 8,
                        borderTopRightRadius: 8,
                      }}
                    >
                      <Typography variant="subtitle2">Set membership changes</Typography>
                    </Box>
                    <Box sx={{ px: 2, py: 1.5 }}>
                      {setDiffs.map((set) => (
                        <Box key={set.name} sx={{ mb: setDiffs.indexOf(set) < setDiffs.length - 1 ? 1.5 : 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {set.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {set.before.length === 0
                              ? `Added: ${set.after.join(", ")}`
                              : set.after.length === 0
                                ? `Removed: ${set.before.join(", ")}`
                                : `Before: ${set.before.join(", ")} → After: ${set.after.join(", ")}`}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
                {diffTables.map((table) => (
                  <Box key={table.key} sx={{ border: "1px solid rgba(1, 103, 143, 0.2)", borderRadius: 2 }}>
                    <Box
                      sx={{
                        px: 2,
                        py: 1,
                        bgcolor: "rgba(1, 103, 143, 0.08)",
                        borderTopLeftRadius: 8,
                        borderTopRightRadius: 8,
                      }}
                    >
                      <Typography variant="subtitle2">{table.key}</Typography>
                    </Box>
                    {table.nonTabular ? (
                      <Box sx={{ px: 2, py: 1.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          Updated non-tabular values detected for this table.
                        </Typography>
                      </Box>
                    ) : (
                      <DiffTable table={table} expanded={expandedTables.has(table.key)} onToggle={() => toggleTableExpanded(table.key)} />
                    )}
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No differences detected between the current scenario and the AI updates.
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        {(status === "success" || status === "error") && (
          <Button onClick={handleClearPrompt} color="inherit" variant="text">
            Clear Prompt
          </Button>
        )}
        <Button onClick={handleClose} color="secondary" variant="outlined">
          Close
        </Button>
        {status === "success" && updatedScenario && (
          <Button onClick={handleSaveUpdates} color="secondary" variant="outlined" disabled={!scenarioData}>
            Save Updates
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          variant="contained"
          startIcon={<AutoAwesomeIcon />}
          disabled={isRunning || scenarioId == null}
        >
          Run AI Fill
        </Button>
      </DialogActions>
    </Dialog>
  );
}
