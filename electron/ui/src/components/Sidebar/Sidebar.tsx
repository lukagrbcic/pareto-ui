import {getParameterTable} from '../../parameterTables';
import React, {useState, useEffect, useMemo, useRef} from 'react';
import { Box, Drawer, CssBaseline, Collapse, Tooltip, IconButton } from '@mui/material'
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import { CategoryNames, ParetoDictionary, Subcategories } from "../../util";
import PopupModal from '../../components/PopupModal/PopupModal'
import MapEditor from '../NetworkMap/MapEditor';
import type { SidebarProps } from '../../types';
import { useMapValues } from '../../context/MapContext';


const drawerWidth = 240;
const expandedDrawerWidth = 560;

export default function Sidebar(props: SidebarProps) {
  const {
    handleSetCategory,
    scenario,
    section,
    category,
    inputFocus,
    inputDataEdited,
    handleUpdateExcel,
    setInputDataEdited,
    syncScenarioData,
  } = props;
  const {
    selectedNode,
    showNetworkNode,
    showNetworkPipeline,
    nodeData = [],
    clickNode,
  } = useMapValues();

  const { id, data_input, optimization, results, optimized_override_values, validation } = scenario || {};

  const { df_parameters } = data_input || {};
  const PipelineDiameterValues = getParameterTable(df_parameters, 'PipelineDiameterValues');
  const TreatmentCapacityIncrements = getParameterTable(df_parameters, 'TreatmentCapacityIncrements');

  const isIncomplete = results?.status === "Incomplete";
  const hasMapData = data_input?.map_data;
  const focusedIssue = useRef<typeof inputFocus>(null);
  const hasSelectedMapItem = Boolean(selectedNode && (showNetworkNode || showNetworkPipeline));
  const [ isMapEditorExpanded, setIsMapEditorExpanded ] = useState<boolean>(false);
  const activeDrawerWidth = isMapEditorExpanded ? expandedDrawerWidth : drawerWidth;
  const [ openSaveModal, setOpenSaveModal ] = useState<boolean>(false)
  const [ key, setKey ] =  useState<string | null>(null)
  const [ openDynamic, setOpenDynamic ] = useState<boolean>(true)
  const [ openStatic, setOpenStatic ] = useState<boolean>(false)
  const [ openResultsTables, setOpenResultsTables ] = useState<boolean>(false)
  const [ overrideList, setOverrideList ] = useState<string[]>([])
  const isInputSection = section === 0;
  const isOptimizationSettings = section === 1;
  const isOutputSection = section === 2;
  const showMapEditor = category === "Network Diagram" && hasMapData && isInputSection;
  const validationIssueTables = useMemo(() => {
    const missingTables = validation?.missing_tables || [];
    const tablesWithIssues = validation?.tables_with_issues || [];
    const issueTables = (validation?.issues || []).filter(issue => issue.severity === 'error' && issue.table).map(issue => issue.table as string);
    return new Set<string>([...missingTables, ...tablesWithIssues, ...issueTables]);
  }, [validation]);
  const aiChangedTables = useMemo(
    () => props.aiDiff?.changedTables || {},
    [props.aiDiff?.changedTables],
  );
  const dynamicAICount = useMemo(
    () => Subcategories.Dynamic.filter(name => Boolean(aiChangedTables[name])).length,
    [aiChangedTables],
  );
  const staticAICount = useMemo(
    () => Subcategories.Static.filter(name => Boolean(aiChangedTables[name])).length,
    [aiChangedTables],
  );

  useEffect(() => {
    if (!category) return;
    if (Subcategories.Dynamic.includes(String(category))) setOpenDynamic(true);
    if (Subcategories.Static.includes(String(category))) setOpenStatic(true);
  }, [category]);

  useEffect(() => {
    const tempOverrideList: string[] = []
    if (optimized_override_values !== undefined)  {
        for(const k of Object.keys(optimized_override_values)) {
            if(Object.keys(optimized_override_values[k] || {}).length > 0) {
              tempOverrideList.push(k)
            }
        }
    }
    if (tempOverrideList.length > 0) tempOverrideList.push("Results Tables")
    setOverrideList(tempOverrideList)
  },[scenario])

  useEffect(() => {
    setIsMapEditorExpanded(Boolean(showMapEditor && hasSelectedMapItem));
  }, [showMapEditor, hasSelectedMapItem]);

  useEffect(() => {
    if (section !== 0 || !showMapEditor || !inputFocus || focusedIssue.current === inputFocus || inputFocus.area !== 'map') return;
    const index = nodeData.findIndex(node => node.name === inputFocus.row?.[0]);
    if (index >= 0) {
      focusedIssue.current = inputFocus;
      clickNode(nodeData[index], index);
    }
  }, [section, showMapEditor, inputFocus, nodeData, clickNode]);

  const handleOpenSaveModal = () => setOpenSaveModal(true);
  const handleCloseSaveModal = () => setOpenSaveModal(false);

  const styles: any = {
    topLevelCategory: {
      paddingLeft: "0px",
      fontWeight: "500",
      margin: 0,
      // justifyContent: "space-between"
    },
    subcategory: {
      paddingLeft: "10px",
      margin: 0,
    },
    selected: {
      cursor: "pointer",
      color:"#0b89b9",
      backgroundColor: "#D4EFFF",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1,
      fontWeight: "bold"
    },
    unselected: {
      cursor: "pointer",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1
    },
    override: {
      backgroundColor: "rgb(255,215,0, 0.4)",
      cursor: "pointer",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1
    },
    validationIssue: {
      backgroundColor: "rgba(211, 47, 47, 0.12)",
      color: "#8f1d1d",
      cursor: "pointer",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1
    },
    validationIssueSelected: {
      cursor: "pointer",
      color: "#8f1d1d",
      backgroundColor: "rgba(211, 47, 47, 0.18)",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1,
      fontWeight: "bold"
    },
    aiStaged: {
      backgroundColor: "rgba(1, 103, 143, 0.10)",
      borderLeft: "3px solid #01678f",
      color: "#015272",
      cursor: "pointer",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1,
    },
    aiStagedSelected: {
      backgroundColor: "rgba(1, 103, 143, 0.20)",
      borderLeft: "3px solid #01678f",
      color: "#015272",
      cursor: "pointer",
      padding: 10,
      marginLeft: "10px",
      marginRight: "10px",
      borderRadius: "5px",
      textAlign: "left",
      marginTop: 1,
      marginBottom: 1,
      fontWeight: "bold",
    },
  }

  const handleSaveModal = async () => {
    if (await handleUpdateExcel?.(id as string | number, String(category || ''), getParameterTable(data_input?.df_parameters, category || '')) === false) return;
    handleCloseSaveModal()
    setInputDataEdited?.(false)
    handleSetCategory(String(key || ''))
  }

  const handleDiscardChanges = () => {
    handleCloseSaveModal()
    setInputDataEdited?.(false)
    handleSetCategory(String(key || ''))
    if (props.onDiscardManualEdits) {
      props.onDiscardManualEdits()
    } else {
      syncScenarioData?.()
    }
  }

  const handleClick = (k: string) => {
    setKey(k)
    if (inputDataEdited) {
      handleOpenSaveModal()
    }
    else {
      handleSetCategory(k)
    }
  }

  const getStyle = (k: string) => {
    try {
      if (String(category) === k && aiChangedTables[k]) return styles.aiStagedSelected
      if (String(category) === k && validationIssueTables.has(k)) return styles.validationIssueSelected
      if (String(category) === k) return styles.selected
      if (aiChangedTables[k]) return styles.aiStaged
      if (validationIssueTables.has(k)) return styles.validationIssue
      if (overrideList.includes(k)) return styles.override
      return styles.unselected
    }
    catch(e) {
      return styles.unselected
    }
  }

  const renderMapOptions = () => {
    const categories = {"Input Summary" :null, ...(isInputSection ? {"Complete Scenario Inputs": null} : {}), "Network Diagram": null}
    const inputSummaryLabel = isIncomplete ? "PARETO Input File" : "Input Summary";
    return (
      Object.entries(categories).map( ([k, value]) => ( 
        <div style={String(category)===k ? styles.selected : styles.unselected} onClick={() => handleClick(k)} key={`${value}${k}`}> 
            <p style={styles.topLevelCategory}>
              {k === "Input Summary" ? inputSummaryLabel : k}
            </p>
        </div>
      ))
    )
  }

  const renderAdditionalCategories = () => {
    const additionalCategories = isInputSection ? {"Input Summary" :null, "Complete Scenario Inputs": null, "Network Diagram": null, "Plots": null} : isOptimizationSettings ? {} : {"Dashboard": null, "Sankey": null, "Network Diagram": null}
    return (
      Object.entries(additionalCategories).map( ([k, value]) => ( 
        <div style={String(category)===k ? styles.selected : styles.unselected} onClick={() => handleClick(k)} key={`${value}${k}`}> 
            <p style={styles.topLevelCategory}>
              {k === "Input Summary" && results?.status === "Incomplete" ? "PARETO Input File" : k}
            </p>
        </div>
      ))
    )
  }

  const renderTopLevelCategories = () => {
    if (isInputSection) {
      return (
        <div>
          <div style={getStyle("Dynamic")}  onClick={() => setOpenDynamic(!openDynamic)}> 
            <p style={styles.topLevelCategory}>
              <span style={{display:"flex", justifyContent: "space-between", alignItems: "center"}}>
                <span>Dynamic Inputs{dynamicAICount > 0 ? ` (${dynamicAICount} AI)` : ""}</span>
                <IconButton disableRipple size="small" sx={{marginTop: -3, marginBottom: -3}}>{openDynamic ? <ExpandLess /> : <ExpandMore />}</IconButton>
              </span>
            </p>
            
              
          </div>
          {renderDynamicCategories()}
          <div style={getStyle("Static")}  onClick={() => setOpenStatic(!openStatic)}> 
              <p style={styles.topLevelCategory}>
              <span style={{display:"flex", justifyContent: "space-between", alignItems: "center"}}>
                <span>Static Inputs{staticAICount > 0 ? ` (${staticAICount} AI)` : ""}</span>
                <IconButton disableRipple size="small" sx={{marginTop: -3, marginBottom: -3}}>{openStatic ? <ExpandLess /> : <ExpandMore />}</IconButton>
              </span>
              </p>
          </div>
          {renderStaticCategories()}
        </div>
      ) 
    }else if (isOutputSection) {
      return (
        <>
        <div style={category==="Results Tables" ? styles.selected : styles.unselected} onClick={() => setOpenResultsTables(!openResultsTables)}> 
            
          <p style={styles.topLevelCategory}>
            <span style={{display:"flex", justifyContent: "space-between"}}>
              Results Tables
              <IconButton disableRipple edge={"end"} size="small" sx={{marginTop: -3, marginBottom: -3}}>{openResultsTables ? <ExpandLess /> : <ExpandMore />}</IconButton>
            </span>
          </p>
        </div>
          {renderResultsTables()}
          </>
      ) 
    }
  }

  const renderCategoryItemLabel = (value: string) => {
    const label = CategoryNames[value]
      ? CategoryNames[value]
      : value
          .replace('_dict', '')
          .replace('v_F_', '')
          .replace('v_C_', 'Cost ')
          .replace('v_R_', 'Credit ')
          .replace('v_L_', 'Water Level ')
          .replace('v_S_', 'Slack ')
          .replace('v_D_', 'Disposal ')
          .replace('v_X_', 'Storage ')
          .replace('v_T_', 'Treatment ')
          .replace('vb_y_Flow', 'Directional Flow')
          .replace('vb_y_', 'New ');
    const stagedCount = aiChangedTables[value]?.changedCellCount;
    return (
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span>{label}</span>
        {stagedCount ? (
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              backgroundColor: '#01678f',
              color: '#ffffff',
              borderRadius: '999px',
              padding: '1px 6px',
              flexShrink: 0,
            }}
          >
            AI · {stagedCount}
          </span>
        ) : null}
      </span>
    );
  };

  const renderDynamicCategories = () => {
    return (
      <Collapse in={openDynamic} timeout="auto" unmountOnExit>
      {Subcategories.Dynamic.map( (value,index) => {
        return(
          <div style={getStyle(value)} onClick={() => handleClick(value)} key={`${value}${index}`}> 
          <Tooltip title={ParetoDictionary[value] ? ParetoDictionary[value] : CategoryNames[value] ? CategoryNames[value] : value} placement="right-start">
            <p style={styles.subcategory}>
              {renderCategoryItemLabel(value)}
              </p>
              </Tooltip>
          </div>
        )
      })}
      </Collapse>
    )
  }

  const renderStaticCategories = () => {
    return (
      <Collapse in={openStatic} timeout="auto" unmountOnExit>
      {Subcategories.Static.map( (value,index) => {
        return (
          <div style={getStyle(value)} onClick={() => handleClick(value)} key={`${value}${index}`}> 
          <Tooltip title={ParetoDictionary[value] ? ParetoDictionary[value] : CategoryNames[value] ? CategoryNames[value] : value} placement="right-start">
            <p style={styles.subcategory}>
              {renderCategoryItemLabel(value)}
              </p>
              </Tooltip>
          </div>
        )
      })}
      </Collapse>
    )
  }
  const renderResultsTables = () => {
    let hasResiduals = checkForResiduals()
    return (
      <Collapse in={openResultsTables} timeout="auto" unmountOnExit>
        {hasResiduals && (
          <div style={getStyle("Water Residuals")} onClick={() => handleClick("Water Residuals")} key={"Water Residuals"}> 
              <p style={styles.subcategory}>
                Water Residuals
              </p>
          </div>
        )}
        {Object.entries(results?.data || {}).map( ([key, value]) => ( 
          <div style={getStyle(key)} onClick={() => handleClick(key)} key={`${key}${value}`}> 
              <p style={styles.subcategory}>
                {CategoryNames[key] ? CategoryNames[key] :
                    key.replace('_dict','')
                        .replace('v_F_','')
                        .replace('v_C_','Cost ')
                        .replace('v_R_','Credit ')
                        .replace('v_L_','Water Level ')
                        .replace('v_S_','Slack ')
                        .replace('v_D_','Disposal ')
                        .replace('v_X_','Storage ')
                        .replace('v_T_','Treatment ')
                        .replace('vb_y_Flow','Directional Flow')
                        .replace('vb_y_','New ')}
              </p>
          </div>
        ))}
      </Collapse>
    )
  }

  const checkForResiduals = () => {
    if (optimization.deactivate_slacks === false) {
      return true
    } else return false
  }

  const toggleMapEditorExpanded = () => {
    setIsMapEditorExpanded((prev) => !prev);
  }

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <Drawer
        variant="permanent"
        sx={{
          width: activeDrawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {backgroundColor:"#F5F5F6",  width: activeDrawerWidth, boxSizing: 'border-box' },
        }}
        PaperProps={{
            sx: {
            width: activeDrawerWidth,
            marginTop: '158px',
            paddingBottom: '158px',
            zIndex: 2,
            overflow: 'visible',
            boxShadow: isMapEditorExpanded ? '8px 0 24px rgba(0, 0, 0, 0.22)' : 'none',
            transition: 'width 180ms ease',
            }
        }}
        open={true}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            right: -16,
            zIndex: 3,
            backgroundColor: '#ffffff',
            border: '1px solid #d9dde3',
            borderRadius: '999px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          }}
        >
          <Tooltip title={isMapEditorExpanded ? "Collapse Sidebar" : "Expand Sidebar"}>
            <IconButton size="small" onClick={toggleMapEditorExpanded}>
              {isMapEditorExpanded ? <KeyboardDoubleArrowLeftIcon /> : <KeyboardDoubleArrowRightIcon />}
            </IconButton>
          </Tooltip>
        </Box>
        <Box
          key="drawer_box"
          sx={{
            height: 'calc(100vh - 216px)',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
            {scenario && !showMapEditor &&
              renderAdditionalCategories()
            }
            {scenario && !showMapEditor &&
              renderTopLevelCategories()
            }
            {
              scenario && showMapEditor && (
                renderMapOptions()
              )
            }
            {
              scenario && hasMapData && (
                 (category === "Network Diagram" && isInputSection) &&
                <MapEditor 
                  isExpanded={isMapEditorExpanded}
                  PipelineDiameterValues={PipelineDiameterValues}
                  TreatmentCapacityIncrements={TreatmentCapacityIncrements}
                /> 
              )
            }
        </Box>
      </Drawer>
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
    </Box>
  );
}
