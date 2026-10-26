import type {
    ScenarioResponse, ScenarioListResponse, TaskResponse, CopyScenarioResponse,
    UpdateScenarioRequest, UpdateExcelRequest, RunModelRequest, FillScenarioInputsRequest,
    Scenario, ScenarioId, ScenarioValidationResult, ScenarioFillPreview,
} from '../types';
import {ApiClientError, requestJson, requestWorkbook, scenarioId} from './apiClient';
import {object} from './contracts/decode';
import {decodeDiagram, decodeDiagramUpload} from './contracts/diagram';
import type {DiagramType} from '../types/api';
import {decodeSavedScenario, decodeScenarioList, scenarioFor} from './contracts/scenario';
import {copiedScenarioFor, deletedScenarioFor} from './contracts/collection';
import {decodeTasks, decodeValidationResult, fillPreviewFor, runFor} from './contracts/workflow';
import {decodeAIAvailability, decodeAIBackendSettings, decodeAIPromptResponse, decodeAIOptimizationDiagnosis} from './contracts/ai';
import type {AIBackendSettings, AIPromptResponse, AIOptimizationDiagnosisResponse} from '../types/ai';

let BACKEND_URL = "http://localhost"

export const updateScenario = async (backend_port: number, data: UpdateScenarioRequest): Promise<ScenarioResponse> => {
    const id = scenarioId(data.updatedScenario.id);
    return requestJson(BACKEND_URL+':'+backend_port+'/update', object({data: scenarioFor(id, true)}), {
        method: 'POST', 
        mode: 'cors',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
}; 

export const updateExcel = async (backend_port: number, data: UpdateExcelRequest): Promise<Scenario> => {
    const id = scenarioId(data.id);
    return requestJson(BACKEND_URL+':'+backend_port+'/update_excel', scenarioFor(id, true), {
        method: 'POST', 
        mode: 'cors',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...data, id})
    });
}; 

export const fetchScenarios = (backend_port: number): Promise<ScenarioListResponse> => {
    return requestJson(BACKEND_URL+':'+backend_port+'/get_scenario_list/', decodeScenarioList, {
        method: 'GET', 
        mode: 'cors'
    });
}; 

export const checkTasks = (backend_port: number): Promise<TaskResponse> => {
    return requestJson(BACKEND_URL+':'+backend_port+'/check_tasks/', decodeTasks, {
        method: 'GET', 
        mode: 'cors'
    });
}; 

const diagramType = (type: DiagramType): DiagramType => {
    if (type !== 'input' && type !== 'output') throw new ApiClientError('invalid_request', 'Choose an input or output diagram.');
    return type;
};

export const fetchDiagram = async (port: number, type: DiagramType, id: ScenarioId, signal?: AbortSignal): Promise<string | null> => {
    const endpoint = `${BACKEND_URL}:${port}/get_diagram/${diagramType(type)}/${scenarioId(id)}`;
    try {
        return (await requestJson(endpoint, decodeDiagram, {signal})).data;
    } catch (error) {
        // This legacy route reports normal diagram absence as HTTP 400.
        if (error instanceof ApiClientError && error.status === 400 && typeof error.detail === 'string' && error.detail.startsWith('no diagram found')) return null;
        throw error;
    }
};

export const uploadDiagram = async (port: number, data: FormData, type: DiagramType, id: ScenarioId): Promise<null> =>
    requestJson(`${BACKEND_URL}:${port}/upload_diagram/${diagramType(type)}/${scenarioId(id)}`, decodeDiagramUpload, {
        method: 'POST', mode: 'cors', body: data,
    });

export const deleteDiagram = async (port: number, type: DiagramType, id: ScenarioId): Promise<ScenarioResponse> => {
    const parsedId = scenarioId(id);
    return requestJson(`${BACKEND_URL}:${port}/delete_diagram/${diagramType(type)}/${parsedId}`, object({data: scenarioFor(parsedId)}), {method: 'GET', mode: 'cors'});
};

export const fetchExcelTemplate = async (port: number, id: ScenarioId, signal?: AbortSignal): Promise<Blob> =>
    requestWorkbook(`${BACKEND_URL}:${port}/get_template/${scenarioId(id)}`, {signal});

