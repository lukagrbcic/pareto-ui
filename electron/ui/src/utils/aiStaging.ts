import type {
  AIPromptUpdatedScenario,
  DfParameters,
  DfSets,
  ParameterTable,
  Scenario,
  ScenarioDataInput,
} from '../types';

export interface AICellChange {
  before: unknown;
  after: unknown;
}

export interface TableAIDiff {
  tableKey: string;
  changedCells: Record<string, AICellChange>;
  changedCellCount: number;
  changedRowCount: number;
  nonTabular: boolean;
}

export interface SetAIDiff {
  name: string;
  before: string[];
  after: string[];
}

export interface ScenarioAIDiff {
  changedTables: Record<string, TableAIDiff>;
  changedSets: SetAIDiff[];
  totalChangedTables: number;
  totalChangedCells: number;
  hasStagedChanges: boolean;
}

const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const INDEX_HEADER_NAMES = new Set([
  'productionpads',
  'completionspads',
  'networknodes',
  'swdsites',
  'storagesites',
  'treatmentsites',
  'externalwatersources',
  'reuseoptions',
  'pipelinediameters',
  'storagecapacities',
  'treatmentcapacities',
  'injectioncapacities',
  'treatmenttechnologies',
  'waterqualitycomponents',
  'airemissionscomponents',
  'timeperiods',
  'nodes',
  'pads',
  'index',
  'time',
  'quantity',
  'freshwatersources',
]);

