import type React from 'react';
import type {Scenario, ScenarioOverrides, ScenarioMap, ScenarioId} from './scenario';
import type {MapData} from './map';
import type {ParameterTable} from './tables';
import type {ValidationIssue} from './validation';

export interface AppContextValue {
  port: number;
}

export interface AppState {
  section: number;
  category: Record<number, string | null>;
}

export type AppAction = {action: 'select' | 'new' | 'delete'}
  | {action: 'section'; section: number}
  | {action: 'category'; category: string};

export interface ModelResultsProps {
  category: string;
  scenario: Scenario;
  handleSetSection: (section: number) => void;
  handleEditInput?: (edited: boolean) => void;
  updateScenario: (updatedScenario: Scenario) => void;
  appState?: AppState;
  syncScenarioData?: (id?: string | number) => void;
  scenarios?: ScenarioMap;
  handleSetCategory?: (category: string) => void;
}

export interface SankeyPlotProps {
  data: Record<string, any[]>;
  scenarioId: string | number;
  appState?: AppState;
}

export interface KPIDashboardProps {
  overviewData: any[];
  truckedData: any[];
  pipedData: any[];
  waterQualityData: any[];
  hydraulicsData?: any[];
}

export interface OptimizationProps {
  saving?: boolean;
  scenario: Scenario;
  updateScenario: (updatedScenario: Scenario, setScenarioData?: boolean, propagateChanges?: string) => void;
  disabled: boolean;
  handleRunModel: () => void;
  backgroundTasks: ScenarioId[];
  category?: string;
}

export interface NetworkDiagramProps {
  scenario: Scenario;
  type?: import('./api').DiagramType;
  syncScenarioData?: (id?: string | number) => void;
  showMapTypeToggle?: boolean;
  interactive?: boolean;
  width?: number | string;
  height?: number | string;
  [key: string]: any;
}

export interface DataTableProps {
  section: 'input' | 'output' | 'compare';
  scenario: Scenario;
  data: Record<string, any>;
  category: string;
  updateScenario?: (updatedScenario: Scenario) => void;
  setScenario?: (scenario: Scenario) => void;
  OVERRIDE_CATEGORIES?: string[];
  overrideValues?: any;
  setOverrideValues?: (v: any) => void;
  newInfrastructureOverrideRow?: boolean;
  setNewInfrastructureOverrideRow?: (b: boolean) => void;
  rowFilterSet?: Record<string, {checked: boolean; amt: number}>;
  columnFilterSet?: Record<string, {checked: boolean; amt: number}>;
  columnNodes: Record<string, boolean>;
  columnNodesMapping: string[];
  rowNodes: Record<string, boolean>;
  rowNodesMapping: string[];
  editDict?: Record<string, boolean>;
  setEditDict?: (d: Record<string, boolean>) => void;
  handleEditInput?: (edited: boolean) => void;
  setShowError?: (b: boolean) => void;
  deltaDictionary?: any;
  disabled?: boolean;
  onRevertStagedCell?: (rowIdx: number, colIdx: number) => void;

  [key: string]: any;
}

export interface DataInputProps {
  scenario: Scenario;
  updateScenario: (updatedScenario: Scenario) => void;
  category: string;
  handleSetCategory: (category: string) => void;
  syncScenarioData: (id?: string | number) => void;
  handleUpdateExcel: (id: string | number, tableKey: string, updatedTable: ParameterTable) => void | Promise<boolean>;
  handleEditInput: (edited: boolean) => void;
  edited: boolean;
  aiDiff?: import('../utils/aiStaging').ScenarioAIDiff;
  isApplyingAI?: boolean;
  isAIRunning?: boolean;
  onApplyAIStaged?: () => Promise<void>;
  onDiscardAIStaged?: () => void;
  onUpdateStagedTable?: (tableKey: string, updatedTable: ParameterTable) => void;
  onDiscardManualEdits?: () => void;
  onRevertStagedCell?: (tableKey: string, rowIdx: number, colIdx: number) => void;
}

export interface FilterDropdownProps {
  option1: string;
  option2: string;
  width?: string | number;
  maxHeight?: string | number;
  handleFilter1?: (value: string) => void;
  handleFilter2?: (value: string) => void;
  filtered1?: string[];
  filtered2?: string[];
  total1?: string[];
  total2?: string[];
  isAllSelected1?: boolean;
  isAllSelected2?: boolean;
  handleArrowSelection?: (direction: 'up' | 'down') => void;
  columnFilterSet?: Record<string, {checked: boolean; amt: number}>;
  rowFilterSet?: Record<string, {checked: boolean; amt: number}>;
}

export interface WaterQualityFilterDropdownProps {
  width?: string | number;
  maxHeight?: string | number;
  isAllSelected?: boolean;
  filtered?: any[] | Record<string, boolean>;
  total?: any[];
  handleFilter?: (value: string) => void;
  filterSet?: string[];
}

export interface OverrideTableProps {
  category: string;
  data: Record<string, any[]>;
  columnNodes: Record<string, boolean>;
  columnNodesMapping: string[];
  scenario: Scenario;
  show: boolean;
  updateScenario?: (updatedScenario: Scenario, setScenarioData?: boolean) => void;
  newInfrastructureOverrideRow?: boolean;
  setNewInfrastructureOverrideRow?: (b: boolean) => void;
  rowFilterSet?: Record<string, {checked: boolean; amt: number}>;
  columnFilterSet?: Record<string, {checked: boolean; amt: number}>;
  overrideValues?: any;
  setOverrideValues?: (v: any) => void;
}

