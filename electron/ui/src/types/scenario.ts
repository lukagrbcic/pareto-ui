import type {DfSets, DfParameters, DisplayUnits, ScenarioResultsData} from './tables';
import type {ScenarioAIDiagnosis} from './ai';
import type {MapData} from './map';
import type {ScenarioValidation, ConstraintViolationsSummary} from './validation';

export interface ScenarioDataInput {
  df_sets: DfSets;
  df_parameters: DfParameters;
  display_units?: DisplayUnits;
  map_data?: MapData | null;
  /** Workbook unit names retain spaces, e.g. "decision period". */
  units?: Record<string, string>;
  origin?: string;

  [k: string]: unknown;
}

export interface ScenarioOptimization {
  objective?: string; // e.g. "cost"
  runtime?: number | string;
  pipeline_cost?: string;
  /** Older bundled scenarios retain this spelling; no migration is performed here. */
  pipelineCostCalculation?: string;
  waterQuality?: string | boolean;
  hydraulics?: string | boolean;
  solver?: string;
  build_units?: string;
  optimalityGap?: number | string;
  scale_model?: boolean;

  [k: string]: unknown;
}

/** Known labels aid discovery, while other saved strings remain representable.
 * Runtime normalization and a closed status union belong to the API migration.
 */
export type ScenarioStatus = 'Draft' | 'Incomplete' | 'Not Optimized' | 'Initializing'
  | 'Preparing inputs' | 'Building model' | 'Solving model' | 'Generating output'
  | 'Solving Model' | 'Generating Output' | 'Optimized' | 'failure' | 'Infeasible'
  | 'complete' | 'none' | (string & {});

export interface ScenarioResults {
  status?: ScenarioStatus | null;
  run_id?: string | null;
  input_revision?: string | null;
  failure_stage?: string | null;
  error?: string | null;
  terminationCondition?: string | null;
  solution_status?: string | null;
  /** Drafts and legacy records may not have result tables yet. */
  data?: ScenarioResultsData;
  constraints_violations?: ConstraintViolationsSummary | null;

  [k: string]: unknown;
}

export interface OverrideEntry {
  /** Which underlying model variable/table this entry targets */
  variable: string;

  /** Convenience flag some payloads include */
  isZero?: boolean;
  indexes: string[];

  /** The actual override value (often 0/1 for binaries, but could be numeric) */
  value: number;

  number_value?: number;
}

/** Map from override-id (like "Pipeline Construction:PP04:N09:--") to entry */
export type OverrideTable = Record<string, OverrideEntry>;

export interface ScenarioOverrides {
  vb_y_overview_dict?: OverrideTable;
  v_F_Piped_dict?: OverrideTable;
  v_F_Sourced_dict?: OverrideTable;
  v_F_Trucked_dict?: OverrideTable;
  v_L_Storage_dict?: OverrideTable;
  v_L_PadStorage_dict?: OverrideTable;
  vb_y_Pipeline_dict?: OverrideTable;
  vb_y_Disposal_dict?: OverrideTable;
  vb_y_Storage_dict?: OverrideTable;
  vb_y_Treatment_dict?: OverrideTable;
}

export interface Scenario {
  name: string;
  id: number;

  /** e.g. "01/13/2026" */
  date?: string;

  data_input: ScenarioDataInput;
  optimization: ScenarioOptimization;
  results: ScenarioResults;
  validation?: ScenarioValidation;

  override_values?: ScenarioOverrides;
  optimized_override_values?: ScenarioOverrides;
  input_revision?: string;
  aiDiagnosis?: ScenarioAIDiagnosis;
  previousAIDiagnosis?: ScenarioAIDiagnosis;
  inputDiagramExtension?: string;
  outputDiagramExtension?: string;

  [k: string]: unknown;
}

export type ScenarioMap = Record<string, Scenario>;

/** The backend stores numeric IDs; route and selection values may still be text. */
export type ScenarioId = number | string;

export type ScenarioPropagation = 'map' | 'json';

/** A launch keeps this snapshot and identity until acknowledged or explicitly rejected. */
export interface OptimizationStart {
  phase: 'copying' | 'submitting' | 'uncertain' | 'rejected';
  error?: string;
  snapshot: Scenario;
  runId: string;
}

export interface ScenarioUndoSnapshot {
  name: string;
  data_input: ScenarioDataInput;
  optimization: ScenarioOptimization;
  override_values?: ScenarioOverrides;
  status?: ScenarioStatus | null;
  input_revision?: string;
}

export interface ScenarioUndoEntry {
  id: string;
  label: string;
  source: 'user' | 'ai';
  timestamp: string;
  snapshot: ScenarioUndoSnapshot;
}
