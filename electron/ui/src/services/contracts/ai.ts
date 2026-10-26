import type {
  AIBackendSettings,
  AISettings,
  AIPromptResponse,
  AIPromptUpdatedScenario,
  AIOptimizationDiagnosisResponse,
} from '../../types/ai';
import {
  array,
  boolean,
  DecodeError,
  Decoder,
  isRecord,
  literal,
  nullable,
  object,
  optional,
  record,
  string,
  unknown,
} from './decode';
import { decodeDiagnosis, decodeMap, decodeParameters } from './scenario';

const settingsShape = {
  available: boolean,
  source: literal('user', 'environment', 'none'),
  base_url: string,
  model: string,
  environment_available: boolean,
};

// Settings contain only public metadata. Never carry unknown fields (such as keys)
// into renderer state, even if a future backend/bridge accidentally includes them.
export const decodeAIBackendSettings: Decoder<AIBackendSettings> = (value, path) => {
  const settings = object(settingsShape)(value, path);
  return {
    available: settings.available,
    source: settings.source,
    base_url: settings.base_url,
    model: settings.model,
    environment_available: settings.environment_available,
  };
};

export const decodeAISettings: Decoder<AISettings> = (value, path) => {
  const settings = decodeAIBackendSettings(value, path);
  const desktop = object({ can_remember: boolean, remembered: boolean })(value, path);
  return { ...settings, can_remember: desktop.can_remember, remembered: desktop.remembered };
};

export const decodeAIAvailability: Decoder<{ available: boolean }> = (value, path) => {
  const { available } = object({ available: boolean })(value, path);
  return { available };
};

type SettingsResult =
  { ok: true; settings: AISettings } | { ok: false; error?: string; retryable?: boolean };
export const decodeSettingsResult: Decoder<SettingsResult> = (value, path) => {
  const result = object({ ok: boolean })(value, path);
  if (result.ok)
    return { ok: true, settings: decodeAISettings(result.settings, `${path}.settings`) };
  const failure = object({ error: optional(string), retryable: optional(boolean) })(value, path);
  return { ok: false, error: failure.error, retryable: failure.retryable };
};

const inputShape = {
  df_sets: optional(record(array(string))),
  df_parameters: optional(decodeParameters),
  display_units: optional(record(string)),
  units: optional(record(string)),
  map_data: optional(nullable(decodeMap)),
  origin: optional(string),
};
const updatedInputs: Decoder<AIPromptUpdatedScenario> = (value, path) => {
  // Older provider responses wrap their inputs in a scenario-shaped object.
  const nested = isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'data_input');
  const inputs = object(inputShape)(
    nested ? value.data_input : value,
    nested ? `${path}.data_input` : path,
  );
  const checked: AIPromptUpdatedScenario = {};
  for (const key of Object.keys(inputShape)) {
    if (Object.prototype.hasOwnProperty.call(inputs, key)) {
      Object.defineProperty(checked, key, {
        value: inputs[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  if (!Object.keys(checked).length) throw new DecodeError(path, 'scenario input fields');
  return checked;
};

const failure = (value: unknown, path: string): AIPromptResponse | null => {
  if (!isRecord(value)) throw new DecodeError(path, 'an AI response object');
  // Existing fill failures can omit status and return {error, detail} with HTTP 200.
  if (value.status !== 'error' && !(value.status === undefined && typeof value.error === 'string'))
    return null;
  const body = object({
    error: optional(string),
    errorMessage: optional(string),
    detail: optional(string),
    questions: optional(array(string)),
  })(value, path);
  const message = body.errorMessage || body.detail || body.error;
  if (!message?.trim()) throw new DecodeError(path, 'an AI error message');
  // questions survive error responses too: the structural guard can reject an
  // unusable scenario while still asking the user targeted follow-ups.
  return { status: 'error', errorMessage: message, questions: body.questions };
};

export const decodeAIPromptResponse: Decoder<AIPromptResponse> = (value, path) => {
  const error = failure(value, path);
  if (error) return error;
  const result = object({
    status: literal('success'),
    // updatedScenario is optional: a questions-only response (the assistant
    // asking instead of inventing values) is a valid success.
    updatedScenario: optional(unknown),
    updateNotes: optional(array(string)),
    updatedNotes: optional(array(string)),
    questions: optional(array(string)),
  })(value, path);
  // But a success must carry updates OR questions — neither is a malformed
  // response the UI cannot act on.
  if (result.updatedScenario === undefined && result.questions === undefined)
    throw new DecodeError(path, 'an AI response with updates or questions');
  return {
    status: 'success',
    updatedScenario: result.updatedScenario !== undefined
      ? updatedInputs(result.updatedScenario, `${path}.updatedScenario`)
      : undefined,
    updateNotes: result.updateNotes ?? result.updatedNotes,
    questions: result.questions,
  };
};

export const decodeAIOptimizationDiagnosis: Decoder<AIOptimizationDiagnosisResponse> = (
  value,
  path,
) => {
  const error = failure(value, path);
  if (error) return error;
  return decodeDiagnosis(value, path);
};
