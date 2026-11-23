import React from 'react';
import {useState} from 'react';
import { Grid, Box, Button, IconButton, Divider, Tooltip } from '@mui/material';
import InputIcon from '@mui/icons-material/Input';
import SettingsIcon from '@mui/icons-material/Settings';
import PieChartIcon from '@mui/icons-material/PieChart';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UndoIcon from '@mui/icons-material/Undo';
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
  } = props
  const [ openSaveModal, setOpenSaveModal ] = useState(false)
  const [ key, setKey ] =  useState(null)
  const handleOpenSaveModal = () => setOpenSaveModal(true);
  const handleCloseSaveModal = () => setOpenSaveModal(false);

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
          <Tooltip title={revertLabel}>
            <span>
              <Button
                onClick={() => void onRevert?.()}
                disabled={!canRevert || Boolean(isReverting)}
                variant="outlined"
                size="small"
                startIcon={<UndoIcon />}
                sx={{ borderColor: '#6094bc', color: '#015272' }}
              >
                {isReverting ? 'Reverting…' : 'Revert'}
              </Button>
            </span>
          </Tooltip>
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

