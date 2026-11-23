import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { requestAIDataUpdate, requestAIOptimizationDiagnosis } from '../services/app.service';
import { scenarioId as parseScenarioId } from '../services/apiClient';
import { checkAIAvailability } from '../services/ai-settings.service';
import { useApp } from '../AppContext';
import { buildPreviewScenario, computeAIDiff, getTableDimensionCount, isBlankCell, mergeStagedScenario } from '../utils/aiStaging';
import type {
  AIChatHistoryEntry,
  AIChatMessage,
  AIPromptResponse,
  AIPromptUpdatedScenario,
  AIOptimizationDiagnosisResponse,
  ParameterTable,
  Scenario,
  ScenarioDataInput,
} from '../types';

type AIPromptStatus = 'idle' | 'running' | 'success' | 'error';
type AIPromptRequestKind = 'data-update' | 'optimization-diagnosis' | null;

export interface ScenarioAIChatThread {
  messages: AIChatMessage[];
  stagedScenario: AIPromptUpdatedScenario | null;
  stagedBaseRevision: string | null;
  validationFindings: unknown;
}

const EMPTY_THREAD: ScenarioAIChatThread = {
  messages: [],
  stagedScenario: null,
  stagedBaseRevision: null,
  validationFindings: null,
};

const makeMessageId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function sanitizeNotesList(notes: string[] | undefined): string[] {
  if (!notes || !notes.length) return [];
  const stripPrefix = (note: string): string =>
    note
      .replace(/df_parameters\[['"]([^'"]+)['"]\]/g, '$1')
      .replace(/df_parameters\./g, '');
  const bullets: string[] = [];
  notes.forEach(note => {
    stripPrefix(note)
      .split(/\n+/)
      .forEach(line => {
        const cleaned = line.trim().replace(/^[-*•]\s+/, '').trim();
        if (cleaned) bullets.push(cleaned);
      });
  });
  return bullets;
}

export interface OpenAIPanelOptions {
  scenarioId?: string | number | null;
  validationFindings?: unknown;
  revalidateOnApply?: boolean;
}

export interface SendChatMessageOptions {
  validationFindings?: unknown;
  revalidateOnApply?: boolean;
  baseRevision?: string | null;
}

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

  // Interactive side-window & per-scenario chat/staging API
  isPanelOpen: boolean;
  isPanelExpanded: boolean;
  setIsPanelExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  openPanel: (options?: OpenAIPanelOptions) => void;
  closePanel: () => void;
  togglePanel: (options?: OpenAIPanelOptions) => void;
  getThread: (scenarioId: string | number | null | undefined) => ScenarioAIChatThread;
  sendChatMessage: (
    scenarioId: string | number,
    prompt: string,
    baselineDataInput?: ScenarioDataInput | null,
    options?: SendChatMessageOptions,
  ) => Promise<boolean>;
  setThreadValidationFindings: (scenarioId: string | number, findings: unknown) => void;
  updateStagedParameterTable: (
    scenarioId: string | number,
    tableKey: string,
    updatedTable: ParameterTable,
    baselineDataInput?: ScenarioDataInput | null,
    baseRevision?: string | null,
  ) => void;
  invalidateStaleStagedUpdates: (
    scenarioId: string | number,
    currentRevision: string | null | undefined,
  ) => void;
  discardStagedUpdates: (scenarioId: string | number) => void;
  markStagedUpdatesApplied: (scenarioId: string | number, summary?: string, undoEntryId?: string) => boolean;
  appendSystemNotice: (scenarioId: string | number, content: string) => void;
  revertStagedTable: (
    scenarioId: string | number,
    tableKey: string,
    baselineDataInput?: ScenarioDataInput | null,
  ) => void;
  revertStagedSet: (
    scenarioId: string | number,
    setName: string,
    baselineDataInput?: ScenarioDataInput | null,
  ) => void;
  revertStagedCell: (
    scenarioId: string | number,
    tableKey: string,
    rowIdx: number,
    colIdx: number,
    baselineDataInput: ScenarioDataInput,
  ) => void;
  clearConversation: (scenarioId: string | number) => void;
}

const AIPromptContext = createContext<AIPromptContextValue | undefined>(undefined);

const FALLBACK_AI_CONTEXT: Partial<AIPromptContextValue> = {
  isAvailable: false,
  isPanelOpen: false,
  isPanelExpanded: false,
};

export const useAIPrompt = (): AIPromptContextValue => {
  const ctx = useContext(AIPromptContext);
  if (!ctx) throw new Error('useAIPrompt must be used within an AIPromptProvider');
  return ctx;
};

