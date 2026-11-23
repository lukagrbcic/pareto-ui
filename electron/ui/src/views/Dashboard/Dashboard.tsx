import './Dashboard.css';
import {useEffect, useMemo, useRef, useState, type ChangeEvent} from 'react';   
import {  } from "react-router-dom";
import { Alert, Box, Button, Grid, IconButton, Stack } from '@mui/material'
import OptimizationProgress from '../../components/OptimizationProgress/OptimizationProgress';
import ScenarioCompletion from '../../components/ScenarioCompletion/ScenarioCompletion';
import EditIcon from '@mui/icons-material/Edit';
import ProcessToolbar from '../../components/ProcessToolbar/ProcessToolbar'
import Bottombar from '../../components/Bottombar/Bottombar'; 
import DataInput from '../DataInput/DataInput'
import Optimization from '../Optimization/Optimization'
import ModelResults from '../ModelResults/ModelResults'
import Sidebar from '../../components/Sidebar/Sidebar'
import AISidePanel, { AI_PANEL_EXPANDED_WIDTH, AI_PANEL_WIDTH } from '../../components/AISidePanel/AISidePanel';
import PopupModal from '../../components/PopupModal/PopupModal'
import { useApp } from '../../AppContext';
import { MapProvider } from '../../context/MapContext';
import { useScenario } from "../../context/ScenarioContext";
import { useOptionalAIPrompt } from '../../context/AIPromptContext';
import { getParameterTable } from '../../parameterTables';
import { buildMergedSaveScenario, buildPreviewScenario, computeAIDiff } from '../../utils/aiStaging';


