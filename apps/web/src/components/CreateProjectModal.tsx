import React, { useState } from 'react';
import type { CreateProjectRequest } from '@is488/shared';
import { CreateProjectRequestSchema } from '@is488/shared';
import { X, Loader2, AlertCircle } from 'lucide-react';

export interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateProjectRequest) => Promise<void>;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [courseCode, setCourseCode] = useState('IS-488');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0] ?? '');
  const [targetDate, setTargetDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0] ?? '';
  });

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Convertir fechas a formato ISO-8601 UTC estricto
    const startIso = `${startDate}T00:00:00.000Z`;
    const targetIso = `${targetDate}T23:59:59.000Z`;

    const payload: CreateProjectRequest = {
      title: title.trim(),
      description: description.trim() || undefined,
      courseCode: courseCode.trim().toUpperCase(),
      startDate: startIso,
      targetDate: targetIso,
    };

    // Validación reactiva antes del envío
    const validation = CreateProjectRequestSchema.safeParse(payload);
    if (!validation.success) {
      const msg = validation.error.issues.map((i) => i.message).join('. ');
      setErrorMessage(msg);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(payload);
      // Resetear campos y cerrar
      setTitle('');
      setDescription('');
      setCourseCode('IS-488');
      const today = new Date().toISOString().split('T')[0] ?? '';
      setStartDate(today);
      const target = new Date();
      target.setDate(target.getDate() + 30);
      setTargetDate(target.toISOString().split('T')[0] ?? '');
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al registrar el proyecto');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-7">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 id="modal-title" className="text-lg font-bold text-slate-900">
            Nuevo Proyecto Académico
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar modal"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 flex items-start space-x-2.5 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="project-title" className="block text-xs font-semibold text-slate-700">
              Título del proyecto *
            </label>
            <input
              id="project-title"
              type="text"
              required
              minLength={3}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Sistema de Trazabilidad Curricular"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet"
            />
            <span className="text-[11px] text-slate-400">Entre 3 y 120 caracteres.</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="course-code" className="block text-xs font-semibold text-slate-700">
                Código de curso *
              </label>
              <input
                id="course-code"
                type="text"
                required
                maxLength={20}
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="IS-488"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet"
              />
            </div>

            <div>
              <label htmlFor="start-date" className="block text-xs font-semibold text-slate-700">
                Fecha de inicio *
              </label>
              <input
                id="start-date"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet"
              />
            </div>
          </div>

          <div>
            <label htmlFor="target-date" className="block text-xs font-semibold text-slate-700">
              Fecha de entrega estimada *
            </label>
            <input
              id="target-date"
              type="date"
              required
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet"
            />
            {targetDate < startDate && (
              <span className="text-[11px] font-medium text-rose-600">
                La fecha de entrega debe ser igual o posterior a la fecha de inicio.
              </span>
            )}
          </div>

          <div>
            <label
              htmlFor="project-description"
              className="block text-xs font-semibold text-slate-700"
            >
              Descripción (opcional)
            </label>
            <textarea
              id="project-description"
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objetivos, alcance y tecnologías previstas..."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet"
            />
            <span className="text-[11px] text-slate-400">Máximo 500 caracteres.</span>
          </div>

          <div className="flex items-center justify-end space-x-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || targetDate < startDate}
              className="inline-flex items-center rounded-lg bg-unsch-garnet px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-unsch-garnet/90 focus:outline-none focus:ring-2 focus:ring-unsch-garnet disabled:opacity-50"
            >
              {submitting && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Guardar Proyecto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
