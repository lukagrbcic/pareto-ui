import React, { useEffect, useState } from "react";
import { Alert, Box, LinearProgress, Snackbar, Typography } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useAIPrompt } from "../../context/AIPromptContext";

export default function AIPromptStatusBar(): JSX.Element | null {
  const { isAvailable, isPanelOpen, status, errorMessage, requestKind } = useAIPrompt();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status !== "idle") {
      setOpen(true);
    }
  }, [status]);

  if (!isAvailable || isPanelOpen || status === "idle") return null;

  const isRunning = status === "running";
  const severity = status === "error" ? "warning" : "info";
  const message =
    status === "running"
      ? requestKind === "optimization-diagnosis"
        ? "AI is diagnosing the optimization failure."
        : "AI is filling your scenario inputs."
      : status === "success"
      ? requestKind === "optimization-diagnosis"
        ? "AI diagnosis completed. Review the suggested next steps."
        : "AI data update completed. Review your inputs."
      : errorMessage || "AI request needs attention.";

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      autoHideDuration={isRunning ? undefined : 8000}
      onClose={() => setOpen(false)}
      style={{ marginBottom: "50px" }}
    >
      <Alert
        icon={<AutoAwesomeIcon fontSize="small" />}
        severity={severity}
        onClose={() => setOpen(false)}
        sx={{ minWidth: 320, alignItems: "flex-start" }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {message}
        </Typography>
        {isRunning && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress />
          </Box>
        )}
      </Alert>
    </Snackbar>
  );
}