export default function Dashboard() {
  const { 
    scenarios, scenarioData: scenario, navigateToScenarioList: navigateHome, handleScenarioUpdate: updateScenario,
    handleEditScenarioName, section, category, handleSetSection,
    handleSetCategory, appState, backgroundTasks, syncScenarioData, acceptSavedScenario,
    copyAndRunOptimization, handleUpdateExcel, isSaving, saveError, inputFocus, focusInputIssue,
    startOptimization: handleRunModel, optimizationStart, isStartingOptimization, retryOptimizationStart, dismissOptimizationStart,
    undoHistory = [],
    canRevertSaved = false,
    getLatestUndoEntry,
    revertLastSavedChange,
    discardDraftEdits,
    markNextSaveMeta,
  } = useScenario();
  // console.log(scenario)
  
  const [ name, setName ] = useState<string>('')
  const [ openEditName, setOpenEditName ] = useState<boolean>(false)
  const [ inputDataEdited, setInputDataEdited ] = useState<boolean>(false)
  const [ pendingAITable, setPendingAITable ] = useState<string | null>(null)
  const [ isApplyingAI, setIsApplyingAI ] = useState<boolean>(false)
  const [ isReverting, setIsReverting ] = useState<boolean>(false)
  const [ revalidateSignal, setRevalidateSignal ] = useState<number>(0)
  const {
    isAvailable: isAIAvailable,
    isPanelOpen,
    isPanelExpanded,
    isRunning,
    requestScenarioId,
    openPanel,
    getThread,
    updateStagedParameterTable,
    invalidateStaleStagedUpdates,
    discardStagedUpdates,
    markStagedUpdatesApplied,
    appendSystemNotice,
    revertStagedTable,
    revertStagedSet,
    revertStagedCell,
  } = useOptionalAIPrompt();

  const isApplyingAIRef = useRef<boolean>(false);
  const aiThread = getThread?.(scenario?.id);
  const latestUndoEntry = undoHistory.length > 0 ? undoHistory[undoHistory.length - 1] : null;
  const aiDiff = useMemo(
    () => computeAIDiff(scenario?.data_input, aiThread?.stagedScenario),
    [scenario?.data_input, aiThread?.stagedScenario],
  );
  const previewScenario = useMemo(
    () => buildPreviewScenario(scenario, aiThread?.stagedScenario),
    [scenario, aiThread?.stagedScenario],
  );

  const enabledStatusList = ['Optimized','Draft','failure', 'Not Optimized', 'Infeasible']
  const disableOptimize = isStartingOptimization || backgroundTasks.length > 0 || !enabledStatusList.includes(scenario?.results?.status);
  const showSidebar = section === 0 || (section === 2 && !optimizationStart && scenario?.results?.status?.includes('Optimized'));
  const showAIPanel = Boolean(scenario && isAIAvailable && isPanelOpen);
  const isAIRunningForScenario = Boolean(isRunning && scenario && requestScenarioId === Number(scenario.id));
  const activeAIPanelWidth = isPanelExpanded ? AI_PANEL_EXPANDED_WIDTH : AI_PANEL_WIDTH;

  const handleOpenEditName = () => setOpenEditName(true);
  const handleCloseEditName = () => setOpenEditName(false);
  const { port } = useApp();

  /*
    TODO: make api call to fetch scenario by ID here.
  */

  useEffect(()=>{
    try {
      if(!scenario) {
        navigateHome()
      } else {
        setInputDataEdited(false)
        setName(scenario.name)
      }
    }
    catch (e){
      console.error('unable to set scenario name: ',e)
    }
  }, [scenario]);

   const styles = {
    shiftTextLeft: {
      paddingLeft: '0px'
    },
    shiftTextRight: {
      paddingLeft: '240px',
      pb: 7
      // paddingTop: '184px'
    },
    titleDivider: {
      m:2, 
      marginTop:2
    },
   }

  const handleEditName = (event: ChangeEvent<HTMLInputElement>) => {
   setName(event.target.value)
  }

   const handleSaveName = () => {
    handleEditScenarioName(name, scenario.id, true)
    setOpenEditName(false)
  }

  useEffect(() => {
    if (
      !isApplyingAIRef.current &&
      scenario?.id !== undefined &&
      scenario?.id !== null &&
      aiThread?.stagedScenario &&
      aiThread.stagedBaseRevision &&
      scenario.input_revision &&
      aiThread.stagedBaseRevision !== scenario.input_revision
    ) {
      invalidateStaleStagedUpdates?.(scenario.id, scenario.input_revision);
    }
  }, [
    scenario?.id,
    scenario?.input_revision,
    aiThread?.stagedScenario,
    aiThread?.stagedBaseRevision,
    invalidateStaleStagedUpdates,
  ]);

  const handleApplyStagedAI = async () => {
    if (
      !scenario ||
      !aiThread?.stagedScenario ||
      isApplyingAI ||
      isApplyingAIRef.current ||
      inputDataEdited ||
      isAIRunningForScenario ||
      isSaving
    ) {
      return;
    }
    isApplyingAIRef.current = true;
    setIsApplyingAI(true);
    try {
      const merged = buildMergedSaveScenario(scenario, aiThread.stagedScenario);
      const aiUndoLabel =
        aiDiff.totalChangedTables > 0
          ? `AI changes (${aiDiff.totalChangedTables} table${aiDiff.totalChangedTables === 1 ? '' : 's'}, ${aiDiff.totalChangedCells} cell${aiDiff.totalChangedCells === 1 ? '' : 's'})`
          : 'AI scenario changes';
      markNextSaveMeta?.(scenario.id, { label: aiUndoLabel, source: 'ai' });
      const saved = await updateScenario(merged, false, 'json');
      if (saved) {
        setInputDataEdited(false);
        const summary =
          aiDiff.totalChangedTables > 0
            ? `Applied AI edits across ${aiDiff.totalChangedTables} table${aiDiff.totalChangedTables === 1 ? '' : 's'} (${aiDiff.totalChangedCells} cell${aiDiff.totalChangedCells === 1 ? '' : 's'}).`
            : 'Applied staged AI updates to scenario.';
        const newUndoId = getLatestUndoEntry?.(scenario.id)?.id;
        const shouldRevalidate = markStagedUpdatesApplied?.(scenario.id, summary, newUndoId);
        if (shouldRevalidate) {
          handleSetSection(0);
          handleSetCategory('Complete Scenario Inputs');
          setRevalidateSignal(prev => prev + 1);
        }
      }
    } finally {
      isApplyingAIRef.current = false;
      setIsApplyingAI(false);
    }
  };

  const handleRevertManualEdits = () => {
    setInputDataEdited(false);
    if (discardDraftEdits) {
      discardDraftEdits(scenario?.id);
    } else {
      syncScenarioData();
    }
  };

  const handleRevertSaved = async () => {
    if (!scenario || isReverting || isApplyingAI || isSaving) return;
    setIsReverting(true);
    try {
      const reverted = await revertLastSavedChange?.(scenario.id);
      if (reverted) {
        setInputDataEdited(false);
        if (reverted.source === 'ai') {
          appendSystemNotice?.(scenario.id, `Reverted ${reverted.label}.`);
        }
      }
    } finally {
      setIsReverting(false);
    }
  };

  const handleGlobalRevert = async () => {
    if (inputDataEdited) {
      handleRevertManualEdits();
      return;
    }
    if (aiDiff.hasStagedChanges) {
      handleDiscardStagedAI();
      return;
    }
    if (canRevertSaved) {
      await handleRevertSaved();
    }
  };

  const revertBlocked = Boolean(
    !scenario ||
    isSaving ||
    isApplyingAI ||
    isReverting ||
    isAIRunningForScenario ||
    isStartingOptimization ||
    backgroundTasks.includes(scenario.id),
  );
  const canGlobalRevert =
    !revertBlocked && Boolean(inputDataEdited || aiDiff.hasStagedChanges || canRevertSaved);
  const globalRevertLabel = inputDataEdited
    ? 'Revert unsaved table edits'
    : aiDiff.hasStagedChanges
      ? 'Revert staged AI changes'
      : latestUndoEntry
        ? `Revert: ${latestUndoEntry.label}`
        : 'No changes to revert';

  const handleRequestValidation = () => {
    handleSetSection(0);
    handleSetCategory('Complete Scenario Inputs');
    setRevalidateSignal(prev => prev + 1);
  };

  const handleDiscardStagedAI = () => {
    if (!scenario) return;
    discardStagedUpdates?.(scenario.id);
  };

  const handleSelectAITable = (tableKey: string) => {
    if (section === 0 && category === tableKey) return;
    if (inputDataEdited) {
      setPendingAITable(tableKey);
      return;
    }
    handleSetSection(0);
    handleSetCategory(tableKey);
  };

  const handleSaveBeforeAITableSwitch = async () => {
    if (!scenario || !pendingAITable) return;
    const saved = await handleUpdateExcel(
      scenario.id,
      String(category || ''),
      getParameterTable(scenario.data_input?.df_parameters, category || ''),
    );
    if (saved === false) return;
    const target = pendingAITable;
    setPendingAITable(null);
    setInputDataEdited(false);
    handleSetSection(0);
    handleSetCategory(target);
  };

  const handleDiscardBeforeAITableSwitch = () => {
    const target = pendingAITable;
    setPendingAITable(null);
    setInputDataEdited(false);
    if (discardDraftEdits) {
      discardDraftEdits(scenario?.id);
    } else {
      syncScenarioData();
    }
    if (target) {
      handleSetSection(0);
      handleSetCategory(target);
    }
  };
  
  return (
    <MapProvider scenario={scenario} handleUpdateScenario={updateScenario}>
      <ProcessToolbar 
        hasOptimizationStart={!!optimizationStart}
        handleSelection={handleSetSection} 
        selected={section} 
        scenario={scenario}
        category={category} 
        inputDataEdited={inputDataEdited}
        handleUpdateExcel={handleUpdateExcel}
        setInputDataEdited={setInputDataEdited}
        syncScenarioData={syncScenarioData}
        aiStagedCount={aiDiff.totalChangedTables + aiDiff.changedSets.length}
        canRevert={canGlobalRevert}
        revertLabel={globalRevertLabel}
        isReverting={isReverting}
        onRevert={handleGlobalRevert}
        onDiscardManualEdits={handleRevertManualEdits}
      >
      </ProcessToolbar>
      {showSidebar &&
        <Sidebar 
          handleSetCategory={handleSetCategory} 
          scenario={scenario} 
          section={section} 
          category={category} 
          inputFocus={inputFocus}
          inputDataEdited={inputDataEdited}
          handleUpdateExcel={handleUpdateExcel}
          setInputDataEdited={setInputDataEdited}
          syncScenarioData={syncScenarioData}
          onDiscardManualEdits={handleRevertManualEdits}
          aiDiff={aiDiff}
          >
        </Sidebar>
      }
      {showAIPanel && scenario && (
        <AISidePanel
          scenario={scenario}
          aiDiff={aiDiff}
          currentCategory={category}
          isApplying={isApplyingAI}
          hasUnsavedTableEdits={inputDataEdited}
          onSelectTable={handleSelectAITable}
          onApplyStaged={handleApplyStagedAI}
          onDiscardStaged={handleDiscardStagedAI}
          onRevertStagedTable={tableKey => revertStagedTable?.(scenario.id, tableKey, scenario.data_input)}
          onRevertStagedSet={setName => revertStagedSet?.(scenario.id, setName, scenario.data_input)}
          latestUndoEntry={latestUndoEntry}
          canRevertSaved={canRevertSaved}
          isReverting={isReverting}
          onRevertAppliedAI={handleRevertSaved}
        />
      )}
      
    <Grid
      container
      spacing={1}
      sx={{
        paddingLeft: showSidebar ? '240px' : '0px',
        paddingRight: showAIPanel ? `${activeAIPanelWidth}px` : '0px',
        pb: 9,
        transition: 'padding-right 180ms ease',
      }}
    >
      <Grid item xs={4} ></Grid>
      <PopupModal
        input
        open={openEditName}
        handleClose={handleCloseEditName}
        text={name}
        textLabel='Config Name'
        handleEditText={handleEditName}
        handleSave={handleSaveName}
        buttonText='Save'
        buttonColor='primary'
        buttonVariant='contained'
        width={400}
      />
      <Grid item xs={4}>
      <div>
        <b id='scenarioTitle' >
        {(scenario && section===0) && 
        <p>{scenario.name}
        <IconButton onClick={handleOpenEditName} style={{fontSize:"15px", zIndex:'0'}} disabled={enabledStatusList.includes(scenario.results.status) ? false : true}>
          <EditIcon fontSize='inherit'/>
        </IconButton>
        </p>
        }
      </b> 
      </div>
      </Grid>
      <Grid item xs={4}>
      </Grid>
      <Grid item xs={12}>
      {saveError && <Alert severity="error" action={<Button disabled={isSaving} onClick={syncScenarioData}>Reload saved inputs</Button>}>{saveError}</Alert>}
      {isSaving && <Alert severity="info">Saving scenario…</Alert>}
      {scenario && aiDiff.hasStagedChanges && (section === 1 || (section === 0 && category === 'Complete Scenario Inputs')) && (
        <Alert
          severity="info"
          sx={{ mx: 3, mt: 2, mb: 0, textAlign: 'left', alignItems: 'center' }}
          action={
            <Stack direction="row" spacing={1}>
              {!isPanelOpen && isAIAvailable && (
                <Button size="small" color="inherit" onClick={() => openPanel?.({ scenarioId: scenario.id })}>
                  Open AI Panel
                </Button>
              )}
              <Button
                size="small"
                color="inherit"
                disabled={isApplyingAI || isAIRunningForScenario}
                onClick={handleDiscardStagedAI}
              >
                Discard
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={isApplyingAI || isAIRunningForScenario || inputDataEdited || isSaving}
                onClick={() => void handleApplyStagedAI()}
                sx={{ backgroundColor: '#01678f', '&:hover': { backgroundColor: '#015272' } }}
              >
                {isApplyingAI ? 'Saving…' : 'Apply AI Changes'}
              </Button>
            </Stack>
          }
        >
          Staged AI edits are pending ({aiDiff.totalChangedTables} table{aiDiff.totalChangedTables === 1 ? '' : 's'}
          {aiDiff.changedSets.length > 0 ? `, ${aiDiff.changedSets.length} set${aiDiff.changedSets.length === 1 ? '' : 's'}` : ''}).
          Apply or discard them before running validation or optimization.
        </Alert>
      )}
      {(scenario && section === 0 && category === 'Complete Scenario Inputs') && (
        <ScenarioCompletion
          scenario={scenario}
          disabled={inputDataEdited || aiDiff.hasStagedChanges || isSaving || !!saveError || isStartingOptimization || backgroundTasks.includes(scenario.id)}
          onSelect={focusInputIssue}
          validateSignal={revalidateSignal}
          syncScenarioData={syncScenarioData}
          onAdvance={() => handleSetSection(1)}
        />
      )}
      {(previewScenario && section===0 && category !== 'Complete Scenario Inputs') &&
        <DataInput 
          handleUpdateExcel={handleUpdateExcel} 
          category={category} 
          scenario={previewScenario} 
          edited={inputDataEdited} 
          handleEditInput={setInputDataEdited}
          syncScenarioData={syncScenarioData}
          handleSetCategory={handleSetCategory} 
          updateScenario={updateScenario}
          aiDiff={aiDiff}
          isApplyingAI={isApplyingAI}
          isAIRunning={isAIRunningForScenario}
          onApplyAIStaged={handleApplyStagedAI}
          onDiscardAIStaged={handleDiscardStagedAI}
          onDiscardManualEdits={handleRevertManualEdits}
          onRevertStagedCell={(tableKey, rowIdx, colIdx) =>
            revertStagedCell?.(scenario.id, tableKey, rowIdx, colIdx, scenario.data_input)
          }
          onUpdateStagedTable={(tableKey, updatedTable) =>
            updateStagedParameterTable?.(scenario.id, tableKey, updatedTable, scenario.data_input, scenario.input_revision)
          }
        />
      }
      {(scenario && section===1) && 
        <Optimization 
          category={category} 
          scenario={scenario} 
          updateScenario={updateScenario}
          handleRunModel={handleRunModel}
          backgroundTasks={backgroundTasks} 
          disabled={disableOptimize || inputDataEdited || aiDiff.hasStagedChanges}
          saving={isSaving || isApplyingAI || !!saveError}
        />
      }
      {section === 2 && optimizationStart && (optimizationStart.error ?
        <Box sx={{m: 3}}>
          <Alert severity={optimizationStart.phase === 'uncertain' ? 'warning' : 'error'}>{optimizationStart.error}</Alert>
          {optimizationStart.phase === 'uncertain' ? <Button onClick={retryOptimizationStart}>Retry start request</Button> : <>
            <Button onClick={() => {dismissOptimizationStart(); syncScenarioData(); handleSetSection(0); handleSetCategory('Complete Scenario Inputs');}}>Review inputs &amp; settings</Button>
            {scenario.results.status === 'Optimized' && <Button onClick={dismissOptimizationStart}>View previous results</Button>}
          </>}
        </Box> : <OptimizationProgress status={optimizationStart.phase === 'copying' ? 'Copying scenario' : 'Submitting request'} />)}
      {(scenario && section===2 && !optimizationStart) &&
        <ModelResults 
          category={category} 
          scenario={scenario} 
          handleSetSection={handleSetSection} 
          appState={appState}
          syncScenarioData={syncScenarioData}
          scenarios={scenarios}
          updateScenario={updateScenario}
          handleSetCategory={handleSetCategory} 
        />
      }
      </Grid>
    </Grid>
    <Bottombar
      saving={isSaving || isApplyingAI || !!saveError || isStartingOptimization}
      hasStagedAI={aiDiff.hasStagedChanges}
      onRequestValidation={handleRequestValidation}
      onDiscardManualEdits={handleRevertManualEdits}
      acceptSavedScenario={acceptSavedScenario}
      focusInputIssue={focusInputIssue}
      handleSelection={handleSetSection} 
      handleSetCategory={handleSetCategory}
      section={section} 
      backgroundTasks={backgroundTasks} 
      scenario={scenario} 
      category={category}
      handleUpdateExcel={handleUpdateExcel}
      inputDataEdited={inputDataEdited}
      setInputDataEdited={setInputDataEdited}
      syncScenarioData={syncScenarioData}
      handleRunModel={handleRunModel}
      disableOptimize={disableOptimize}
      copyAndRunOptimization={copyAndRunOptimization}
      port={port}
      />
    <PopupModal
      hasTwoButtons
      open={Boolean(pendingAITable)}
      handleClose={() => setPendingAITable(null)}
      handleSave={handleSaveBeforeAITableSwitch}
      handleButtonTwoClick={handleDiscardBeforeAITableSwitch}
      text="Do you want to save changes made to this table?"
      buttonText='Save'
      buttonColor='primary'
      buttonVariant='contained'
      buttonTwoText='Discard'
      buttonTwoColor='error'
      buttonTwoVariant='outlined'
      width={400}
    />
    </MapProvider>
  );

}
