import React from 'react';
import type { ProjectResponse } from '@is488/shared';
import {
  FolderKanban,
  Calendar,
  Clock,
  User,
  AlertCircle,
  Loader2,
  RefreshCw,
  PlusCircle,
} from 'lucide-react';

export interface ProjectListProps {
  projects: ProjectResponse[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenCreateModal: () => void;
}

function formatUtcDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('es-PE', { timeZone: 'UTC' });
  } catch {
    return isoString.split('T')[0] ?? isoString;
  }
}

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  loading,
  error,
  onRetry,
  onOpenCreateModal,
}) => {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm"
      >
        <Loader2 className="h-8 w-8 animate-spin text-unsch-garnet" aria-hidden="true" />
        <p className="mt-4 text-sm font-medium text-slate-700">Cargando proyectos académicos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-xl border border-rose-200 bg-rose-50/60 p-6 shadow-sm"
      >
        <div className="flex items-center space-x-3">
          <AlertCircle className="h-6 w-6 text-rose-600" aria-hidden="true" />
          <h4 className="text-base font-semibold text-rose-900">Error al cargar proyectos</h4>
        </div>
        <p className="mt-2 text-sm text-rose-700">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Reintentar consulta
        </button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div
        data-testid="empty-projects-state"
        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-12 text-center shadow-sm"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <FolderKanban className="h-7 w-7" aria-hidden="true" />
        </div>
        <h4 className="mt-4 text-base font-semibold text-slate-900">
          No hay proyectos registrados
        </h4>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          Actualmente no tienes proyectos creados ni asignados. Comienza registrando tu primer
          proyecto académico para el curso.
        </p>
        <button
          type="button"
          onClick={onOpenCreateModal}
          className="mt-5 inline-flex items-center rounded-lg bg-unsch-garnet px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-unsch-garnet/90 focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2"
        >
          <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          Crear Proyecto
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">
          Tus Proyectos Académicos ({projects.length})
        </h3>
        <button
          type="button"
          onClick={onOpenCreateModal}
          className="inline-flex items-center rounded-lg bg-unsch-garnet px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-unsch-garnet/90 focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2"
        >
          <PlusCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Nuevo Proyecto
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <article
            key={project.id}
            data-testid={`project-card-${project.id}`}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                  {project.courseCode}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    project.status === 'active'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {project.status === 'active' ? 'Activo' : 'Archivado'}
                </span>
              </div>

              <h4
                className="mt-3 text-base font-bold text-slate-900 line-clamp-2"
                title={project.title}
              >
                {project.title}
              </h4>

              {project.description && (
                <p className="mt-2 text-xs text-slate-600 line-clamp-3 leading-relaxed">
                  {project.description}
                </p>
              )}
            </div>

            <div className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center">
                  <Calendar className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  Inicio:
                </span>
                <span className="font-mono font-medium text-slate-700">
                  {formatUtcDate(project.startDate)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center">
                  <Clock className="mr-1.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  Entrega:
                </span>
                <span className="font-mono font-medium text-slate-700">
                  {formatUtcDate(project.targetDate)}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
                <span className="flex items-center">
                  <User className="mr-1 h-3 w-3" aria-hidden="true" />
                  Creador:
                </span>
                <span className="font-mono text-slate-600 truncate max-w-[120px]">
                  {project.creatorId}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};