export function isBlankCell(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

export function getTableDimensionCount(headers: string[]): number {
  if (headers.length <= 1) return headers.length;
  let count = 0;
  for (const header of headers) {
    const base = String(header).split('.')[0].toLowerCase();
    if (!INDEX_HEADER_NAMES.has(base)) break;
    count += 1;
  }
  return Math.min(Math.max(1, count), Math.max(1, headers.length - 1));
}

export function formatDiffCell(value: unknown): string {
  if (value === '' || value === null || value === undefined) return 'blank';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Merges a new AI turn's partial updatedScenario onto any existing staged
 * updates for the scenario, keeping previously staged tables/sets unless the
 * new turn updates them.
 */
export function mergeStagedScenario(
  current: AIPromptUpdatedScenario | null | undefined,
  incoming: AIPromptUpdatedScenario | null | undefined,
): AIPromptUpdatedScenario | null {
  if (!incoming) return current ? cloneValue(current) : null;
  const base: AIPromptUpdatedScenario = current ? cloneValue(current) : {};
  const nextPatch = cloneValue(incoming);

  const merged: AIPromptUpdatedScenario = { ...base, ...nextPatch };
  if (base.df_sets || nextPatch.df_sets) {
    merged.df_sets = {
      ...(base.df_sets || {}),
      ...(nextPatch.df_sets || {}),
    };
  }
  if (base.df_parameters || nextPatch.df_parameters) {
    merged.df_parameters = {
      ...(base.df_parameters || {}),
      ...(nextPatch.df_parameters || {}),
    };
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Overlays staged AI updates onto a scenario for live preview in DataInput,
 * DataTable, Plots, and InputSummary without mutating the saved baseline.
 */
export function buildPreviewScenario(
  scenario: Scenario | null | undefined,
  staged: AIPromptUpdatedScenario | null | undefined,
): Scenario | null {
  if (!scenario) return null;
  if (!staged) return scenario;
  const baseInput = cloneValue(scenario.data_input || ({} as ScenarioDataInput));
  const stagedCopy = cloneValue(staged);
  return {
    ...scenario,
    data_input: {
      ...baseInput,
      ...stagedCopy,
      df_sets: {
        ...(baseInput.df_sets || {}),
        ...(stagedCopy.df_sets || {}),
      },
      df_parameters: {
        ...(baseInput.df_parameters || {}),
        ...(stagedCopy.df_parameters || {}),
      },
    },
  };
}

/**
 * Computes exact cell-level and set-level differences between saved scenario
 * inputs and staged AI updates. Cell keys use `${rowIndex}:${colIndex}` to
 * align directly with DataTable rendering.
 */
export function computeAIDiff(
  savedInput: ScenarioDataInput | null | undefined,
  staged: AIPromptUpdatedScenario | null | undefined,
): ScenarioAIDiff {
  const empty: ScenarioAIDiff = {
    changedTables: {},
    changedSets: [],
    totalChangedTables: 0,
    totalChangedCells: 0,
    hasStagedChanges: false,
  };
  if (!savedInput || !staged) return empty;

  const savedParams: DfParameters = savedInput.df_parameters || {};
  const stagedParams: DfParameters = staged.df_parameters || {};
  const changedTables: Record<string, TableAIDiff> = {};
  let totalChangedCells = 0;

  for (const tableKey of Object.keys(stagedParams)) {
    const prevTable = savedParams[tableKey];
    const nextTable = stagedParams[tableKey];
    if (JSON.stringify(prevTable) === JSON.stringify(nextTable)) continue;

    if (
      !nextTable ||
      typeof nextTable !== 'object' ||
      Object.values(nextTable).some(v => v !== undefined && !Array.isArray(v)) ||
      (prevTable &&
        typeof prevTable === 'object' &&
        Object.values(prevTable).some(v => v !== undefined && !Array.isArray(v)))
    ) {
      changedTables[tableKey] = {
        tableKey,
        changedCells: {},
        changedCellCount: 1,
        changedRowCount: 1,
        nonTabular: true,
      };
      totalChangedCells += 1;
      continue;
    }

    const nextColumns = Object.keys(nextTable as ParameterTable);
    const prevObj = (prevTable as ParameterTable | undefined) || {};
    const allColumns = Array.from(new Set([...Object.keys(prevObj), ...nextColumns]));
    const maxRows = Math.max(
      ...allColumns.map(col =>
        Math.max((prevObj[col] || []).length, ((nextTable as ParameterTable)[col] || []).length),
      ),
      0,
    );

    const changedCells: Record<string, AICellChange> = {};
    let changedRowCount = 0;

    for (let rowIdx = 0; rowIdx < maxRows; rowIdx += 1) {
      let rowHasChange = false;
      allColumns.forEach(col => {
        const before = prevObj[col]?.[rowIdx];
        const colIdx = nextColumns.indexOf(col);
        const after = colIdx >= 0 ? (nextTable as ParameterTable)[col]?.[rowIdx] : undefined;
        if (isBlankCell(before) && isBlankCell(after)) return;
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          const cellKey = colIdx >= 0 ? `${rowIdx}:${colIdx}` : `${rowIdx}:dropped:${col}`;
          changedCells[cellKey] = { before, after };
          rowHasChange = true;
        }
      });
      if (rowHasChange) changedRowCount += 1;
    }

    const changedCellCount = Object.keys(changedCells).length;
    if (changedCellCount > 0) {
      changedTables[tableKey] = {
        tableKey,
        changedCells,
        changedCellCount,
        changedRowCount,
        nonTabular: false,
      };
      totalChangedCells += changedCellCount;
    }
  }

  const savedSets: DfSets = savedInput.df_sets || {};
  const stagedSets: DfSets | undefined = staged.df_sets;
  const changedSets: SetAIDiff[] = [];
  if (stagedSets) {
    for (const setName of Object.keys(stagedSets)) {
      const nextVal = stagedSets[setName];
      if (!Array.isArray(nextVal)) continue;
      const before = Array.isArray(savedSets[setName]) ? savedSets[setName] : [];
      if (JSON.stringify(before) !== JSON.stringify(nextVal)) {
        changedSets.push({ name: setName, before, after: nextVal });
      }
    }
  }

  const totalChangedTables = Object.keys(changedTables).length;
  return {
    changedTables,
    changedSets,
    totalChangedTables,
    totalChangedCells,
    hasStagedChanges: totalChangedTables > 0 || changedSets.length > 0,
  };
}

/**
 * Merges staged AI updates into the saved scenario to create the Scenario
 * payload sent to handleScenarioUpdate when the user clicks Apply.
 */
export function buildMergedSaveScenario(
  scenario: Scenario,
  staged: AIPromptUpdatedScenario,
): Scenario {
  return {
    ...scenario,
    data_input: {
      ...scenario.data_input,
      ...staged,
      df_sets: {
        ...(scenario.data_input?.df_sets || {}),
        ...(staged.df_sets || {}),
      },
      df_parameters: {
        ...(scenario.data_input?.df_parameters || {}),
        ...(staged.df_parameters || {}),
      },
    },
  };
}
