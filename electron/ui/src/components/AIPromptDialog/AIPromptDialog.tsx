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
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const aiDataInput = updatedScenario;

  useEffect(() => {
    setExpandedTables(new Set());
  }, [updatedScenario]);

  const statusLabel = useMemo(() => {
    if (status === "running") return "Running";
    if (status === "success") return "Completed";
    if (status === "error") return "Needs Review";
    return "Ready";
  }, [status]);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (!trimmed || scenarioId == null) {
      setPromptError("Please add a prompt first.");
      return;
    }
    setPromptError(null);
    await runPrompt(scenarioId, trimmed, validationFindings);
  };

  const handleQuestionClick = (question: string): void => {
    setPrompt((current) => (current.trim() ? `${current.trim()}\n${question}` : question));
  };

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
  };

  const handleClose = (): void => {
    onClose();
  };

  const hasUpdates = updateNotes.length > 0;
  const showSuccessPanel = status === "success";
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
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              The assistant needs more information before it can proceed. Click a question to answer it:
            </Typography>
            <Stack spacing={0.5}>
              {questions.map((question) => (
                <Button
                  key={question}
                  onClick={() => handleQuestionClick(question)}
                  variant="text"
                  color="inherit"
                  sx={{ justifyContent: "flex-start", textTransform: "none", px: 1, py: 0.25, textAlign: "left" }}
                >
                  {question}
                </Button>
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
            ) : diffTables.length ? (
              <Stack spacing={2}>
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
