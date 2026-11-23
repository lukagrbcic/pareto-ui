import type {ParameterTable} from './tables';
import type {Scenario, ScenarioId, ScenarioMap, ScenarioPropagation} from './scenario';

export type DiagramType = 'input' | 'output';

export interface ScenarioResponse {data: Scenario}
export interface ScenarioListResponse {data: ScenarioMap}
export interface TaskResponse {tasks: number[]}
export interface CopyScenarioResponse {scenarios: ScenarioMap; new_id: number}

export interface UpdateScenarioRequest {
  updatedScenario: Scenario;
  propagateChanges?: ScenarioPropagation;
}

export interface UpdateExcelRequest {
  id: ScenarioId;
  tableKey: string;
  updatedTable: ParameterTable;
  revision?: string;
}

export interface RunModelRequest {
  scenario: Scenario;
  run_id: string;
}

export interface FillScenarioInputsRequest {
  section: string;
  revision: string;
  value: number;
  apply: boolean;
}

export interface CompletionCellEdit {
  table: string;
  keys: string[];
  value: number;
}

export interface SaveCompletionCellsRequest {
  revision: string;
  edits: CompletionCellEdit[];
}
