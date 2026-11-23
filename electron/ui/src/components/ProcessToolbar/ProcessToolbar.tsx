import React from 'react';
import {useState} from 'react';
import { Grid, Box, Button, IconButton, Divider, Tooltip, Popover, Typography, Stack, Chip } from '@mui/material';
import InputIcon from '@mui/icons-material/Input';
import SettingsIcon from '@mui/icons-material/Settings';
import PieChartIcon from '@mui/icons-material/PieChart';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import HistoryIcon from '@mui/icons-material/History';
import PopupModal from '../../components/PopupModal/PopupModal';
import { useOptionalAIPrompt } from '../../context/AIPromptContext';


export default function ProcessToolbar(props) {
  const { isAvailable: isAIAvailable, isPanelOpen, togglePanel } = useOptionalAIPrompt();
  const { 
    handleSelection, 
    selected, 
    scenario,
    category,
    inputDataEdited,
    handleUpdateExcel,
    setInputDataEdited,
    syncScenarioData,
    aiStagedCount = 0,
    canRevert = false,
    revertLabel = 'No changes to revert',
    isReverting = false,
    onRevert,
    canRedo = false,
    redoLabel = 'No reverted changes to redo',
    isRedoing = false,
    onRedo,
    undoHistory = [],
    redoHistory = [],
  } = props
  const [ openSaveModal, setOpenSaveModal ] = useState(false)
  const [ key, setKey ] =  useState(null)
  const [ historyAnchor, setHistoryAnchor ] = useState<HTMLElement | null>(null)
  const handleOpenSaveModal = () => setOpenSaveModal(true);
  const handleCloseSaveModal = () => setOpenSaveModal(false);
  const formatHistoryTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSaveModal = async () => {
    if (await handleUpdateExcel(scenario.id, category, scenario.data_input.df_parameters[category]) === false) return;
    handleCloseSaveModal()
    setInputDataEdited(false)
    handleSelection(key)
  }

  const handleDiscardChanges = () => {
    handleCloseSaveModal()
    setInputDataEdited(false)
    handleSelection(key)
    if (props.onDiscardManualEdits) {
      props.onDiscardManualEdits()
    } else {
      syncScenarioData()
    }
  }

  const handleClick = (key) => {
    setKey(key)
    if (inputDataEdited) {
      handleOpenSaveModal()
    }
    else {
      handleSelection(key)
    }
  }

    const styles = {
    iconSelected: {
        backgroundColor:'#6094bc', 
        color: 'white'
    },
    textSelected: {
        fontWeight: 'bold',
        margin:'0'
    },
    textUnselected: {
      margin:'0'
  },
    shiftTextRight: {
      paddingLeft: '240px'
    },
   }
  return ( 
    <Box sx={{position: 'sticky', top:'71px', backgroundColor:"white", zIndex:'3'}}>
      <Grid container>
      <Grid item xs={1.8} >
        <IconButton aria-label="data_input" sx={{marginTop:'5px'}} style={selected === 0 ? styles.iconSelected : null} onClick={() => handleClick(0)}>
            <InputIcon fontSize="large"></InputIcon>
        </IconButton>
        <p style={selected === 0 ? styles.textSelected : styles.textUnselected}>Data Input</p>
      </Grid>
      <Grid item xs={1.8}>
        <IconButton aria-label="optimization" sx={{marginTop:'5px'}} disabled={scenario?.results?.status === "Incomplete" || aiStagedCount > 0} style={selected === 1 ? styles.iconSelected : null} onClick={() => handleClick(1)}>
            <SettingsIcon fontSize="large"></SettingsIcon>
        </IconButton>
        <p style={selected === 1 ? styles.textSelected : styles.textUnselected}>Optimization Setup</p>
      </Grid>
      <Grid item xs={1.8}>
        <IconButton aria-label="results" sx={{marginTop:'5px'}} disabled={!props.hasOptimizationStart && (!scenario || ['Draft', 'Incomplete'].includes(scenario.results.status))} style={selected === 2 ? styles.iconSelected : null} onClick={() => handleClick(2)}>
            <PieChartIcon fontSize="large"></PieChartIcon>
        </IconButton>
        <p style={selected === 2 ? styles.textSelected : styles.textUnselected}>Model Results</p>
      </Grid>
      <Grid item xs={6.6} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, pr: 2 }}>
        {scenario && (
          <>
            <Tooltip title={revertLabel}>
              <span>
                <Button
                  onClick={() => void onRevert?.()}
                  disabled={!canRevert || Boolean(isReverting) || Boolean(isRedoing)}
                  variant="outlined"
                  size="small"
                  startIcon={<UndoIcon />}
                  sx={{ borderColor: '#6094bc', color: '#015272' }}
                >
                  {isReverting ? 'Reverting…' : 'Revert'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={redoLabel}>
              <span>
                <Button
                  onClick={() => void onRedo?.()}
                  disabled={!canRedo || Boolean(isRedoing) || Boolean(isReverting)}
                  variant="outlined"
                  size="small"
                  startIcon={<RedoIcon />}
                  sx={{ borderColor: '#6094bc', color: '#015272' }}
                >
                  {isRedoing ? 'Redoing…' : 'Redo'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Change history">
              <IconButton
                size="small"
                aria-label="Change history"
                onClick={event => setHistoryAnchor(event.currentTarget)}
                sx={{ color: '#015272', border: '1px solid #d5e0e6' }}
              >
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        {isAIAvailable && scenario && (
          <Button
            onClick={() => togglePanel?.({ scenarioId: scenario.id })}
            variant={isPanelOpen ? 'contained' : 'outlined'}
            size="small"
            startIcon={<AutoAwesomeIcon />}
            sx={
              isPanelOpen
                ? { backgroundColor: '#01678f', '&:hover': { backgroundColor: '#015272' } }
                : { borderColor: '#01678f', color: '#01678f' }
            }
          >
            {aiStagedCount > 0 ? `AI Assistant (${aiStagedCount})` : 'AI Assistant'}
          </Button>
        )}
      </Grid>
      <Divider aria-label="bottom_divider"></Divider>
      </Grid>

      <Popover
        open={Boolean(historyAnchor)}
        anchorEl={historyAnchor}
        onClose={() => setHistoryAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 1.75, width: 320, maxHeight: 380, overflowY: 'auto' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Session Change History
          </Typography>
          {(inputDataEdited || aiStagedCount > 0) && (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mb: 1.25 }}>
              {inputDataEdited && <Chip size="small" color="warning" label="Unsaved table edits" />}
              {aiStagedCount > 0 && <Chip size="small" color="primary" label={`${aiStagedCount} staged AI item(s)`} />}
            </Stack>
          )}
          {redoHistory.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                Available to Redo ({redoHistory.length})
              </Typography>
              <Stack spacing={0.75}>
                {[...redoHistory].reverse().map((entry, idx) => (
                  <Box
                    key={`redo-${entry.id}-${idx}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      p: 0.75,
                      borderRadius: 1,
                      border: '1px solid #e2eaef',
                      backgroundColor: '#f8fbfd',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }} noWrap>
                        {entry.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {entry.source === 'ai' ? 'AI' : 'Manual'}
                        {formatHistoryTime(entry.timestamp) ? ` · ${formatHistoryTime(entry.timestamp)}` : ''}
                      </Typography>
                    </Box>
                    {idx === 0 && (
                      <Button
                        size="small"
                        aria-label="Redo latest change"
                        disabled={!canRedo || Boolean(isRedoing) || Boolean(isReverting)}
                        onClick={() => {
                          setHistoryAnchor(null);
                          void onRedo?.();
                        }}
                        sx={{ textTransform: 'none', minWidth: 0, px: 1 }}
                      >
                        Redo
                      </Button>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
          {undoHistory.length > 0 ? (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                Saved Undo Stack ({undoHistory.length})
              </Typography>
              <Stack spacing={0.75}>
                {[...undoHistory].reverse().map((entry, idx) => (
                  <Box
                    key={`undo-${entry.id}-${idx}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      p: 0.75,
                      borderRadius: 1,
                      border: '1px solid #e2eaef',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }} noWrap>
                        {entry.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {entry.source === 'ai' ? 'AI' : 'Manual'}
                        {formatHistoryTime(entry.timestamp) ? ` · ${formatHistoryTime(entry.timestamp)}` : ''}
                      </Typography>
                    </Box>
                    {idx === 0 && !inputDataEdited && aiStagedCount === 0 && (
                      <Button
                        size="small"
                        aria-label="Undo latest change"
                        disabled={!canRevert || Boolean(isReverting) || Boolean(isRedoing)}
                        onClick={() => {
                          setHistoryAnchor(null);
                          void onRevert?.();
                        }}
                        sx={{ textTransform: 'none', minWidth: 0, px: 1 }}
                      >
                        Undo
                      </Button>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : (
            redoHistory.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No changes recorded in this session yet.
              </Typography>
            )
          )}
        </Box>
      </Popover>

      <PopupModal
        hasTwoButtons
        open={openSaveModal}
        handleClose={handleCloseSaveModal}
        handleSave={handleSaveModal}
        handleButtonTwoClick={handleDiscardChanges}
        text="Before proceeding, do you want to save changes made to this table?"
        buttonText='Save'
        buttonColor='primary'
        buttonVariant='contained'
        buttonTwoText='Discard'
        buttonTwoColor='error'
        buttonTwoVariant='outlined'
        width={400}
      />
    </Box>
  );

}

