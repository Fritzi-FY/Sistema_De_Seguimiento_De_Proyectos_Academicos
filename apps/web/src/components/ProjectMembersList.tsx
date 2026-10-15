import React from 'react';
import type { MembershipResponse } from '@is488/shared';
import { Users, User, Shield, UserMinus, Loader2, AlertCircle } from 'lucide-react';

export interface ProjectMembersListProps {
  members: MembershipResponse[];
  loading: boolean;
  error?: string | null;
  isCreator: boolean;
  onRemoveMember?: (userId: string) => Promise<void>;
  removingUserId?: string | null;
  onRetry?: () => void;
}

function formatUtcDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('es-PE', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString.split('T')[0] ?? isoString;
  }
}

export const ProjectMembersList: React.FC<ProjectMembersListProps> = ({
  members,
  loading,
  error,
  isCreator,
  onRemoveMember,
  removingUserId,
  onRetry,
}) => {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="members-loading-skeleton"
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin text-unsch-garnet" aria-hidden="true" />
          <span className="text-sm font-medium text-slate-700">Cargando integrantes...</span>
        </div>
        <div className="space-y-2 pt-2 animate-pulse">
          <div className="h-10 rounded-lg bg-slate-100" />
          <div className="h-10 rounded-lg bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm"
      >
        <div className="flex items-center space-x-2 text-rose-800">
          <AlertCircle className="h-5 w-5 text-rose-600" aria-hidden="true" />
          <span className="text-sm font-semibold">Error al cargar integrantes</span>
        </div>
        <p className="mt-1 text-xs text-rose-700">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div
        data-testid="empty-members-state"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center"
      >
        <Users className="h-8 w-8 text-slate-400" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-slate-700">No hay integrantes registrados</p>
        <p className="text-xs text-slate-500">Este proyecto no cuenta con integrantes activos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="members-list">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100" role="list">
          {members.map((member) => {
            const isOwner = member.role === 'owner';
            const isRemoving = removingUserId === member.userId;

            return (
              <li
                key={member.id}
                data-testid={`member-row-${member.userId}`}
                className="flex items-center justify-between p-4 transition hover:bg-slate-50/70"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      isOwner ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {isOwner ? (
                      <Shield className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <User className="h-4 w-4" aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {member.userId}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          isOwner
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-blue-50 text-blue-800 border border-blue-200'
                        }`}
                      >
                        {isOwner ? 'Propietario' : 'Colaborador'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Incorporado el {formatUtcDate(member.joinedAt)}
                    </p>
                  </div>
                </div>

                {isCreator && !isOwner && onRemoveMember && (
                  <button
                    type="button"
                    onClick={() => void onRemoveMember(member.userId)}
                    disabled={isRemoving}
                    data-testid={`remove-member-btn-${member.userId}`}
                    className="inline-flex items-center rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
                    aria-label={`Retirar al integrante ${member.userId}`}
                  >
                    {isRemoving ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <UserMinus className="mr-1.5 h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                    )}
                    Retirar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