export const replaceExcelSheet = async (backend_port: number, data: FormData, id: ScenarioId): Promise<Scenario> => {
    const parsedId = scenarioId(id);
    return requestJson(BACKEND_URL+':'+backend_port+'/replace/'+parsedId, scenarioFor(parsedId, true), {
        method: 'POST', 
        mode: 'cors',
        body: data
    });
}; 

export const fetchExcelFile = async (port: number, filename: string, signal?: AbortSignal): Promise<Blob> => {
    if (typeof filename !== 'string' || !filename.trim() || /[/\\]/.test(filename) || filename === '.' || filename === '..') {
        throw new ApiClientError('invalid_request', 'An Excel filename without a directory is required.');
    }
    return requestWorkbook(`${BACKEND_URL}:${port}/get_excel_file/${encodeURIComponent(filename)}`, {signal});
};

export const runModel = async (backend_port: number, data: RunModelRequest): Promise<Scenario> => {
    const id = scenarioId(data.scenario.id);
    if (typeof data.run_id !== 'string' || !data.run_id.trim()) throw new ApiClientError('invalid_request', 'An optimization run ID is required.');
    return requestJson(BACKEND_URL+':'+backend_port+'/run_model', runFor(id, data.run_id), {
        method: 'POST', 
        mode: 'cors',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
}; 

export const deleteScenario = async (backend_port: number, data: {id: ScenarioId}): Promise<ScenarioListResponse> => {
    const id = scenarioId(data.id);
    return requestJson(BACKEND_URL+':'+backend_port+'/delete_scenario/', deletedScenarioFor(id), {
        method: 'POST', 
        mode: 'cors',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...data, id})
    });
}; 

export const copyScenario = async (backend_port: number, id: ScenarioId, newScenarioName: string): Promise<CopyScenarioResponse> => {
    const parsedId = scenarioId(id);
    return requestJson(`${BACKEND_URL}:${backend_port}/copy/${parsedId}/${encodeURIComponent(newScenarioName)}`, copiedScenarioFor(parsedId), {
        method: 'GET', 
        mode: 'cors'
    });
};

export const fetchScenario = async (backend_port: number, id: ScenarioId): Promise<Scenario> => {
    const parsedId = scenarioId(id);
    return requestJson(`${BACKEND_URL}:${backend_port}/get_scenario/${parsedId}`, scenarioFor(parsedId));
};

export const uploadScenario = (backend_port: number, data: FormData, name: string, defaultNodeType = 'NetworkNode'): Promise<Scenario> => {
    const query = new URLSearchParams({defaultNodeType});
    const endpoint = `${BACKEND_URL}:${backend_port}/upload/${encodeURIComponent(name)}?${query}`;
    return requestJson(endpoint, decodeSavedScenario, {
        method: 'POST', 
        mode: 'cors',
        body: data
    });
};

export const uploadAdditionalMap = async (backend_port: number, data: FormData, id: ScenarioId, defaultNodeType = 'NetworkNode'): Promise<Scenario> => {
    const parsedId = scenarioId(id);
    const query = new URLSearchParams({defaultNodeType});
    const endpoint = `${BACKEND_URL}:${backend_port}/upload_additional_map/${parsedId}?${query}`;
    return requestJson(endpoint, scenarioFor(parsedId, true), {
        method: 'POST', 
        mode: 'cors',
        body: data
    });
}; 

export const generateReport = async (port: number, id: ScenarioId, signal?: AbortSignal): Promise<Blob> =>
    requestWorkbook(`${BACKEND_URL}:${port}/generate_report/${scenarioId(id)}`, {signal});

export const generateExcelFromMap = async (port: number, id: ScenarioId, signal?: AbortSignal): Promise<Blob> =>
    requestWorkbook(`${BACKEND_URL}:${port}/generate_excel_from_map/${scenarioId(id)}`, {signal});

export const getScenarioReadiness = async (port: number, id: ScenarioId, signal?: AbortSignal): Promise<ScenarioValidationResult> =>
    requestJson(`${BACKEND_URL}:${port}/scenario_readiness/${scenarioId(id)}`, decodeValidationResult, {signal});

