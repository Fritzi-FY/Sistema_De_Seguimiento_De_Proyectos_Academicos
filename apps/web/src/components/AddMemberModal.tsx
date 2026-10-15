import React, { useState } from 'react';
import type { AddMemberRequest } from '@is488/shared';
import { AddMemberRequestSchema } from '@is488/shared';
import { X, Loader2, AlertCircle, UserPlus } from 'lucide-react';

export interface AddMemberModalProps {
  isOpen: boolean;
  isCreator: boolean;
  onClose: () => void;
  onSubmit: (data: AddMemberRequest) => Promise<void>;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  isOpen,
  isCreator,
  onClose,
  onSubmit,
}) => {
  const [userId, setUserId] = useState('');
  const [role] = useState<'collaborator'>('collaborator');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Visible y operable solo para el creador del proyecto
  if (!isOpen || !isCreator) return null;

  const trimmedUserId = userId.trim();
  const validationResult = AddMemberRequestSchema.safeParse({
    userId: trimmedUserId,
    role,
  });

  const isFormValid = validationResult.success;
  const validationError =
    !isFormValid && trimmedUserId.length > 0
      ? validationResult.error.issues.map((i) => i.message).join('. ')
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setErrorMessage(null);

    const validation = AddMemberRequestSchema.safeParse({
      userId: trimmedUserId,
      role,
    });

    if (!validation.success) {
      const msg = validation.error.issues.map((i) => i.message).join('. ');
      setErrorMessage(msg);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(validation.data);
      setUserId('');
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Error al agregar integrante al proyecto',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-member-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-7">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <UserPlus className="h-5 w-5 text-unsch-garnet" aria-hidden="true" />
            <h3 id="add-member-modal-title" className="text-lg font-bold text-slate-900">
              Agregar Integrante
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Cerrar modal"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-4 flex items-start space-x-2.5 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="member-user-id" className="block text-xs font-semibold text-slate-700">
              Identificador del Usuario (UUID) *
            </label>
            <input
              id="member-user-id"
              type="text"
              required
              disabled={submitting}
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="Ej. 550e8400-e29b-41d4-a716-446655440000"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-unsch-garnet focus:outline-none focus:ring-1 focus:ring-unsch-garnet disabled:opacity-50"
            />
            {validationError ? (
              <span className="mt-1 block text-[11px] font-medium text-rose-600">
                {validationError}
              </span>
            ) : (
              <span className="mt-1 block text-[11px] text-slate-400">
                Debe ser un identificador de usuario en formato UUID v4 válido.
              </span>
            )}
          </div>

          <div>
            <label htmlFor="member-role" className="block text-xs font-semibold text-slate-700">
              Rol en el proyecto
            </label>
            <select
              id="member-role"
              value={role}
              disabled
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 shadow-sm cursor-not-allowed"
            >
              <option value="collaborator">Colaborador (asignación permitida)</option>
            </select>
            <span className="mt-1 block text-[11px] text-slate-400">
              El rol de propietario es exclusivo del creador del proyecto.
            </span>
          </div>

          <div className="flex items-center justify-end space-x-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !isFormValid}
              className="inline-flex items-center rounded-lg bg-unsch-garnet px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-unsch-garnet/90 focus:outline-none focus:ring-2 focus:ring-unsch-garnet disabled:opacity-50"
            >
              {submitting && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Agregar Integrante
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
