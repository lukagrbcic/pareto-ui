import React, { useEffect, useState } from 'react';
import type { DataTableProps, ParameterTable, Scenario } from '../../types';
import {
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  TextField,
  Tooltip,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import OverrideTable from '../OverrideTable/OverrideTable';
import { CategoryNames, ParetoDictionary } from '../../util';
import PopupModal from '../../components/PopupModal/PopupModal';
import { default_override_values } from '../../util';
import { formatDiffCell, getTableDimensionCount } from '../../utils/aiStaging';

export default function DataTable(props: DataTableProps): JSX.Element {
  const {
    // commonly used
    category,
    data,
    scenario,
    section,

    // scenario setters / updaters
    updateScenario,
    setScenario,

    // override-related
    OVERRIDE_CATEGORIES,
    overrideValues,
    setOverrideValues,
    newInfrastructureOverrideRow,
    setNewInfrastructureOverrideRow,

    // editing / error
    editDict,
    setEditDict,
    handleEditInput,
    setShowError,

    // row/col filtering
    rowNodes,
    rowNodesMapping,
    columnNodes,
    columnNodesMapping,
    rowFilterSet,
    columnFilterSet,

    // just for compare page
    deltaDictionary
  } = props;

  const [showOverrideTables, setShowOverrideTables] = useState<boolean>(false);
  const [rowValue, setRowValue] = useState<number | string>(0);
  const [doubleClickIndex, setDoubleClickIndex] = useState<number | null>(null);
  const [showRowValueInput, setShowRowValueInput] = useState<boolean>(false);
  useEffect(() => {
    document.querySelector('[data-validation-focus="true"]')?.scrollIntoView?.({block: 'nearest', inline: 'center'});
  }, [props.validationFocus, category]);

  useEffect(() => {
    if (scenario.override_values === undefined && OVERRIDE_CATEGORIES) {
      const tempOverrideValues = default_override_values;

      for (let each of OVERRIDE_CATEGORIES || []) {
        if (!Object.keys(tempOverrideValues).includes(each)) tempOverrideValues[each] = {};
      }

      const tempScenario = { ...scenario };
      tempScenario.override_values = tempOverrideValues;

      updateScenario && updateScenario(tempScenario);
    }

    setShowOverrideTables(true);
  }, [data]);

  const keyIndexMapping: Record<number, string> = {};

  const styles: any = {
    firstCol: {
      backgroundColor: '#f4f4f4',
      border: '1px solid #ddd',
      position: 'sticky',
      left: 0,
    },
    other: {
      minWidth: 100,
      border: '1px solid #ddd',
    },
    inputDifference: {
      backgroundColor: 'rgb(255,215,0, 0.5)',
      minWidth: 100,
      border: '1px solid #ddd',
    },
  };

  const roundKPI = (value: any) => {
    if (isNaN(value)) return value;
    else if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    else if (value >= 100) return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
    else if (value >= 10) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    else return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  };

  const handleChangeValue = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const nameAttr =
      (event.target as HTMLInputElement).name ||
      (event.target as HTMLElement).getAttribute('data-name') ||
      '';

    const inds = nameAttr.split(':');
    const ind = parseInt(inds[0]); // row index
    const colName = keyIndexMapping[parseInt(inds[1])].split('::')[1];

    const currentTable = scenario.data_input.df_parameters[category] as ParameterTable;
    const targetTable: ParameterTable = props.onStagedTableEdit
      ? {
          ...currentTable,
          [colName]: Array.isArray(currentTable[colName]) ? [...currentTable[colName]] : [],
        }
      : currentTable;
    const tempScenario: Scenario = props.onStagedTableEdit
      ? {
          ...scenario,
          data_input: {
            ...scenario.data_input,
            df_parameters: {
              ...scenario.data_input.df_parameters,
              [category]: targetTable,
            },
          },
        }
      : { ...scenario };
    const val = (event.target as HTMLInputElement).value;

    if (isNaN(Number(val))) {
      targetTable[colName][ind] = val;
    } else if (val === '') {
      targetTable[colName][ind] = val;
    } else {
      targetTable[colName][ind] = Number(val);
    }

    setScenario && setScenario(tempScenario);
    if (props.onStagedTableEdit) {
      props.onStagedTableEdit(targetTable);
    } else {
      handleEditInput && handleEditInput(true);
    }
  };

  const handleDoubleClick = (ind: number, index: number) => {
    /*
      ind: row number, starting at 0, excluding header row
      index: column number, starting at 0
    */
    if (props.disabled) return;
    if (['Optimized', 'Draft', 'failure', 'Not Optimized', 'Incomplete', 'Infeasible'].includes(scenario.results.status)) {
      if (index === 0) {
        setShowRowValueInput(true);
        setDoubleClickIndex(ind);
      } else {
        if (editDict && setEditDict) {
          if (!editDict[`${ind}:${index}`]) {
            const tempEditDict = { ...editDict };
            tempEditDict[`${ind}:${index}`] = true;
            setEditDict(tempEditDict);
            if (!props.onStagedTableEdit) {
              handleEditInput && handleEditInput(true);
            }
          }
        } else {
          setShowError && setShowError(true);
        }
      }
    } else {
      setShowError && setShowError(true);
    }
  };

  const handleEditRowValue = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowValue(event.target.value);
  };

  const handleUpdateRowValues = () => {
    const currentTable = scenario.data_input.df_parameters[category] as ParameterTable;
    const targetTable: ParameterTable = props.onStagedTableEdit
      ? (Object.fromEntries(
          Object.entries(currentTable).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
        ) as ParameterTable)
      : currentTable;
    const tempScenario: Scenario = props.onStagedTableEdit
      ? {
          ...scenario,
          data_input: {
            ...scenario.data_input,
            df_parameters: {
              ...scenario.data_input.df_parameters,
              [category]: targetTable,
            },
          },
        }
      : { ...scenario };

    Object.entries(targetTable).map(([key, value], i) => {
      if (i > 0) {
        if (rowValue === '' || isNaN(Number(rowValue))) value[doubleClickIndex!] = rowValue;
        else value[doubleClickIndex!] = Number(rowValue);
      }
    });

    if (!props.onStagedTableEdit) {
      handleEditInput && handleEditInput(true);
    }
    setScenario && setScenario(tempScenario);
    if (props.onStagedTableEdit) {
      props.onStagedTableEdit(targetTable);
    }

    setShowRowValueInput(false);
    setRowValue(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const targetName = (e.target as any).name;

      if (targetName && editDict?.[targetName]) {
        const tempEditDict = { ...editDict };
        tempEditDict[targetName] = false;
        setEditDict && setEditDict(tempEditDict);
      }
    }
  };

  const renderInputRow = (ind: number) => {
    const tableObj = data[category] || {};
    const dimCount = getTableDimensionCount(Object.keys(tableObj));
    const cells: any[] = [];

    Object.entries(tableObj).forEach(([key, value]) => {
      cells.push(value[ind]);
      return 1;
    });

    return cells.map((value, index) => {
      /*
        columnNodes[columnNodesMapping[index]] must be true
        UNLESS it's the first column (index is 0)
      */
      if (index === 0 || columnNodes[columnNodesMapping[index - 1]] || Object.keys(columnNodes).length === 0) {
        if (section === 'input') {
          const aiCellChange = props.aiTableDiff?.changedCells?.[`${ind}:${index}`];
          const canDoubleClickEdit = !props.disabled && index > 0;
          const tooltipTitle = editDict?.[`${ind}:${index}`]
            ? 'Hit enter to lock value in'
            : aiCellChange
              ? `Saved: ${formatDiffCell(aiCellChange.before)} → AI staged: ${formatDiffCell(aiCellChange.after)}${canDoubleClickEdit ? ' (doubleclick to edit)' : ''}`
              : canDoubleClickEdit
                ? 'Doubleclick to edit value'
                : '';
          return (
            <Tooltip
              key={'tooltip_' + ind + ':' + index}
              title={tooltipTitle}
              arrow
            >
              <TableCell
                data-ai-staged={aiCellChange ? 'true' : undefined}
                data-validation-focus={props.validationFocus?.table === category && props.validationFocus?.row?.length > 0 &&
                  props.validationFocus.row.every((name: string, position: number) => data[category][Object.keys(data[category])[position]]?.[ind] === name) &&
                  (!props.validationFocus.period || Object.keys(data[category])[index] === props.validationFocus.period) ? 'true' : undefined}
                sx={{
                  '&[data-ai-staged="true"]': {
                    outline: '1.5px solid rgba(1, 103, 143, 0.6)',
                    outlineOffset: '-2px',
                    backgroundColor: 'rgba(1, 103, 143, 0.14) !important',
                    fontWeight: 600,
                  },
                  '&[data-validation-focus="true"]': {
                    outline: '2px solid #ed9c28',
                    outlineOffset: '-2px',
                    backgroundColor: '#fff8e8 !important',
                  },
                }}
                onKeyDown={handleKeyDown}
                onDoubleClick={() => handleDoubleClick(ind, index)}
                key={`${ind}:${index}`}
                data-name={`${ind}:${index}`}
                style={index === 0 ? styles.firstCol : styles.other}
              >
                {editDict?.[`${ind}:${index}`] ? (
                  index === 0 ? (
                    value
                  ) : (
                    <TextField
                      autoFocus
                      name={`${ind}:${index}`}
                      size="small"
                      label={''}
                      defaultValue={value}
                      onChange={handleChangeValue}
                      onFocus={(event) => event.target.select()}
                    />
                  )
                ) : (
                  <>
                    {value === null || value === undefined
                      ? ''
                      : category === 'PadRates' || category === 'FlowbackRates'
                        ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
                        : value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    {aiCellChange && index >= dimCount && props.onRevertStagedCell && (
                      <IconButton
                        size="small"
                        disabled={Boolean(props.disabled)}
                        aria-label={`Revert cell ${ind}:${index} to ${formatDiffCell(aiCellChange.before)}`}
                        onClick={event => {
                          event.stopPropagation();
                          props.onRevertStagedCell?.(ind, index);
                        }}
                        onDoubleClick={event => event.stopPropagation()}
                        sx={{
                          p: 0.2,
                          ml: 0.5,
                          verticalAlign: 'middle',
                          color: '#015272',
                          opacity: 0.72,
                          '&:hover': { opacity: 1, backgroundColor: 'rgba(1, 103, 143, 0.14)' },
                        }}
                      >
                        <UndoIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    )}
                  </>
                )}
              </TableCell>
            </Tooltip>
          );
        } else if (section === 'compare') {
          return (
            <TableCell
              onKeyDown={handleKeyDown}
              key={`${ind}:${index}`}
              data-name={`${ind}:${index}`}
              style={
                index === 0
                  ? styles.firstCol
                  : deltaDictionary[category].includes(`${index}::${ind}`)
                    ? styles.inputDifference
                    : styles.other
              }
            >
              {value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </TableCell>
          );
        }
      } else return null;
    });
  };

  const renderInputRows = () => {
    const rows: any[] = [];
    const tableObj = data?.[category] || {};
    const firstCol = Object.keys(tableObj)[0];
    const len = firstCol ? (tableObj[firstCol]?.length ?? 0) : 0;

    for (let i = 0; i < len; i++) {
      rows.push(renderInputRow(i));
    }

    return rows.map((value, index) => {
      /*
        rowNodes[rowNodesMapping[index]] must equal true
      */
      if (rowNodes[rowNodesMapping[index]] || !Object.keys(rowNodes)?.length) {
        return <TableRow key={'row_' + index}>{value}</TableRow>;
      } else return null;
    });
  };

  const renderInputTable = () => {
    try {
      return (
        <TableContainer>
          <h3>
            {CategoryNames[category]
              ? CategoryNames[category]
              : ParetoDictionary[category]
                ? ParetoDictionary[category]
                : category}
            {scenario.data_input.display_units &&
              scenario.data_input.display_units[category] &&
              ` (${scenario.data_input.display_units[category]})`}
          </h3>

          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table style={{ border: '1px solid #ddd' }} size="small">
              <TableHead style={{ backgroundColor: '#6094bc', color: 'white' }}>
                <TableRow key="headRow">
                  {Object.entries(data?.[category] || {}).map(([key, value], index) => {
                    keyIndexMapping[index] = `${index}::${key}`;
                    if (index === 0 || columnNodes[`${index}::${key}`] || Object.keys(columnNodes).length === 0) {
                      return index === 0 ? (
                        <TableCell
                          key={key}
                          style={{ color: 'white', position: 'sticky', left: 0, backgroundColor: '#6094bc' }}
                        >
                          {key}
                        </TableCell>
                      ) : (
                        <TableCell key={key} style={{ color: 'white' }}>
                          {key}
                        </TableCell>
                      );
                    } else return null;
                  })}
                </TableRow>
              </TableHead>

              <TableBody>{renderInputRows()}</TableBody>
            </Table>
          </TableContainer>
        </TableContainer>
      );
    } catch (e) {
      console.error('unable to render input category: ', e);
    }
  };

  const renderOutputTable = () => {
    try {
      return (
        <TableContainer>
          <h3>
            {ParetoDictionary[category]
              ? ParetoDictionary[category]
              : CategoryNames[category]
                ? CategoryNames[category]
                : category}
          </h3>

          {OVERRIDE_CATEGORIES.includes(category) ? (
            <OverrideTable
              category={category}
              overrideValues={overrideValues}
              setOverrideValues={setOverrideValues}
              data={data}
              columnNodes={columnNodes}
              columnNodesMapping={columnNodesMapping}
              scenario={scenario}
              show={showOverrideTables}
              updateScenario={updateScenario}
              newInfrastructureOverrideRow={newInfrastructureOverrideRow}
              setNewInfrastructureOverrideRow={setNewInfrastructureOverrideRow}
              rowFilterSet={rowFilterSet}
              columnFilterSet={columnFilterSet}
            />
          ) : (
            <TableContainer sx={{ overflowX: 'auto', maxHeight: '73vh' }}>
              <Table style={{ border: '1px solid #ddd' }} size="small" stickyHeader>
                <TableHead style={{ backgroundColor: '#6094bc', color: 'white' }}>
                  <TableRow key={`headrow`}>
                    {category === 'v_F_Overview_dict' ? (
                      <>
                        <TableCell key="overview0" style={{ backgroundColor: '#6094bc', color: 'white' }}>
                          KPI
                        </TableCell>
                        <TableCell key="overview1" style={{ backgroundColor: '#6094bc', color: 'white' }}>
                          Units
                        </TableCell>
                        <TableCell key="overview2" style={{ backgroundColor: '#6094bc', color: 'white' }}>
                          Value
                        </TableCell>
                      </>
                    ) : (
                      data[category][0].map((value: any, index: number) => {
                        if (Object.keys(columnNodes).length === 0 || columnNodes[columnNodesMapping[index]]) {
                          return (
                            <TableCell
                              key={`${value}_${index}`}
                              style={{ backgroundColor: '#6094bc', color: 'white' }}
                            >
                              {value}
                            </TableCell>
                          );
                        }
                        return null;
                      })
                    )}
                  </TableRow>
                </TableHead>

                {category === 'v_F_Overview_dict' ? (
                  <TableBody>
                    {data[category].slice(1).map((value: any[], index: number) => {
                      return (
                        <TableRow key={`row_${value}_${index}`}>
                          {value.map((cellValue: any, i: number) => {
                            return (
                              i !== 1 && (
                                <TableCell
                                  align={i === value.length - 1 ? 'right' : 'left'}
                                  key={'' + index + i}
                                  style={i === 0 ? styles.firstCol : styles.other}
                                >
                                  {i === value.length - 1
                                    ? roundKPI(cellValue)
                                    : cellValue
                                      ? CategoryNames[cellValue]
                                        ? CategoryNames[cellValue]
                                        : cellValue
                                            .replace('v_F_', '')
                                            .replace('e_', '')
                                            .replace('v_Z_', '')
                                            .replace('v_R_', '')
                                            .replace('v_C_', 'Cost ')
                                            .replace(/([A-Z])/g, ' $1')
                                            .replace('Cap Ex', 'CapEx')
                                            .trim()
                                      : null}
                                </TableCell>
                              )
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                ) : (
                  <TableBody>
                    {data[category].slice(1).map((value: any[], index: number) => {
                      if (Object.keys(rowNodes).length === 0 || rowNodes[rowNodesMapping[index]]) {
                        return (
                          <TableRow key={`row_${value}_${index}`}>
                            {value.map((cellValue: any, i: number) => {
                              if (Object.keys(columnNodes).length === 0 || columnNodes[columnNodesMapping[i]]) {
                                return (
                                  <TableCell
                                    align={i === value.length - 1 ? 'right' : 'left'}
                                    key={'' + index + i}
                                    style={i === 0 ? styles.firstCol : styles.other}
                                  >
                                    {cellValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                  </TableCell>
                                );
                              }
                              return null;
                            })}
                          </TableRow>
                        );
                      }
                      return null;
                    })}
                  </TableBody>
                )}
              </Table>
            </TableContainer>
          )}
        </TableContainer>
      );
    } catch (e) {
      console.error('unable to render input category: ', e);
    }
  };

  const renderInputDeltaTable = () => {
    try {
      return (
        <TableContainer>
          <h3>
            {CategoryNames[category]
              ? CategoryNames[category]
              : ParetoDictionary[category]
                ? ParetoDictionary[category]
                : category}
            {scenario.data_input.display_units &&
              scenario.data_input.display_units[category] &&
              ` (${scenario.data_input.display_units[category]})`}
          </h3>

          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table style={{ border: '1px solid #ddd' }} size="small">
              <TableHead style={{ backgroundColor: '#6094bc', color: 'white' }}>
                <TableRow key="headRow">
                  {Object.entries(data?.[category] || {}).map(([key, value], index) => {
                    keyIndexMapping[index] = `${index}::${key}`;
                    if (index === 0 || columnNodes[`${index}::${key}`] || Object.keys(columnNodes).length === 0) {
                      return index === 0 ? (
                        <TableCell
                          key={key}
                          style={{ color: 'white', position: 'sticky', left: 0, backgroundColor: '#6094bc' }}
                        >
                          {key}
                        </TableCell>
                      ) : (
                        <TableCell key={key} style={{ color: 'white' }}>
                          {key}
                        </TableCell>
                      );
                    } else return null;
                  })}
                </TableRow>
              </TableHead>

              <TableBody>{renderInputRows()}</TableBody>
            </Table>
          </TableContainer>
        </TableContainer>
      );
    } catch (e) {
      console.error('unable to render input category: ', e);
    }
  };

  return (
    <>
      {section === 'input' && renderInputTable()}
      {section === 'output' && renderOutputTable()}
      {section === 'compare' && renderInputDeltaTable()}

      <PopupModal
        input
        open={showRowValueInput}
        handleClose={() => setShowRowValueInput(false)}
        text={rowValue}
        textLabel="Update all values in this row"
        handleEditText={handleEditRowValue}
        handleSave={handleUpdateRowValues}
        buttonText="Update"
        buttonColor="primary"
        buttonVariant="contained"
        width={400}
      />
    </>
  );
}
