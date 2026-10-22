import React from 'react';
import {useEffect, useRef, useState} from 'react';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PopupModal from '../../components/PopupModal/PopupModal';
import AddIcon from '@mui/icons-material/Add';
import { advanceToOptimizationSetup, generateExcelFromMap, validateScenario, checkScenarioFeasibility } from '../../services/app.service';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AIPromptDialog from '../AIPromptDialog/AIPromptDialog';
import { useAIPrompt } from '../../context/AIPromptContext';
import ScenarioValidationDialog from '../ScenarioValidationDialog/ScenarioValidationDialog';
import {ApiClientError} from '../../services/apiClient';
import {useWorkbookDownload} from '../../hooks/useWorkbookDownload';
import ErrorBar from '../ErrorBar/ErrorBar';
import type {ScenarioValidation} from '../../types';


export default function Bottombar(props) {
    const { isAvailable: isAIAvailable } = useAIPrompt();
    const {
      scenario,
      backgroundTasks,
      handleUpdateExcel,
      setInputDataEdited,
      handleSelection,
      handleSetCategory,
      syncScenarioData,
      category,
      inputDataEdited,
      disableOptimize,
      section,
      handleRunModel,
      copyAndRunOptimization,
      port
    } = props;
    const { results, id, name } = scenario || {};
    const { status } = results || {};
    const {downloading, downloadError, clearDownloadError, startDownload} = useWorkbookDownload(`${port}:${id}`);
    const [ openSaveModal, setOpenSaveModal ] = useState(false)

    const [ openRerunModal, setOpenRerunModal] = useState(false)
    const [ newScenarioName, setNewScenarioName ] = useState('')
    const [ showModalError, setShowModalError ] = useState(false)
    const [ modalError, setModalError ] = useState('')
    const [ openAIPrompt, setOpenAIPrompt ] = useState(false)
    const [ aiValidationFindings, setAiValidationFindings ] = useState<ScenarioValidation | null>(null)
    const [ key, setKey ] =  useState(null)
    const [ hasOverride, setHasOverride ] = useState(false)
    const [ openValidationDialog, setOpenValidationDialog ] = useState(false)
    const [ validationLoading, setValidationLoading ] = useState(false)
    const [ validationAdvancing, setValidationAdvancing ] = useState(false)
    const [ validationError, setValidationError ] = useState<string | null>(null)
    const [ validationResult, setValidationResult ] = useState<ScenarioValidation | null>(null)
    const validationVersion = useRef(0);
    useEffect(() => {
      setValidationResult(null); setValidationLoading(false); setValidationAdvancing(false); setValidationError(null);
      setOpenValidationDialog(false);
      setAiValidationFindings(null);
      return () => { validationVersion.current += 1; };
    }, [id, scenario?.input_revision, props.saving, inputDataEdited]);
    const handleOpenSaveModal = () => setOpenSaveModal(true);
    const handleCloseSaveModal = () => setOpenSaveModal(false);
    const handleCloseRerunModal = () => setOpenRerunModal(false);
    const handleOpenAIPrompt = () => {
      // Ground standalone fills too: attach the latest validation findings when
      // the dialog was not opened through "Fix with AI".
      if (!aiValidationFindings && validationResult) {
        setAiValidationFindings(validationResult);
      }
      setOpenAIPrompt(true);
    };
    const handleCloseAIPrompt = () => { setOpenAIPrompt(false); setAiValidationFindings(null); };
    const handleFixValidationWithAI = (result: ScenarioValidation) => {
      setOpenValidationDialog(false);
      setAiValidationFindings(result);
      setOpenAIPrompt(true);
    };
    const handleAIUpdatesApplied = () => {
      handleCloseAIPrompt();
      handleValidateScenario();
    };
    const handleCloseValidationDialog = () => setOpenValidationDialog(false);


    const styles = {
        filled: {
            backgroundColor: '#01678f',
            '&:hover': {
                backgroundColor: '#01678f',
                opacity: 0.9
            },
        },
        unfilled: {
            color: '#595959'
        }
    }

    useEffect(() => {
      // check if override values are present
      try {
        let tempHasOverride = false
          for (let key of Object.keys(scenario?.override_values)) {
            if(Object.keys(scenario.override_values[key]).length>0) tempHasOverride = true
        }

        setHasOverride(tempHasOverride)
      } catch (e) {
        
      }

    },[scenario?.override_values])

    useEffect(() => {
      setNewScenarioName('')
      setShowModalError(false)
    },[scenario])
    

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
        syncScenarioData()
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

      const handleRunOptimize = () => {
        handleCloseRerunModal()
        handleRunModel()
      }

      const reoptimizeNewScenario = () => {
        if (newScenarioName === '') {
          // show error
          setModalError(' *You must provide a name if creating a new scenario*')
          setShowModalError(true)

        } else {
          setShowModalError(false)
          handleCloseRerunModal()
          copyAndRunOptimization(newScenarioName)
        }
        
      }

      const handleEditNewScenarioName = (event: any) => {
        setNewScenarioName(event.target.value)
      }

      const handleClickGenerateSpreadsheet = () =>
        startDownload(signal => generateExcelFromMap(port, id, signal), name + '.xlsx');

      const handleValidateScenario = (solve = false) => {
        if (id === null || id === undefined) {
          setValidationError("No scenario selected.")
          setValidationResult(null)
          setOpenValidationDialog(true)
          return
        }
        setValidationLoading(true)
        setValidationError(null)
        setValidationResult(null)
        setOpenValidationDialog(true);
        const version = ++validationVersion.current;
        (solve ? checkScenarioFeasibility(port, id) : validateScenario(port, id))
          .then((data) => {
            if (validationVersion.current !== version) return;
            setValidationResult(data)
            syncScenarioData()
            setValidationLoading(false)
          })
          .catch((err) => {
            if (validationVersion.current !== version) return;
            console.error("error validating scenario: ", err)
            setValidationError(err instanceof Error ? err.message : 'Unable to validate scenario.')
            setValidationLoading(false)
          })
      }

      const handleAdvanceToOptimizationSetup = () => {
        if (id === null || id === undefined) {
          setValidationError("No scenario selected.")
          return
        }
        setValidationAdvancing(true)
        const version = ++validationVersion.current;
        advanceToOptimizationSetup(port, id)
          .then(() => {
            if (validationVersion.current !== version) return;
            syncScenarioData()
            handleCloseValidationDialog()
            handleSelection(1)
          })
          .catch((err) => {
            if (validationVersion.current !== version) return;
            console.error("error advancing to optimization setup: ", err)
            setValidationError(err instanceof Error ? err.message : 'Unable to advance to optimization setup.')
            if (err instanceof ApiClientError && err.validation) setValidationResult(err.validation);
          })
          .finally(() => {
            if (validationVersion.current === version) setValidationAdvancing(false)
          })
      }

      const handleSelectValidationTable = (tableName: string) => {
        handleSetCategory?.(tableName)
        setOpenValidationDialog(false)
      }

      const validateScenarioButton = <Button
                                sx={styles.unfilled}
                                onClick={() => handleValidateScenario()}
                                disabled={props.saving || inputDataEdited || backgroundTasks?.includes(id)}
                                variant="outlined"
                                size="large"
                                startIcon={<FactCheckIcon /> }
                              >
                                Validate Scenario
                              </Button>

  return ( 
    <Box sx={{ width: 500 }}>
      <CssBaseline />
      {downloadError && <ErrorBar errorMessage={downloadError} severity="error" setOpen={clearDownloadError} duration={8000} margin/>}
      <Paper sx={{ position: 'fixed', bottom: 0, left: '0px', right: 0, height: '60px', zIndex: 2 }} elevation={3}>
          {scenario ? 
            <Grid container sx={{marginTop: '10px'}}>
                <Grid item xs={3}>
                    <Box sx={{display: 'flex', justifyContent: 'flex-start', marginLeft:'10px'}}>
                        {section === 1 && <Button sx={styles.unfilled} onClick={() => handleSelection(0)} size="large" startIcon={<ArrowBackIcon />}>back </Button>}
                        {section === 2 && <Button sx={styles.unfilled} onClick={() => handleSelection(0)} size="large" startIcon={<ArrowBackIcon />}> review inputs &amp; settings </Button>}
                    </Box>
                </Grid>
                <Grid item xs={9}>
                    <Box sx={{display: 'flex', justifyContent: 'flex-end', marginRight:'10px'}}>
                        {section === 0 && (
                            status != "Incomplete" ?
                            <Box sx={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              {validateScenarioButton}
                              <Button
                                sx={styles.filled}
                                onClick={() => handleClick(1)}
                                variant="contained"
                                size="large"
                                endIcon={<ArrowForwardIcon /> }
                              >
                                continue to optimization
                              </Button>
                            </Box> : 
                            <Box sx={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              {validateScenarioButton}
                              {isAIAvailable && <Button
                                sx={styles.unfilled}
                                onClick={handleOpenAIPrompt}
                                variant="outlined"
                                size="large"
                                startIcon={<AutoAwesomeIcon />}
                              >
                                AI Fill Inputs
                              </Button>}
                              <Button
                                sx={styles.filled}
                                onClick={handleClickGenerateSpreadsheet}
                                disabled={downloading}
                                variant="contained"
                                size="large"
                                startIcon={<FileDownloadIcon />}
                              >
                                Generate Spreadsheet From Network
                              </Button>
                            </Box>
                        )}
                        {section === 1 && (
                          <Button
                            onClick={handleRunOptimize}
                            sx={styles.filled}
                            variant="contained"
                            size="large"
                            disabled={disableOptimize || props.saving || inputDataEdited}
                            endIcon={<ArrowForwardIcon /> }
                          >
                            Optimize
                          </Button>
                        )}
                        {(section === 2 && hasOverride) && (
                          <Button
                            onClick={() => setOpenRerunModal(true)}
                            sx={styles.filled}
                            variant="contained"
                            size="large"
                            disabled={disableOptimize || props.saving || inputDataEdited}
                            endIcon={<ArrowForwardIcon />}
                          >
                            Re-run Optimization
                          </Button>
                        )}
                    </Box>
                </Grid>
            </Grid>
          : 
          null}
        
      </Paper>
      <PopupModal
        hasTwoButtons
        open={openSaveModal}
        handleClose={handleCloseSaveModal}
        handleSave={handleSaveModal}
        handleButtonTwoClick={handleDiscardChanges}
        text="Do you want to save changes made to this table?"
        buttonText='Save'
        buttonColor='primary'
        buttonVariant='contained'
        buttonTwoText='Discard'
        buttonTwoColor='error'
        buttonTwoVariant='outlined'
        width={400}
      />
      <PopupModal
        hasInput
        hasTwoButtons
        open={openRerunModal}
        handleClose={handleCloseRerunModal}
        handleSave={reoptimizeNewScenario}
        handleButtonTwoClick={handleRunOptimize}
        text="Would you like to create a new copy of this scenario for this optimization, or overwrite the current scenario?"
        buttonText='Create New Scenario'
        buttonColor='primary'
        buttonVariant='contained'
        buttonTwoText='Overwrite Current Scenario'
        buttonTwoColor='secondary'
        buttonTwoVariant='outlined'
        inputText={newScenarioName}
        textLabel={'New Scenario Name'}
        width={850}
        iconOne={<AddIcon/>}
        iconTwo={<ArrowForwardIcon/>}
        handleEditText={handleEditNewScenarioName}
        showError={showModalError}
        errorText={modalError}
      />
      {isAIAvailable && <AIPromptDialog
        open={openAIPrompt}
        onClose={handleCloseAIPrompt}
        scenarioId={id}
        scenarioName={name}
        validationFindings={aiValidationFindings}
        onApplied={handleAIUpdatesApplied}
      />}
      <ScenarioValidationDialog
        open={openValidationDialog}
        loading={validationLoading}
        advancing={validationAdvancing}
        error={validationError}
        result={validationResult}
        onAdvance={handleAdvanceToOptimizationSetup}
        onSelectTable={handleSelectValidationTable}
        onCheckFeasibility={() => handleValidateScenario(true)}
        onSelectIssue={issue => { setOpenValidationDialog(false); props.focusInputIssue?.(issue); }}
        onAskAI={handleFixValidationWithAI}
        onClose={handleCloseValidationDialog}
      />
    </Box>
  );

}
