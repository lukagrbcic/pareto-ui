import type {DfSets, DfParameters, DisplayUnits} from './tables';
import type {MapData} from './map';

export interface AIPromptUpdatedScenario {
  df_sets?: DfSets;
  df_parameters?: DfParameters;
  display_units?: DisplayUnits;
  units?: DisplayUnits;
  map_data?: MapData | null;
  origin?: string;
}

export interface AIPromptResponse {
  status: "success" | "error";
  updatedScenario?: AIPromptUpdatedScenario;
  updateNotes?: string[];
  questions?: string[];  // Follow-up questions when the assistant needs information instead of inventing values.
  errorMessage?: string;
  error?: string;
}

export interface AIOptimizationDiagnosisStep {
  title: string;
  instruction: string;
  reason?: string | null;
  appArea?: string | null;
}

export interface AIOptimizationDiagnosisResponse {
  status: "success" | "error";
  summary?: string;
  likelyCauses?: string[];
  nextSteps?: AIOptimizationDiagnosisStep[];
  cautionNotes?: string[];
  diagnosedAt?: string;
  errorMessage?: string;
  error?: string;
}

export interface ScenarioAIDiagnosis {
  status: "success";
  summary: string;
  likelyCauses: string[];
  nextSteps: AIOptimizationDiagnosisStep[];
  cautionNotes: string[];
  diagnosedAt: string;
  sourceErrorMessage?: string;
  outdated?: boolean;
  outdatedAt?: string;
  outdatedReason?: string;
}

export interface AIBackendSettings {
  available: boolean;
  source: 'user' | 'environment' | 'none';
  base_url: string;
  model: string;
  environment_available: boolean;
}

export interface AISettings extends AIBackendSettings {
  can_remember: boolean;
  remembered: boolean;
}

export interface AISettingsInput {
  api_key?: string;
  base_url: string;
  model: string;
  remember: boolean;
}
