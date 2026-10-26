import { useEffect, useState } from 'react';
import { UpdateTaskSchema } from '@is488/shared';
import type { MembershipResponse } from '@is488/shared';
import { getMembers } from '../services/membership.service.js';

export function TaskAssigneePicker({
  projectId,
  selectedIds,
  currentIds = [],
  onChange,
  disabled = false,
  membersFetcher = getMembers,
  legend = 'Editar responsables',
}: {
  projectId: string;
  selectedIds: string[];
  currentIds?: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  membersFetcher?: (projectId: string) => Promise<MembershipResponse[]>;
  legend?: string;
}) {
  const [members, setMembers] = useState<MembershipResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setMembers([]);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await membersFetcher(projectId);
        if (current)
          setMembers(
            result.filter((member) => member.projectId === projectId && member.status === 'active'),
          );
      } catch (err) {
        if (current)
          setError(err instanceof Error ? err.message : 'No se pudieron consultar los miembros');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [projectId, membersFetcher, retry]);
  return (
    <fieldset disabled={disabled} className="space-y-2 text-sm text-slate-800">
      <legend className="font-semibold">{legend}</legend>
      {loading && <p role="status">Cargando miembros activos...</p>}
      {error && (
        <div role="status">
          <p>No se pudieron cargar los miembros: {error}</p>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-slate-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet"
            onClick={() => setRetry((value) => value + 1)}
          >
            Reintentar miembros
          </button>
        </div>
      )}
      {!loading && !error && members.length === 0 && (
        <p>No hay miembros activos disponibles para asignar.</p>
      )}
      {[...new Set([...currentIds, ...selectedIds, ...members.map((member) => member.userId)])].map(
        (id) => {
          const active = members.some((member) => member.userId === id);
          const compatible = UpdateTaskSchema.safeParse({ assigneeIds: [id] }).success;
          const checked = selectedIds.includes(id);
          return (
            <label key={id} className="flex min-h-11 items-center gap-3 break-all">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && (!active || !compatible || loading || error !== null)}
                onChange={(event) => {
                  if (event.target.checked && (!active || !compatible || loading || error)) return;
                  onChange(
                    event.target.checked
                      ? [...new Set([...selectedIds, id])]
                      : selectedIds.filter((value) => value !== id),
                  );
                }}
                className="h-5 w-5 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet"
              />
              <span>
                {id}
                {!compatible
                  ? ' (no disponible para asignar)'
                  : !active
                    ? ' (asignación actual; no disponible para nuevas asignaciones)'
                    : ''}
              </span>
            </label>
          );
        },
      )}
    </fieldset>
  );
}