export const useOptionalAIPrompt = (): Partial<AIPromptContextValue> =>
  useContext(AIPromptContext) ?? FALLBACK_AI_CONTEXT;

interface AIPromptProviderProps {
  children: React.ReactNode;
}

const safeParseId = (id: string | number | null | undefined): number | null => {
  if (id === null || id === undefined || id === '') return null;
  try {
    return parseScenarioId(id);
  } catch {
    return null;
  }
};

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

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [threads, setThreads] = useState<Record<number, ScenarioAIChatThread>>({});
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const revalidateFlagsRef = useRef<Record<number, boolean>>({});

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

  const updateThread = useCallback(
    (idNum: number, updater: (prev: ScenarioAIChatThread) => ScenarioAIChatThread) => {
      setThreads(prev => {
        const current = prev[idNum] || EMPTY_THREAD;
        const next = { ...prev, [idNum]: updater(current) };
        threadsRef.current = next;
        return next;
      });
    },
    [],
  );

  const getThread = useCallback(
    (scenarioId: string | number | null | undefined): ScenarioAIChatThread => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return EMPTY_THREAD;
      return threads[idNum] || EMPTY_THREAD;
    },
    [threads],
  );

  const setThreadValidationFindings = useCallback(
    (scenarioId: string | number, findings: unknown) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      updateThread(idNum, prev => ({ ...prev, validationFindings: findings ?? null }));
    },
    [updateThread],
  );

  const openPanel = useCallback(
    (options?: OpenAIPanelOptions) => {
      if (options?.scenarioId !== undefined && options.scenarioId !== null) {
        const idNum = safeParseId(options.scenarioId);
        if (idNum !== null) {
          if (options.validationFindings !== undefined) {
            updateThread(idNum, prev => ({
              ...prev,
              validationFindings: options.validationFindings,
            }));
          }
          if (options.revalidateOnApply !== undefined) {
            revalidateFlagsRef.current[idNum] = options.revalidateOnApply;
          }
        }
      }
      setIsPanelOpen(true);
    },
    [updateThread],
  );

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const togglePanel = useCallback(
    (options?: OpenAIPanelOptions) => {
      setIsPanelOpen(prev => {
        const next = !prev;
        if (next && options?.scenarioId !== undefined && options.scenarioId !== null) {
          const idNum = safeParseId(options.scenarioId);
          if (idNum !== null && options.validationFindings !== undefined) {
            updateThread(idNum, current => ({
              ...current,
              validationFindings: current.validationFindings ?? options.validationFindings,
            }));
          }
        }
        return next;
      });
    },
    [updateThread],
  );

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

  const sendChatMessage = async (
    id: string | number,
    prompt: string,
    baselineDataInput?: ScenarioDataInput | null,
    options?: SendChatMessageOptions,
  ): Promise<boolean> => {
    if (!isAvailable || requestPending.current) return false;
    const trimmed = prompt.trim();
    if (!trimmed) return false;

    let idNumber: number;
    try {
      idNumber = parseScenarioId(id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Invalid scenario ID.');
      setStatus('error');
      return false;
    }

    if (options?.revalidateOnApply !== undefined) {
      revalidateFlagsRef.current[idNumber] = options.revalidateOnApply;
    }

    const existingThread = threadsRef.current[idNumber] || EMPTY_THREAD;
    const effectiveValidationFindings =
      options?.validationFindings !== undefined
        ? options.validationFindings
        : existingThread.validationFindings;
    const priorHistory: AIChatHistoryEntry[] = existingThread.messages
      .filter(msg => msg.status !== 'applied')
      .map(msg => ({
        role: msg.role,
        content: [msg.content, ...(msg.updateNotes || [])].filter(Boolean).join('\n'),
      }));

    const userMsg: AIChatMessage = {
      id: makeMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    updateThread(idNumber, prev => ({
      ...prev,
      validationFindings: null,
      messages: [...prev.messages, userMsg],
    }));

    requestPending.current = true;
    const version = ++requestVersion.current;
    setStatus('running');
    setRequestKind('data-update');
    setRequestScenarioId(idNumber);
    setErrorMessage(null);
    setResponse(null);
    setUpdatedScenario(null);
    setUpdateNotes([]);
    setQuestions([]);
    setLastPrompt(trimmed);

    try {
      const payload = await requestAIDataUpdate(
        port,
        idNumber,
        trimmed,
        effectiveValidationFindings ?? undefined,
        {
          conversationHistory: priorHistory,
          stagedUpdates: existingThread.stagedScenario,
        },
      );
      if (version !== requestVersion.current) return;
      setResponse(payload);

      if (payload.status === 'error') {
        const msg = payload.errorMessage || payload.error || 'AI request failed.';
        setErrorMessage(msg);
        setQuestions(payload.questions || []);
        setStatus('error');
        updateThread(idNumber, prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: makeMessageId(),
              role: 'assistant',
              status: 'error',
              content: msg,
              questions: payload.questions,
              timestamp: new Date().toISOString(),
            },
          ],
        }));
        return true;
      }

      const workingBaseline = existingThread.stagedScenario && baselineDataInput
        ? buildPreviewScenario({ data_input: baselineDataInput } as Scenario, existingThread.stagedScenario)?.data_input
        : baselineDataInput;
      const turnDiff = payload.updatedScenario
        ? computeAIDiff(workingBaseline, payload.updatedScenario)
        : null;
      const changedTables = turnDiff
        ? Object.values(turnDiff.changedTables).map(t => ({
            name: t.tableKey,
            cellCount: t.changedCellCount,
          }))
        : [];
      const changedSets = turnDiff ? turnDiff.changedSets.map(s => s.name) : [];

      const nextStaged = mergeStagedScenario(existingThread.stagedScenario, payload.updatedScenario);
      setUpdatedScenario(nextStaged);
      setUpdateNotes(payload.updateNotes || []);
      setQuestions(payload.questions || []);
      setStatus('success');

      const cleanedNotes = sanitizeNotesList(payload.updateNotes);
      const replyContent =
        payload.reply ||
        cleanedNotes[0] ||
        (changedTables.length > 0
          ? `Staged updates in ${changedTables.map(t => t.name).join(', ')}. Click any table below or in the left sidebar to inspect the highlighted fields.`
          : payload.questions?.length
            ? 'I need a quick clarification before updating those fields:'
            : 'Reviewed scenario.');
      const remainingNotes = payload.reply ? cleanedNotes : cleanedNotes.slice(1);

      const assistantMsg: AIChatMessage = {
        id: makeMessageId(),
        role: 'assistant',
        status: 'success',
        content: replyContent,
        updateNotes: remainingNotes.length > 0 ? remainingNotes : undefined,
        questions: payload.questions && payload.questions.length > 0 ? payload.questions : undefined,
        changedTables: changedTables.length > 0 ? changedTables : undefined,
        changedSets: changedSets.length > 0 ? changedSets : undefined,
        timestamp: new Date().toISOString(),
      };

      updateThread(idNumber, prev => ({
        ...prev,
        stagedScenario: nextStaged,
        stagedBaseRevision: nextStaged
          ? (options?.baseRevision ?? prev.stagedBaseRevision ?? null)
          : null,
        messages: [...prev.messages, assistantMsg],
      }));
      return true;
    } catch (error) {
      if (version !== requestVersion.current) return true;
      const msg = error instanceof Error ? error.message : 'Unable to complete AI request.';
      setErrorMessage(msg);
      setStatus('error');
      updateThread(idNumber, prev => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: makeMessageId(),
            role: 'assistant',
            status: 'error',
            content: msg,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      return true;
    } finally {
      if (version === requestVersion.current) requestPending.current = false;
    }
  };

  const updateStagedParameterTable = useCallback(
    (
      scenarioId: string | number,
      tableKey: string,
      updatedTable: ParameterTable,
      baselineDataInput?: ScenarioDataInput | null,
      baseRevision?: string | null,
    ) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      const clonedTable = JSON.parse(JSON.stringify(updatedTable)) as ParameterTable;
      updateThread(idNum, prev => {
        const nextStaged = mergeStagedScenario(prev.stagedScenario, {
          df_parameters: { [tableKey]: clonedTable },
        });
        if (baselineDataInput && nextStaged) {
          if (
            nextStaged.df_parameters &&
            JSON.stringify(baselineDataInput.df_parameters?.[tableKey]) === JSON.stringify(clonedTable)
          ) {
            delete nextStaged.df_parameters[tableKey];
            if (Object.keys(nextStaged.df_parameters).length === 0) {
              delete nextStaged.df_parameters;
            }
          }
          const diff = computeAIDiff(baselineDataInput, nextStaged);
          if (!diff.hasStagedChanges) {
            return {
              ...prev,
              stagedScenario: null,
              stagedBaseRevision: null,
            };
          }
        }
        return {
          ...prev,
          stagedScenario: nextStaged,
          stagedBaseRevision: nextStaged ? (prev.stagedBaseRevision ?? baseRevision ?? null) : null,
        };
      });
    },
    [updateThread],
  );

  const invalidateStaleStagedUpdates = useCallback(
    (scenarioId: string | number, currentRevision: string | null | undefined) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null || !currentRevision) return;
      let invalidated = false;
      updateThread(idNum, prev => {
        if (!prev.stagedScenario || !prev.stagedBaseRevision || prev.stagedBaseRevision === currentRevision) {
          return prev;
        }
        invalidated = true;
        return {
          ...prev,
          stagedScenario: null,
          stagedBaseRevision: null,
          messages: [
            ...prev.messages,
            {
              id: makeMessageId(),
              role: 'assistant',
              status: 'applied',
              content: 'Cleared staged AI edits because scenario inputs were updated elsewhere.',
              timestamp: new Date().toISOString(),
            },
          ],
        };
      });
      if (invalidated && requestScenarioId === idNum) {
        setUpdatedScenario(null);
      }
    },
    [requestScenarioId, updateThread],
  );

  const discardStagedUpdates = useCallback(
    (scenarioId: string | number) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      updateThread(idNum, prev => ({
        ...prev,
        stagedScenario: null,
        stagedBaseRevision: null,
      }));
      if (requestScenarioId === idNum) {
        setUpdatedScenario(null);
      }
    },
    [requestScenarioId, updateThread],
  );

  const markStagedUpdatesApplied = useCallback(
    (scenarioId: string | number, summary?: string, undoEntryId?: string): boolean => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return false;
      const shouldRevalidate = Boolean(revalidateFlagsRef.current[idNum]);
      revalidateFlagsRef.current[idNum] = false;
      updateThread(idNum, prev => ({
        ...prev,
        stagedScenario: null,
        stagedBaseRevision: null,
        validationFindings: null,
        messages: [
          ...prev.messages,
          {
            id: makeMessageId(),
            role: 'assistant',
            status: 'applied',
            ...(undoEntryId ? { undoEntryId } : {}),
            content: summary || 'Applied staged AI changes to the scenario.',
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      if (requestScenarioId === idNum) {
        setUpdatedScenario(null);
      }
      return shouldRevalidate;
    },
    [requestScenarioId, updateThread],
  );

  const appendSystemNotice = useCallback(
    (scenarioId: string | number, content: string) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null || !content.trim()) return;
      updateThread(idNum, prev => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: makeMessageId(),
            role: 'assistant',
            status: 'applied',
            content,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
    },
    [updateThread],
  );

  const revertStagedTable = useCallback(
    (
      scenarioId: string | number,
      tableKey: string,
      baselineDataInput?: ScenarioDataInput | null,
    ) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      updateThread(idNum, prev => {
        if (!prev.stagedScenario?.df_parameters || !(tableKey in prev.stagedScenario.df_parameters)) {
          return prev;
        }
        const nextStaged = JSON.parse(JSON.stringify(prev.stagedScenario)) as AIPromptUpdatedScenario;
        if (nextStaged.df_parameters) {
          delete nextStaged.df_parameters[tableKey];
          if (Object.keys(nextStaged.df_parameters).length === 0) {
            delete nextStaged.df_parameters;
          }
        }
        const empty =
          (!nextStaged.df_parameters && !nextStaged.df_sets) ||
          (baselineDataInput ? !computeAIDiff(baselineDataInput, nextStaged).hasStagedChanges : false);
        return {
          ...prev,
          stagedScenario: empty ? null : nextStaged,
          stagedBaseRevision: empty ? null : prev.stagedBaseRevision,
        };
      });
    },
    [updateThread],
  );

  const revertStagedSet = useCallback(
    (
      scenarioId: string | number,
      setName: string,
      baselineDataInput?: ScenarioDataInput | null,
    ) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      updateThread(idNum, prev => {
        if (!prev.stagedScenario?.df_sets || !(setName in prev.stagedScenario.df_sets)) {
          return prev;
        }
        const nextStaged = JSON.parse(JSON.stringify(prev.stagedScenario)) as AIPromptUpdatedScenario;
        if (nextStaged.df_sets) {
          delete nextStaged.df_sets[setName];
          if (Object.keys(nextStaged.df_sets).length === 0) {
            delete nextStaged.df_sets;
          }
        }
        const empty =
          (!nextStaged.df_parameters && !nextStaged.df_sets) ||
          (baselineDataInput ? !computeAIDiff(baselineDataInput, nextStaged).hasStagedChanges : false);
        return {
          ...prev,
          stagedScenario: empty ? null : nextStaged,
          stagedBaseRevision: empty ? null : prev.stagedBaseRevision,
        };
      });
    },
    [updateThread],
  );

  const revertStagedCell = useCallback(
    (
      scenarioId: string | number,
      tableKey: string,
      rowIdx: number,
      colIdx: number,
      baselineDataInput: ScenarioDataInput,
    ) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      updateThread(idNum, prev => {
        if (!prev.stagedScenario?.df_parameters?.[tableKey]) return prev;
        const nextStaged = JSON.parse(JSON.stringify(prev.stagedScenario)) as AIPromptUpdatedScenario;
        const stagedTable = nextStaged.df_parameters?.[tableKey] as ParameterTable | undefined;
        if (!stagedTable) return prev;
        const colNames = Object.keys(stagedTable);
        const colName = colNames[colIdx];
        if (!colName || !Array.isArray(stagedTable[colName])) return prev;
        const savedTable = baselineDataInput.df_parameters?.[tableKey] as ParameterTable | undefined;
        const savedVal = savedTable?.[colName]?.[rowIdx];
        stagedTable[colName][rowIdx] =
          savedVal !== undefined ? JSON.parse(JSON.stringify(savedVal)) : '';

        const dimCount = getTableDimensionCount(colNames);
        const valueCols = colNames.slice(dimCount);
        const savedRowCount =
          savedTable && colNames[0] && Array.isArray(savedTable[colNames[0]])
            ? savedTable[colNames[0]].length
            : 0;
        const totalRows =
          colNames[0] && Array.isArray(stagedTable[colNames[0]])
            ? stagedTable[colNames[0]].length
            : 0;
        if (totalRows > savedRowCount && valueCols.length > 0) {
          const keepRows: number[] = [];
          for (let r = 0; r < totalRows; r += 1) {
            if (r < savedRowCount || valueCols.some(col => !isBlankCell(stagedTable[col]?.[r]))) {
              keepRows.push(r);
            }
          }
          if (keepRows.length !== totalRows) {
            for (const col of colNames) {
              if (Array.isArray(stagedTable[col])) {
                stagedTable[col] = keepRows.map(r => stagedTable[col][r]);
              }
            }
          }
        }

        const tableStillChanged = Boolean(
          computeAIDiff(baselineDataInput, { df_parameters: { [tableKey]: stagedTable } })
            .changedTables[tableKey],
        );
        if (!tableStillChanged) {
          delete nextStaged.df_parameters![tableKey];
        }
        if (nextStaged.df_parameters && Object.keys(nextStaged.df_parameters).length === 0) {
          delete nextStaged.df_parameters;
        }
        const empty = !computeAIDiff(baselineDataInput, nextStaged).hasStagedChanges;
        return {
          ...prev,
          stagedScenario: empty ? null : nextStaged,
          stagedBaseRevision: empty ? null : prev.stagedBaseRevision,
        };
      });
    },
    [updateThread],
  );

  const clearConversation = useCallback(
    (scenarioId: string | number) => {
      const idNum = safeParseId(scenarioId);
      if (idNum === null) return;
      revalidateFlagsRef.current[idNum] = false;
      setThreads(prev => {
        const next = { ...prev };
        delete next[idNum];
        threadsRef.current = next;
        return next;
      });
      if (requestScenarioId === idNum) {
        requestVersion.current += 1;
        requestPending.current = false;
        setRequestScenarioId(null);
        setStatus('idle');
        setRequestKind(null);
        setErrorMessage(null);
        setResponse(null);
        setUpdatedScenario(null);
        setUpdateNotes([]);
        setQuestions([]);
        setLastPrompt(null);
      }
    },
    [requestScenarioId],
  );

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
      isPanelOpen,
      isPanelExpanded,
      setIsPanelExpanded,
      openPanel,
      closePanel,
      togglePanel,
      getThread,
      sendChatMessage,
      setThreadValidationFindings,
      updateStagedParameterTable,
      invalidateStaleStagedUpdates,
      discardStagedUpdates,
      markStagedUpdatesApplied,
      appendSystemNotice,
      revertStagedTable,
      revertStagedSet,
      revertStagedCell,
      clearConversation,
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
      isPanelOpen,
      isPanelExpanded,
      openPanel,
      closePanel,
      togglePanel,
      getThread,
      setThreadValidationFindings,
      updateStagedParameterTable,
      invalidateStaleStagedUpdates,
      discardStagedUpdates,
      markStagedUpdatesApplied,
      appendSystemNotice,
      revertStagedTable,
      revertStagedSet,
      revertStagedCell,
      clearConversation,
    ],
  );

  return <AIPromptContext.Provider value={value}>{children}</AIPromptContext.Provider>;
};
