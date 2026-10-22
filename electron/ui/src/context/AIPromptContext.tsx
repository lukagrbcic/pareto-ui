import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { requestAIDataUpdate, requestAIOptimizationDiagnosis } from '../services/app.service';
import { scenarioId as parseScenarioId } from '../services/apiClient';
import { checkAIAvailability } from '../services/ai-settings.service';
import { useApp } from '../AppContext';
import type {
  AIPromptResponse,
  AIPromptUpdatedScenario,
  AIOptimizationDiagnosisResponse,
} from '../types';
type AIPromptStatus = 'idle' | 'running' | 'success' | 'error';
type AIPromptRequestKind = 'data-update' | 'optimization-diagnosis' | null;

export interface AIPromptContextValue {
  isAvailable: boolean;
  setAvailability: (available: boolean) => void;
  status: AIPromptStatus;
  requestKind: AIPromptRequestKind;
  requestScenarioId: number | null;
  isRunning: boolean;
  response: AIPromptResponse | null;
  diagnosis: AIOptimizationDiagnosisResponse | null;
  updatedScenario: AIPromptUpdatedScenario | null;
  updateNotes: string[];
  questions: string[];
  errorMessage: string | null;
  lastPrompt: string | null;
  runPrompt: (scenarioId: string | number, prompt: string, validationFindings?: unknown) => Promise<void>;
  runOptimizationDiagnosis: (scenarioId: string | number, errorMessage: string) => Promise<void>;
  clearResult: () => void;
}

const AIPromptContext = createContext<AIPromptContextValue | undefined>(undefined);

export const useAIPrompt = (): AIPromptContextValue => {
  const ctx = useContext(AIPromptContext);
  if (!ctx) throw new Error('useAIPrompt must be used within an AIPromptProvider');
  return ctx;
};

interface AIPromptProviderProps {
  children: React.ReactNode;
}

export const AIPromptProvider: React.FC<AIPromptProviderProps> = ({ children }) => {
  const { port } = useApp();
  const requestVersion = useRef(0);
  const requestPending = useRef(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const availabilityConfigured = useRef(false);
  const setAvailability = (available: boolean) => {
    availabilityConfigured.current = true;
    setIsAvailable(available);
  };
  const [status, setStatus] = useState<AIPromptStatus>('idle');
  const [requestKind, setRequestKind] = useState<AIPromptRequestKind>(null);
  const [requestScenarioId, setRequestScenarioId] = useState<number | null>(null);
  const [response, setResponse] = useState<AIPromptResponse | null>(null);
  const [diagnosis, setDiagnosis] = useState<AIOptimizationDiagnosisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updatedScenario, setUpdatedScenario] = useState<AIPromptUpdatedScenario | null>(null);
  const [updateNotes, setUpdateNotes] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    availabilityConfigured.current = false;
    let retry: ReturnType<typeof setTimeout>;
    setIsAvailable(false);
    const checkAvailability = async () => {
      try {
        const available = await checkAIAvailability(port, controller.signal);
        if (!controller.signal.aborted && !availabilityConfigured.current)
          setIsAvailable(available);
      } catch {
        // AI is optional. A failed availability check should stay out of the UI.
        if (!controller.signal.aborted && !availabilityConfigured.current) {
          setIsAvailable(false);
          // The desktop window can load before its local backend is ready.
          retry = setTimeout(checkAvailability, 5000);
        }
      }
    };
    checkAvailability();
    return () => {
      controller.abort();
      clearTimeout(retry);
      requestVersion.current += 1;
      requestPending.current = false;
    };
  }, [port]);

  const runRequest = async (
    kind: Exclude<AIPromptRequestKind, null>,
    id: string | number,
    text: string,
    validationFindings?: unknown,
  ): Promise<void> => {
    if (!isAvailable || requestPending.current) return;
    requestPending.current = true;
    const version = ++requestVersion.current;
    setStatus('running');
    setRequestKind(kind);
    setRequestScenarioId(null);
    setErrorMessage(null);
    setResponse(null);
    setDiagnosis(null);
    setUpdatedScenario(null);
    setUpdateNotes([]);
    setQuestions([]);
    setLastPrompt(text);

    try {
      const idNumber = parseScenarioId(id);
      setRequestScenarioId(idNumber);
      if (kind === 'data-update') {
        const payload = await requestAIDataUpdate(port, idNumber, text, validationFindings);
        if (version !== requestVersion.current) return;
        setResponse(payload);
        if (payload.status === 'error') {
          setErrorMessage(payload.errorMessage || payload.error || 'AI request failed.');
          // The guard can reject an unusable scenario while the response still
          // carries valid questions; surface them for a follow-up.
          setQuestions(payload.questions || []);
          setStatus('error');
          return;
        }
        setUpdatedScenario(payload.updatedScenario || null);
        setUpdateNotes(payload.updateNotes || []);
        setQuestions(payload.questions || []);
      } else {
        const payload = await requestAIOptimizationDiagnosis(port, idNumber, text);
        if (version !== requestVersion.current) return;
        setDiagnosis(payload);
        if (payload.status === 'error') {
          setErrorMessage(payload.errorMessage || payload.error || 'AI diagnosis request failed.');
          setStatus('error');
          return;
        }
      }
      setStatus('success');
    } catch (error) {
      if (version !== requestVersion.current) return;
      setErrorMessage(error instanceof Error ? error.message : 'Unable to complete AI request.');
      setStatus('error');
    } finally {
      if (version === requestVersion.current) requestPending.current = false;
    }
  };

  const runPrompt = (id: string | number, prompt: string, validationFindings?: unknown): Promise<void> =>
    runRequest('data-update', id, prompt, validationFindings);
  const runOptimizationDiagnosis = (id: string | number, message: string): Promise<void> =>
    runRequest('optimization-diagnosis', id, message);

  const clearResult = (): void => {
    requestVersion.current += 1;
    requestPending.current = false;
    setRequestScenarioId(null);
    setStatus('idle');
    setRequestKind(null);
    setErrorMessage(null);
    setResponse(null);
    setDiagnosis(null);
    setUpdatedScenario(null);
    setUpdateNotes([]);
    setQuestions([]);
    setLastPrompt(null);
  };

  const value = useMemo(
    () => ({
      isAvailable,
      setAvailability,
      status,
      requestKind,
      requestScenarioId,
      isRunning: status === 'running',
      response,
      diagnosis,
      updatedScenario,
      updateNotes,
      questions,
      errorMessage,
      lastPrompt,
      runPrompt,
      runOptimizationDiagnosis,
      clearResult,
    }),
    [
      isAvailable,
      status,
      requestKind,
      requestScenarioId,
      response,
      diagnosis,
      updatedScenario,
      updateNotes,
      questions,
      errorMessage,
      lastPrompt,
    ],
  );

  return <AIPromptContext.Provider value={value}>{children}</AIPromptContext.Provider>;
};