export function fillScenarioInputs(port: number, id: ScenarioId, payload: FillScenarioInputsRequest & {apply: true}): Promise<Scenario>;
export function fillScenarioInputs(port: number, id: ScenarioId, payload: FillScenarioInputsRequest & {apply: false}): Promise<ScenarioFillPreview>;
export async function fillScenarioInputs(port: number, id: ScenarioId, payload: FillScenarioInputsRequest): Promise<Scenario | ScenarioFillPreview> {
    const parsedId = scenarioId(id);
    const decode = payload.apply ? scenarioFor(parsedId, true) : fillPreviewFor(payload.revision, payload.value);
    return requestJson<Scenario | ScenarioFillPreview>(`${BACKEND_URL}:${port}/fill_scenario_inputs/${parsedId}`, decode, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
    });
}

export const checkScenarioFeasibility = async (port: number, id: ScenarioId): Promise<ScenarioValidationResult> =>
    requestJson(`${BACKEND_URL}:${port}/scenario_feasibility/${scenarioId(id)}`, decodeValidationResult, {method: 'POST'});

export const savePlanningHorizon = async (port: number, id: ScenarioId, periods: string[], revision?: string): Promise<Scenario> => {
    const parsedId = scenarioId(id);
    return requestJson(`${BACKEND_URL}:${port}/planning_horizon/${parsedId}`, scenarioFor(parsedId, true), {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({periods, revision})});
};

export const getAIAvailability = (backend_port: number, signal?: AbortSignal): Promise<{available: boolean}> =>
    requestJson(`${BACKEND_URL}:${backend_port}/ai_available`, decodeAIAvailability, {signal});

export const getAISettings = (backend_port: number): Promise<AIBackendSettings> =>
    requestJson(`${BACKEND_URL}:${backend_port}/ai_settings`, decodeAIBackendSettings);

export const saveAISettings = (backend_port: number, settings: {api_key?: string; base_url: string; model: string}): Promise<AIBackendSettings> =>
    requestJson(`${BACKEND_URL}:${backend_port}/ai_settings`, decodeAIBackendSettings, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({api_key: settings.api_key, base_url: settings.base_url, model: settings.model}),
    });

export const resetAISettings = (backend_port: number): Promise<AIBackendSettings> =>
    requestJson(`${BACKEND_URL}:${backend_port}/ai_settings`, decodeAIBackendSettings, {method: 'DELETE'});

export const requestAIDataUpdate = async (backend_port: number, id: ScenarioId, prompt: string, validationFindings?: unknown): Promise<AIPromptResponse> => {
    const endpoint = `${BACKEND_URL}:${backend_port}/request_ai_data_update/${scenarioId(id)}`
    return requestJson(endpoint, decodeAIPromptResponse, {
        method: 'POST',
        mode: 'cors',
        headers: {'Content-Type': 'application/json'},
        // Attach validation evidence when provided so the backend embeds it in
        // the fill prompt; omit the key entirely for standalone prompt-only runs.
        body: JSON.stringify(validationFindings != null ? {"prompt": prompt, "validation_findings": validationFindings} : {"prompt": prompt})
    });
}

export const requestAIOptimizationDiagnosis = async (
    backend_port: number,
    id: ScenarioId,
    errorMessage: string
): Promise<AIOptimizationDiagnosisResponse> => {
    const endpoint = `${BACKEND_URL}:${backend_port}/request_ai_optimization_diagnosis/${scenarioId(id)}`
    return requestJson(endpoint, decodeAIOptimizationDiagnosis, {
        method: 'POST',
        mode: 'cors',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ errorMessage })
    });
}

export const validateScenario = async (backend_port: number, id: ScenarioId): Promise<ScenarioValidationResult> => {
    return requestJson(BACKEND_URL+':'+backend_port+'/validate_scenario/'+scenarioId(id), decodeValidationResult, {
        method: 'GET',
        mode: 'cors'
    });
};

export const advanceToOptimizationSetup = async (backend_port: number, id: ScenarioId): Promise<ScenarioResponse> => {
    const parsedId = scenarioId(id);
    return requestJson(BACKEND_URL+':'+backend_port+'/advance_to_optimization_setup/'+parsedId, object({data: scenarioFor(parsedId, true)}), {
        method: 'POST',
        mode: 'cors'
    });
};
