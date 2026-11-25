import React, { useState, useEffect, useCallback } from 'react';
import type { AIAnalysisFocus, AIAnalysisRequest, AIAnalysisResponse } from '@is488/shared';
import {
  generateProjectAISummary,
  AIAssistantServiceError,
} from '../services/ai-assistant.service.js';
import {
  X,
  Sparkles,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ListOrdered,
  RefreshCw,
  Clock,
  Cpu,
} from 'lucide-react';

export interface ProjectAIAssistantModalProps {
  isOpen: boolean;
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  summaryFetcher?: (
    projectId: string,
    request?: AIAnalysisRequest,
  ) => Promise<AIAnalysisResponse>;
}

export type ModalState = 'idle' | 'loading' | 'success' | 'error';

function formatGenerationDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('es-PE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export const ProjectAIAssistantModal: React.FC<ProjectAIAssistantModalProps> = ({
  isOpen,
  projectId,
  projectTitle,
  onClose,
  summaryFetcher = generateProjectAISummary,
}) => {
  const [state, setState] = useState<ModalState>('idle');
  const [focus, setFocus] = useState<AIAnalysisFocus>('full');
  const [analysis, setAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  // Escuchar tecla Escape para cerrar accesiblemente
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state !== 'loading') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, state, onClose]);

  // Restablecer estado al abrir o cambiar de proyecto
  useEffect(() => {
    if (isOpen) {
      setState('idle');
      setAnalysis(null);
      setErrorMessage(null);
      setRetryAfterSeconds(null);
      setFocus('full');
    }
  }, [isOpen, projectId]);

  const handleGenerate = useCallback(
    async (selectedFocus: AIAnalysisFocus = focus) => {
      setState('loading');
      setErrorMessage(null);
      setRetryAfterSeconds(null);

      try {
        const result = await summaryFetcher(projectId, { focus: selectedFocus });
        setAnalysis(result);
        setState('success');
      } catch (err: unknown) {
        setState('error');
        if (err instanceof AIAssistantServiceError) {
          setErrorMessage(err.userMessage);
          setRetryAfterSeconds(err.retryAfterSeconds ?? null);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage(
            'Ocurrió un error inesperado al consultar el asistente de IA. Por favor intente más tarde.',
          );
        }
      }
    },
    [projectId, focus, summaryFetcher],
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-assistant-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Cabecera del Modal */}
        <header className="flex items-center justify-between border-b border-slate-100 p-5 sm:px-6">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-unsch-garnet/10 text-unsch-garnet">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                id="ai-assistant-modal-title"
                className="text-base font-bold text-slate-900 sm:text-lg"
              >
                Asistente de Gestión y Seguimiento IA
              </h3>
              <p className="text-xs text-slate-500 truncate max-w-sm sm:max-w-md">
                {projectTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state === 'loading'}
            data-testid="close-ai-assistant-modal-btn"
            aria-label="Cerrar asistente"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {/* Cuerpo del Modal con scroll */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* ESTADO 1: Inicial (Idle) */}
          {state === 'idle' && (
            <div className="space-y-5 text-center py-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <Sparkles className="h-7 w-7 text-unsch-garnet" aria-hidden="true" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h4 className="text-base font-semibold text-slate-900">
                  Generar Resumen de Avance y Riesgos
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  El asistente examina el tablero Kanban y tareas activas para identificar el
                  progreso, cuellos de botella y próximos pasos sugeridos.
                </p>
              </div>

              {/* Selector de enfoque */}
              <div className="max-w-xs mx-auto text-left space-y-1.5">
                <label htmlFor="ai-focus-select" className="text-xs font-semibold text-slate-700">
                  Enfoque del análisis:
                </label>
                <select
                  id="ai-focus-select"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value as AIAnalysisFocus)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet"
                >
                  <option value="full">Análisis Completo (Progreso + Riesgos + Próximos pasos)</option>
                  <option value="risks">Énfasis en Riesgos y Bloqueos</option>
                  <option value="progress">Énfasis en Avance de Tareas</option>
                </select>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => handleGenerate(focus)}
                  data-testid="generate-ai-analysis-btn"
                  className="inline-flex items-center rounded-xl bg-unsch-garnet px-5 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-unsch-garnet/90 focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2"
                >
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                  Iniciar Análisis con IA
                </button>
              </div>
            </div>
          )}

          {/* ESTADO 2: Cargando (Loading) */}
          {state === 'loading' && (
            <div
              role="status"
              aria-live="polite"
              data-testid="ai-assistant-loading"
              className="flex flex-col items-center justify-center space-y-3 py-12 text-center"
            >
              <Loader2 className="h-9 w-9 animate-spin text-unsch-garnet" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800">
                  Analizando el estado del proyecto...
                </p>
                <p className="text-xs text-slate-500">
                  Procesando tablero Kanban, tareas y métricas de avance operativo.
                </p>
              </div>
            </div>
          )}

          {/* ESTADO 3: Error */}
          {state === 'error' && (
            <div
              role="alert"
              aria-live="assertive"
              data-testid="ai-assistant-error"
              className="rounded-xl border border-rose-200 bg-rose-50/70 p-5 text-rose-900 space-y-4"
            >
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-rose-900 text-sm">No se pudo completar el análisis</h4>
                  <p className="leading-relaxed text-rose-800">{errorMessage}</p>
                  {retryAfterSeconds !== null && retryAfterSeconds > 0 && (
                    <p className="font-medium text-rose-700">
                      Tiempo estimado de espera: {retryAfterSeconds} segundos.
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerate(focus)}
                  data-testid="retry-ai-analysis-btn"
                  className="inline-flex items-center rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Reintentar
                </button>
              </div>
            </div>
          )}

          {/* ESTADO 4: Éxito (Success) */}
          {state === 'success' && analysis && (
            <div data-testid="ai-assistant-success" className="space-y-6">
              {/* Banner de Advertencia Permanente e Ineludible */}
              <aside
                role="note"
                data-testid="ai-assistant-disclaimer"
                aria-label="Descargo de responsabilidad de IA"
                className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 text-amber-950 shadow-sm"
              >
                <div className="flex items-start space-x-3">
                  <AlertTriangle
                    className="h-5 w-5 text-amber-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="space-y-1 text-xs">
                    <h4 className="font-bold uppercase tracking-wider text-amber-900 text-[11px]">
                      Aviso Académico Importante (IS488)
                    </h4>
                    <p className="font-semibold text-amber-900">
                      {analysis.meta.disclaimer}
                    </p>
                    <p className="text-amber-800 leading-relaxed">
                      Las sugerencias generadas son exclusivamente recomendaciones operativas para apoyar
                      la organización del trabajo en equipo. La IA no tiene potestad evaluativa ni
                      reemplaza las revisiones o calificaciones oficiales del docente.
                    </p>
                  </div>
                </div>
              </aside>

              {/* Sección 1: Resumen de Avance */}
              <section
                data-testid="ai-progress-summary"
                className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4"
              >
                <div className="flex items-center space-x-2 text-slate-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Resumen del Progreso
                  </h4>
                </div>
                <p className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                  {analysis.analysis.progressSummary}
                </p>
              </section>

              {/* Sección 2: Señales de Riesgo */}
              <section data-testid="ai-risk-signals" className="space-y-2">
                <div className="flex items-center space-x-2 text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Señales de Riesgo ({analysis.analysis.riskSignals.length})
                  </h4>
                </div>
                {analysis.analysis.riskSignals.length > 0 ? (
                  <ul className="space-y-2">
                    {analysis.analysis.riskSignals.map((signal, index) => (
                      <li
                        key={index}
                        className="flex items-start space-x-2.5 rounded-lg border border-rose-100 bg-rose-50/50 p-2.5 text-xs text-rose-900"
                      >
                        <span className="font-bold text-rose-700">•</span>
                        <span className="leading-relaxed">{signal}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500 italic rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    No se identificaron señales críticas de riesgo en las tareas activas en este momento.
                  </p>
                )}
              </section>

              {/* Sección 3: Próximos Pasos Recomendados */}
              <section data-testid="ai-next-steps" className="space-y-2">
                <div className="flex items-center space-x-2 text-slate-900">
                  <ListOrdered className="h-4 w-4 text-unsch-garnet" aria-hidden="true" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Próximos Pasos Sugeridos ({analysis.analysis.nextSteps.length})
                  </h4>
                </div>
                {analysis.analysis.nextSteps.length > 0 ? (
                  <ol className="space-y-2">
                    {analysis.analysis.nextSteps.map((step, index) => (
                      <li
                        key={index}
                        className="flex items-start space-x-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 shadow-xs"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-[10px] text-slate-700">
                          {index + 1}
                        </span>
                        <span className="leading-relaxed pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-slate-500 italic rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    No hay pasos adicionales requeridos por ahora.
                  </p>
                )}
              </section>

              {/* Metadatos y Auditoría */}
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                <div className="flex items-center space-x-1.5">
                  <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Modelo: {analysis.meta.model}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Generado: {formatGenerationDate(analysis.meta.generatedAt)}</span>
                </div>
              </footer>
            </div>
          )}
        </div>

        {/* Pie del Modal con acciones */}
        {state === 'success' && (
          <footer className="flex items-center justify-between border-t border-slate-100 p-4 sm:px-6 bg-slate-50/50 rounded-b-2xl">
            <button
              type="button"
              onClick={() => handleGenerate(focus)}
              data-testid="refresh-ai-analysis-btn"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Actualizar análisis
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="success-close-ai-assistant-modal-btn"
              className="rounded-lg bg-unsch-garnet px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-unsch-garnet/90"
            >
              Entendido
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};