export interface OverrideTableRowsProps {
  category: string;
  data: any[];
  columnNodes: Record<string, boolean>;
  columnNodesMapping: string[];
  scenario: Scenario;
  handleCheckOverride: (index: string, value: any) => void;
  handleInputOverrideValue: (event: any, number_value?: any) => void;
  newInfrastructureOverrideRow?: boolean;
  setNewInfrastructureOverrideRow?: (b: boolean) => void;
  addNewRow?: (newOverride: any, newRow: any) => void;
}

export interface NewOverrideRowProps {
  category: string;
  scenario: Scenario;
  handleCheckOverride: (index: string, value: any) => void;
  handleInputOverrideValue: (event: any, number_value?: any) => void;
  setNewInfrastructureOverrideRow: (b: boolean) => void;
  addNewRow: (newOverride: any, newRow: any) => void;
}

export interface ComparisonTableProps {
  scenarios: Record<string, Scenario> | Array<Scenario> | any;
  scenarioIndex: number | string;
  secondaryScenarioIndex: number | string;
}

export interface CustomChartProps {
  input?: boolean;
  data: any;
  category?: string;
  labelIndex?: number;
  xindex?: number;
  yindex?: number;
  width?: number;
  height?: number;
  showlegend?: boolean;
  title?: string;
  xaxis?: { titletext?: string };
  yaxis?: { titletext?: string };
  stackgroup?: boolean | string;
  waterQuality?: boolean;
  filterSet?: string[];
  chartType?: string;
}

export interface SubHeaderProps {
  scenarios: Record<string, Scenario>;
  compareScenarioIndexes: Array<string | number>;
  setCompareScenarioIndexes: (indexes: Array<string | number>) => void;
}

export interface SidebarProps {
  inputFocus?: ValidationIssue | null;
  handleSetCategory?: (category: string) => void;
  scenario?: Scenario;
  section?: number;
  category?: string | null;
  inputDataEdited?: boolean;
  handleUpdateExcel?: (id: string | number, tableKey: string, updatedTable: ParameterTable) => void | Promise<boolean>;
  setInputDataEdited?: (b: boolean) => void;
  syncScenarioData?: (id?: string | number) => void;
  onDiscardManualEdits?: () => void;
  [key: string]: any;
}

export interface PopupModalProps {
  open: boolean;
  handleClose: () => void;
  input?: boolean;
  text?: string | number;
  textLabel?: string;
  handleEditText?: (e: any) => void;
  handleSave?: () => void;
  buttonVariant?: any;
  buttonColor?: any;
  buttonText?: string;
  hasInput?: boolean;
  inputText?: string;
  showError?: boolean;
  errorText?: string;
  hasTwoButtons?: boolean;
  handleButtonTwoClick?: () => void;
  buttonTwoVariant?: any;
  buttonTwoColor?: any;
  buttonTwoText?: string;
  iconOne?: React.ReactNode;
  iconTwo?: React.ReactNode;
  width?: number;
  [key: string]: any;
}

export interface FileUploadModalProps {
  setShowFileModal: (show: boolean) => void;
  handleFileUpload: (file: File, defaultNodeType?: string, scenarioName?: string) => void | Promise<void>;
  fileTypes?: string[];
  showNameInput?: boolean;
  showSampleFiles?: boolean;
  title?: string;
  buttonText?: string;
  [key: string]: any;
}

export interface ScenarioCompareInputProps {
  primaryScenario: Scenario;
  referenceScenario: Scenario;
  category: string;
  showSidebar: boolean;
  deltaDictionary: Record<string, string[]>;
}

export interface ScenarioCompareOverridesProps {
  primaryScenario: Scenario;
  referenceScenario: Scenario;
  category: string;
  showSidebar: boolean;
  overrides: Array<Record<string, any>>;
  deltaDictionary?: Record<string, string[]>;
}

export interface ScenarioCompareOutputProps {
  scenarios: Record<string, Scenario>;
  primaryScenarioIndex: string | number | null;
  referenceScenarioIndex: string | number | null;
  kpiDataPrimary?: Record<string, any> | null;
  kpiDataReference?: Record<string, any> | null;
  capexBarChartData?: any[] | null;
  opexBarChartData?: any[] | null;
  showSidebar?: boolean;
  compareCategory?: string;
  totalCapex?: number[];
  totalOpex?: number[];
}

export interface NetworkMapProps {
  map_data: MapData;
  interactive?: boolean;
  showMapTypeToggle?: boolean;
  width?: number | string;
  height?: number | string;
  [key: string]: any;
}

export interface InputSummaryProps {
  scenario: Scenario;
  initialDisposalCapacity: ParameterTable;
  initialTreatmentCapacity: ParameterTable;
  completionsDemand: ParameterTable;
  padRates: ParameterTable;
  flowbackRates: ParameterTable;
  updateScenario: (updatedScenario: Scenario) => void;
  handleSetCategory: (category: string) => void;
  uploadDisabled?: boolean;
  [key: string]: any;
}

export interface ScenarioCompareSidebarProps {
  category: string;
  setCategory: (category: string) => void;
  open: boolean;
  deltaDictionary: Record<string, Record<string, any>>;
  overrides: Array<Record<string, any>>;
  compareScenarioIndexes?: Array<string | number>;
  [key: string]: any;
}
