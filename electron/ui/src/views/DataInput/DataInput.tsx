import {getParameterTable} from '../../parameterTables';
import './DataInput.css';
import React from 'react';
import {useEffect, useState} from 'react';
import type { DataInputProps, Scenario } from '../../types';
import type { SelectChangeEvent } from '@mui/material/Select';
import { Alert, Grid, Box, FormControl, MenuItem, Select, Button, Stack, Typography } from '@mui/material';
import CustomChart from '../../components/CustomChart/CustomChart'
import FilterDropdown from '../../components/FilterDropdown/FilterDropdown';
import ErrorBar from '../../components/ErrorBar/ErrorBar'
import InputSummary from '../../components/InputSummary/InputSummary'
import NetworkDiagram from '../../components/NetworkDiagram/NetworkDiagram';
import DataTable from '../../components/DataTable/DataTable';
import {useScenario} from '../../context/ScenarioContext';
import ForecastFill from '../../components/ScenarioCompletion/ForecastFill';
import FilterListIcon from '@mui/icons-material/FilterList';
import UndoIcon from '@mui/icons-material/Undo';

export default function DataInput(props: DataInputProps) {
  const {inputFocus, isSaving} = useScenario();
  const { 
    updateScenario,
    category,
    handleSetCategory,
    syncScenarioData,
    handleUpdateExcel,
    handleEditInput,
    edited,
    scenario: incomingScenario,
  } = props;
  const [ scenario, setScenario] = useState<Scenario>({...incomingScenario})
  const [ editDict, setEditDict ] = useState<Record<string, boolean>>({})
  const [ columnNodesMapping, setColumnNodesMapping ] = useState<string[]>([]) // the column mapping; set once and remains the same
  const [ columnNodes, setColumnNodes ] = useState<Record<string, boolean>>({}) // dictionary with true false values for each column
  const [ filteredColumnNodes, setFilteredColumnNodes ] = useState<string[]>([]) // list of active columns
  const [ columnFilterSet, setColumnFilterSet ] = useState<Record<string, {amt:number,checked:boolean}>>({}) // dictionary containing all unique columns and the corresponding amount of each column
  const [ rowNodesMapping, setRowNodesMapping ] = useState<string[]>([]) 
  const [ rowNodes, setRowNodes ] = useState<Record<string, boolean>>({})
  const [ filteredRowNodes, setFilteredRowNodes ] = useState<string[]>([])
  const [ rowFilterSet, setRowFilterSet ] = useState<Record<string, {amt:number,checked:boolean}>>({})
  const [ plotCategory, setPlotCategory ] = useState<string>("CompletionsDemand")
  const [ showError, setShowError ] = useState<boolean>(false)
  const isLocalStagedEditRef = React.useRef<boolean>(false)
  const prevTableLayoutRef = React.useRef<string>("")
  const cleanScenarioRef = React.useRef<Scenario>(JSON.parse(JSON.stringify(incomingScenario)))
  const [ isStagingEditLatched, setIsStagingEditLatched ] = useState<boolean>(false)
  const [ showChangedRowsOnly, setShowChangedRowsOnly ] = useState<boolean>(false)
  const isAllColumnsSelected = columnNodesMapping.length > 0 && filteredColumnNodes.length === columnNodesMapping.length;
  const isAllRowsSelected = rowNodesMapping.length > 0 && filteredRowNodes.length === rowNodesMapping.length;
  const hasOpenCellEditor = Object.values(editDict).some(Boolean);
  const plotCategoryDictionary  = {
    "CompletionsDemand": "CompletionsPads",
    "PadRates": "ProductionPads",
    "FlowbackRates": "CompletionsPads"
  }
  var keyIndexMapping = {}

  useEffect(()=>{
    /*
      when category is changed, reset the nodes for filtering (columns and rows of current table)
    */
    try {
      if (category !== "Plots" && category !== "Network Diagram" && category !== "Input Summary") {
        const activeParams = incomingScenario.data_input.df_parameters;
        const activeTable = getParameterTable(activeParams, category) || {};
        const colKeys = Object.keys(activeTable);
        const firstColRows = colKeys.length > 0 && Array.isArray(activeTable[colKeys[0]]) ? activeTable[colKeys[0]] : [];
        const layoutSignature = `${incomingScenario?.id ?? ''}::${category}::${colKeys.join('|')}::${firstColRows.join('|')}`;

        if (isLocalStagedEditRef.current && layoutSignature === prevTableLayoutRef.current) {
          isLocalStagedEditRef.current = false;
          setScenario({...incomingScenario});
          return;
        }
        isLocalStagedEditRef.current = false;
        prevTableLayoutRef.current = layoutSignature;

        let tempEditDict = {}
        let tempColumnNodes = {}
        let tempColumnNodesMapping = []
        let tempRowNodes = {}
        let tempRowNodesMapping = []
        let tempColumnFilterSet = {}
        let tempRowFilterSet =  {}


        // determine unique row and column keys for row and column filter sets
        let grabbedRowList = false
        for(let colKey of Object.keys(getParameterTable(activeParams, category) || {})) {

          // first key:value pair contains all the row names
          if (!grabbedRowList) {
            let tempRowList = getParameterTable(activeParams, category)[colKey]
            for (let rowKey of tempRowList) {
              if(Object.keys(tempRowFilterSet).includes(`${rowKey}`)) tempRowFilterSet[rowKey].amt = tempRowFilterSet[rowKey].amt + 1
              else tempRowFilterSet[rowKey] = {amt: 1, checked: true}
            }
            grabbedRowList = true
          }
          if(Object.keys(tempColumnFilterSet).includes(colKey)) tempColumnFilterSet[colKey].amt = tempColumnFilterSet[colKey].amt + 1
          else tempColumnFilterSet[colKey] = {amt: 1, checked: true}
        }
        
        // determing mappings between index/values and rows+columns
        Object.entries(getParameterTable(activeParams, category) || {}).map( ([key, value], ind) => {
          if (ind === 0) {
            // tempRowNodesMapping = value
            value.map ((v,i) => {
              tempRowNodesMapping.push(`${i}::${v}`)
              tempRowNodes[`${i}::${v}`] = true
              return 1
            })
          } else {
            tempColumnNodesMapping.push(`${ind}::${key}`)
            tempColumnNodes[`${ind}::${key}`] = true
          }
          getParameterTable(activeParams, category)[key].map( (value, index) => {
            tempEditDict[`${ind}:${index}`] = false
            return 1
          })
          return 1
        })
        setEditDict(tempEditDict)
        setColumnNodes(tempColumnNodes)
        setRowNodes(tempRowNodes)
        setFilteredColumnNodes(tempColumnNodesMapping)
        setFilteredRowNodes(tempRowNodesMapping)
        setColumnNodesMapping(tempColumnNodesMapping)
        setRowNodesMapping(tempRowNodesMapping) 
        setRowFilterSet(tempRowFilterSet)
        setColumnFilterSet(tempColumnFilterSet)
      }
    } catch (e) {
      console.error('unable to set edit dictionary: ',e)
    }
    setScenario({...incomingScenario})
    if (!edited) {
      cleanScenarioRef.current = JSON.parse(JSON.stringify(incomingScenario));
    }
    
  }, [category, incomingScenario]);

  
  const handlePlotCategoryChange = (event: SelectChangeEvent<string>) =>{
   setPlotCategory(event.target.value as string)
  }

  const handleSaveChanges = async () => {
    //api call to save changes on backend
    const saved = await handleUpdateExcel(scenario.id, category, getParameterTable(scenario.data_input.df_parameters, category));
    if (saved === false) return;
    cleanScenarioRef.current = JSON.parse(JSON.stringify(scenario));
    handleEditInput(false)
    let tempEditDict = {}
    Object.entries(getParameterTable(scenario.data_input.df_parameters, category)).map( ([key, value], ind) => {
      getParameterTable(scenario.data_input.df_parameters, category)[key].map( (value, index) => {
        tempEditDict[`${ind}:${index}`] = false
        return 1
      })
      return 1
    })
    setEditDict(tempEditDict)
   }

  const handleRevertChanges = () => {
    const restored = JSON.parse(JSON.stringify(cleanScenarioRef.current)) as Scenario;
    if (
      !hasAnyAIStaged &&
      incomingScenario?.data_input?.df_parameters?.[category] &&
      restored.data_input?.df_parameters?.[category]
    ) {
      incomingScenario.data_input.df_parameters[category] = JSON.parse(
        JSON.stringify(restored.data_input.df_parameters[category]),
      );
    }
    const tempEditDict: Record<string, boolean> = {};
    Object.entries(getParameterTable(restored.data_input.df_parameters, category) || {}).forEach(
      ([_key, value], ind) => {
        if (Array.isArray(value)) {
          value.forEach((_v, index) => {
            tempEditDict[`${ind}:${index}`] = false;
          });
        }
      },
    );
    setIsStagingEditLatched(false);
    setEditDict(tempEditDict);
    setScenario(restored);
    handleEditInput(false);
    props.onDiscardManualEdits?.();
  };

   const handleColumnFilter = (col) => {
    var tempCols
    let tempColumnNodes = {...columnNodes}
    let tempColumnFilterSet = {...columnFilterSet}
    if (col === 'all') {
      tempCols = filteredColumnNodes.length === columnNodesMapping.length ? [] : columnNodesMapping
      if (filteredColumnNodes.length === columnNodesMapping.length) {
        for (const key of Object.keys(tempColumnNodes)) {
          tempColumnNodes[key] = false
        }
      } else {
        for (const key of Object.keys(tempColumnNodes)) {
          tempColumnNodes[key] = true
        }
      }

      setColumnNodes(tempColumnNodes)
      setFilteredColumnNodes(tempCols);

      // handle column filter set
      let allChecked = true
      for (let key of Object.keys(tempColumnFilterSet)) {
        if(!tempColumnFilterSet[key].checked) allChecked = false
      }
      if (allChecked) {
        for (let key of Object.keys(tempColumnFilterSet)) {
          tempColumnFilterSet[key].checked = false
        }
      } else {
        for (let key of Object.keys(tempColumnFilterSet)) {
          tempColumnFilterSet[key].checked = true
        }
      }
      setColumnFilterSet(tempColumnFilterSet)

    }
    else {
      tempCols = [...filteredColumnNodes]
      const index = tempCols.indexOf(col);
      if (index > -1) {
        tempCols.splice(index, 1); // 2nd parameter means remove one item only
      } else{
        tempCols.push(col)
      }

      // handle column filter set
      for (let key of Object.keys(tempColumnNodes)) {
        if(key.includes(col)) {
          tempColumnNodes[key] = !tempColumnNodes[key]
        }
      }
      tempColumnFilterSet[col].checked = !tempColumnFilterSet[col].checked
      setColumnFilterSet(tempColumnFilterSet)

      tempColumnNodes[col] = !tempColumnNodes[col]
      setColumnNodes(tempColumnNodes)
      setFilteredColumnNodes(tempCols)
    }
}

const handleRowFilter = (row) => {
    var tempRows
    let tempRowNodes = {...rowNodes}
    let tempRowFilterSet = {...rowFilterSet}
    if (row === 'all') {
      tempRows = filteredRowNodes.length === rowNodesMapping.length ? [] : rowNodesMapping
      if (filteredRowNodes.length === rowNodesMapping.length) {
        for (const key of Object.keys(tempRowNodes)) {
          tempRowNodes[key] = false
        }
      } else {
        for (const key of Object.keys(tempRowNodes)) {
          tempRowNodes[key] = true
        }
      }
      setRowNodes(tempRowNodes)
      setFilteredRowNodes(tempRows);

      // handle row filter set 
      let allChecked = true
      for (let key of Object.keys(tempRowFilterSet)) {
        if(!tempRowFilterSet[key].checked) allChecked = false
      }
      if (allChecked) {
        for (let key of Object.keys(tempRowFilterSet)) {
          tempRowFilterSet[key].checked = false
        }
      } else {
        for (let key of Object.keys(tempRowFilterSet)) {
          tempRowFilterSet[key].checked = true
        }
      }
      setRowFilterSet(tempRowFilterSet)
    }
    else {
      tempRows = [...filteredRowNodes]
        const index = tempRows.indexOf(row);
        if (index > -1) {
          tempRows.splice(index, 1);
        } else{
          tempRows.push(row)
        }

        // handle row filter set
        for (let key of Object.keys(tempRowNodes)) {
          if(key.includes(row)) {
            tempRowNodes[key] = !tempRowNodes[key]
          }
        }
        tempRowFilterSet[row].checked = !tempRowFilterSet[row].checked
        setRowFilterSet(tempRowFilterSet)

        tempRowNodes[row] = !tempRowNodes[row]
        setRowNodes(tempRowNodes)
        setFilteredRowNodes(tempRows)
    }
}

  const activeTableAIDiff = props.aiDiff?.changedTables?.[category];
  const hasAnyAIStaged = Boolean(props.aiDiff?.hasStagedChanges);

  useEffect(() => {
    if (hasOpenCellEditor && hasAnyAIStaged) {
      setIsStagingEditLatched(true);
    } else if (!hasOpenCellEditor) {
      setIsStagingEditLatched(false);
    }
  }, [hasOpenCellEditor, hasAnyAIStaged]);

  useEffect(() => {
    setIsStagingEditLatched(false);
    setShowChangedRowsOnly(false);
  }, [category]);

  useEffect(() => {
    if (!activeTableAIDiff?.changedRowCount || activeTableAIDiff.nonTabular) {
      setShowChangedRowsOnly(false);
    }
  }, [activeTableAIDiff?.changedRowCount, activeTableAIDiff?.nonTabular]);

  const changedRowIndexSet = React.useMemo(() => {
    const indices = new Set<number>();
    if (!activeTableAIDiff?.changedCells) return indices;
    Object.keys(activeTableAIDiff.changedCells).forEach(cellKey => {
      const rowIdx = Number(cellKey.split(':')[0]);
      if (Number.isInteger(rowIdx) && rowIdx >= 0) {
        indices.add(rowIdx);
      }
    });
    return indices;
  }, [activeTableAIDiff]);

  const effectiveRowNodes = React.useMemo(() => {
    if (!showChangedRowsOnly || !activeTableAIDiff || changedRowIndexSet.size === 0) {
      return rowNodes;
    }
    const next: Record<string, boolean> = {};
    rowNodesMapping.forEach((mappingKey, idx) => {
      const baseVisible = Object.keys(rowNodes).length === 0 ? true : Boolean(rowNodes[mappingKey]);
      next[mappingKey] = baseVisible && changedRowIndexSet.has(idx);
    });
    return next;
  }, [showChangedRowsOnly, activeTableAIDiff, changedRowIndexSet, rowNodes, rowNodesMapping]);

  const renderAIStagedBanner = () => {
    if (!hasAnyAIStaged) return null;
    const cellCount = activeTableAIDiff?.changedCellCount || 0;
    const changedRowCount = activeTableAIDiff?.changedRowCount || 0;
    const isTabularCategory = category !== 'Plots' && category !== 'Network Diagram' && category !== 'Input Summary';
    return (
      <Alert
        severity="info"
        sx={{ mx: 3, mt: 2, mb: 0, textAlign: 'left', alignItems: 'center' }}
        action={
          <Stack direction="row" spacing={1}>
            {isTabularCategory && !activeTableAIDiff?.nonTabular && changedRowCount > 0 && (
              <Button
                size="small"
                variant={showChangedRowsOnly ? 'contained' : 'outlined'}
                aria-pressed={showChangedRowsOnly}
                startIcon={<FilterListIcon fontSize="small" />}
                onClick={() => setShowChangedRowsOnly(prev => !prev)}
                sx={
                  showChangedRowsOnly
                    ? { backgroundColor: '#0b89b9', '&:hover': { backgroundColor: '#01678f' }, textTransform: 'none' }
                    : { borderColor: '#01678f', color: '#015272', textTransform: 'none' }
                }
              >
                {showChangedRowsOnly
                  ? `Showing changed rows (${changedRowCount})`
                  : `Show changed rows only (${changedRowCount})`}
              </Button>
            )}
            {props.onDiscardAIStaged && (
              <Button
                size="small"
                color="inherit"
                disabled={Boolean(props.isApplyingAI || props.isAIRunning)}
                onClick={props.onDiscardAIStaged}
              >
                Discard
              </Button>
            )}
            {props.onApplyAIStaged && (
              <Button
                size="small"
                variant="contained"
                disabled={Boolean(props.isApplyingAI || props.isAIRunning || edited)}
                onClick={() => void props.onApplyAIStaged?.()}
                sx={{ backgroundColor: '#01678f', '&:hover': { backgroundColor: '#015272' } }}
              >
                {props.isApplyingAI ? 'Saving…' : 'Apply AI Changes'}
              </Button>
            )}
          </Stack>
        }
      >
        {cellCount > 0
          ? `${cellCount} AI-proposed cell change${cellCount === 1 ? '' : 's'} highlighted below (hover any highlighted cell to compare saved vs staged, or double-click to tweak before applying).`
          : `Staged AI edits are ready across ${props.aiDiff?.totalChangedTables || 0} table(s). Open any highlighted tab in the left sidebar or AI panel to inspect them.`}
      </Alert>
    );
  };

  const renderInputCategory = () => {
    try {
      /*
        if category is plots, return input plots
      */
      if(category === "Plots") {
          return (
            <Box style={{backgroundColor:'white'}} sx={{m:3, padding:2, boxShadow:3}}>
              <Box display="flex" justifyContent="center" sx={{marginBottom:"20px"}}>
                <FormControl sx={{ width: "30ch" }} size="small">
                    <Select
                    value={plotCategory}
                    onChange={handlePlotCategoryChange}
                    sx={{color:'#0b89b9', fontWeight: "bold"}}
                    >
                    <MenuItem key={0} value={"CompletionsDemand"}>Completion Pad Demand</MenuItem>
                    <MenuItem key={1} value={"PadRates"}>Production Forecast</MenuItem>
                    <MenuItem key={2} value={"FlowbackRates"}>Flowback Forecast</MenuItem>
                    </Select>
                </FormControl>
            </Box>
                <CustomChart
                  input
                  category={plotCategoryDictionary[plotCategory]}
                  data={getParameterTable(scenario.data_input.df_parameters, plotCategory)}
                  title={plotCategory}
                  xaxis={{titletext: "Planning Horizon (weeks)"}}
                  yaxis={{titletext: "Amount of Water (bbl/week)"}}
                  width={750}
                  height={500}
                  showlegend={true}
                  chartType={'area'}
                  stackgroup={"one"}
                />
            </Box>
            )
      }
      /*
        if category is network diagram, return demo image
      */
        else if(category === "Network Diagram"){
          return (
            <Box style={{backgroundColor:'white'}} sx={{m:3, padding:2, boxShadow:3, overflow: "scroll"}}>
              <NetworkDiagram 
                scenario={props.scenario}
                type={"input"}
                syncScenarioData={syncScenarioData}
                {...props}
              />
            </Box>
          )
        }
      /*
        if category is input summary, return input summary tables
      */
        else if(category === "Input Summary"){
          return (
            <Box style={{backgroundColor:'white'}} sx={{m:3, padding:2, boxShadow:3, overflow: "scroll"}}>
              <InputSummary 
                completionsDemand={getParameterTable(scenario.data_input.df_parameters, 'CompletionsDemand')}
                padRates={getParameterTable(scenario.data_input.df_parameters, 'PadRates')}
                flowbackRates={getParameterTable(scenario.data_input.df_parameters, 'FlowbackRates')}
                initialDisposalCapacity={getParameterTable(scenario.data_input.df_parameters, 'InitialDisposalCapacity')}
                initialTreatmentCapacity={getParameterTable(scenario.data_input.df_parameters, 'InitialTreatmentCapacity')}
                scenario={scenario}
                handleSetCategory={handleSetCategory} 
                updateScenario={updateScenario}
                uploadDisabled={Boolean(edited || isSaving || hasAnyAIStaged || props.isApplyingAI || props.isAIRunning)}
              />
            </Box>
          )
        }
      /*
        else, return table for input category dictionary
      */
      else {
        return (
          <Box style={{backgroundColor:'white'}} sx={{m:3, padding:2, boxShadow:3}}>
        {['PadRates', 'CompletionsDemand', 'FlowbackRates', 'ExtWaterSourcingAvailability', 'ReuseMinimum', 'ReuseCapacity', 'DisposalOperatingCapacity'].includes(category) &&
          <ForecastFill key={`${category}-${scenario.input_revision}`} name={category} table={getParameterTable(scenario.data_input.df_parameters, category)}
            periods={scenario.data_input.df_sets.TimePeriods || []} unit={category === 'DisposalOperatingCapacity' ? 'fraction, 0–1' : scenario.data_input.display_units[category] || 'bbl/day'}
            disabled={edited || isSaving || hasAnyAIStaged || Boolean(props.isApplyingAI || props.isAIRunning)} onSave={async table => (await handleUpdateExcel(scenario.id, category, table)) !== false} />}
        {edited && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              disabled={isSaving}
              onClick={handleSaveChanges}
              sx={{ backgroundColor: '#01678f', '&:hover': { backgroundColor: '#015272' } }}
            >
              Save Changes
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={isSaving}
              startIcon={<UndoIcon fontSize="small" />}
              onClick={handleRevertChanges}
            >
              Revert
            </Button>
          </Stack>
        )}
        <Grid container>
          <Grid item xs={0.5} />
          <Grid item xs={11}>
            <DataTable
              key={category}
              disabled={Boolean(isSaving || props.isApplyingAI || props.isAIRunning)}
              validationFocus={inputFocus}
              aiTableDiff={activeTableAIDiff}
              onRevertStagedCell={
                props.onRevertStagedCell
                  ? (rowIdx, colIdx) => props.onRevertStagedCell?.(category, rowIdx, colIdx)
                  : undefined
              }
              onStagedTableEdit={
                (hasAnyAIStaged || isStagingEditLatched) && props.onUpdateStagedTable
                  ? updatedTable => {
                      isLocalStagedEditRef.current = true;
                      props.onUpdateStagedTable?.(category, updatedTable);
                    }
                  : undefined
              }
              section="input"
              editDict={editDict}
              setEditDict={setEditDict}
              scenario={scenario}
              setScenario={setScenario}
              columnNodesMapping={columnNodesMapping}
              columnNodes={columnNodes}
              filteredColumnNodes={filteredColumnNodes}
              rowNodesMapping={rowNodesMapping}
              rowNodes={effectiveRowNodes}
              filteredRowNodes={filteredRowNodes}
              setShowError={setShowError}
              category={category}
              handleEditInput={handleEditInput}
              data={scenario.data_input.df_parameters}
            />
          </Grid>
          <Grid item xs={0.5}>
            <Box sx={{display: 'flex', justifyContent: 'flex-end', marginLeft:'10px'}}>
            <FilterDropdown
                width="300px"
                maxHeight="300px"
                option1="Column"
                filtered1={filteredColumnNodes}
                total1={columnNodesMapping}
                isAllSelected1={isAllColumnsSelected}
                handleFilter1={handleColumnFilter}
                option2="Row"
                filtered2={filteredRowNodes}
                total2={rowNodesMapping}
                isAllSelected2={isAllRowsSelected}
                handleFilter2={handleRowFilter}
                rowFilterSet={rowFilterSet}
                columnFilterSet={columnFilterSet}
              />
            </Box>
          </Grid>
        </Grid>
        {
            showError && <ErrorBar duration={2000} margin setOpen={setShowError} severity="error" errorMessage="Unable to edit values while optimization is running" />
        }
        </Box>
        )
      }
      
    } catch (e) {
      console.error("unable to render input category: ",e)
    }
}
  return (
    <>
      {renderAIStagedBanner()}
      {renderInputCategory()}
    </>
  );

}
