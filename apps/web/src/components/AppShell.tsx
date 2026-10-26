import React, { useEffect, useState, useCallback } from 'react';
import { DEFAULT_DEV_IDENTITY } from '../services/dev-identity.js';
import type { HealthResponse, ProjectResponse, CreateProjectRequest } from '@is488/shared';
import { fetchSystemHealth } from '../services/health.service.js';
import { fetchProjects, createProject } from '../services/project.service.js';
import { ProjectList } from './ProjectList.js';
import { CreateProjectModal } from './CreateProjectModal.js';
import { ProjectDetail } from './ProjectDetail.js';
import {
  GraduationCap,
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Server,
  Layers,
  FolderKanban,
  Info,
  UserCheck,
} from 'lucide-react';

export interface AppShellProps {
  healthFetcher?: () => Promise<HealthResponse>;
  projectsFetcher?: () => Promise<ProjectResponse[]>;
  projectCreator?: (data: CreateProjectRequest) => Promise<ProjectResponse>;
}

type HealthState =
  | { status: 'loading' }
  | { status: 'success'; data: HealthResponse }
  | { status: 'error'; message: string };

const defaultProjectsFetcher = () => fetchProjects();
const defaultProjectCreator = (data: CreateProjectRequest) => createProject(data);

/**
 * Shell principal accesible de la aplicación que muestra la identidad institucional,
 * el estado operativo del backend (/api/health) y el gestor de proyectos académicos.
 */
export const AppShell: React.FC<AppShellProps> = ({
  healthFetcher = fetchSystemHealth,
  projectsFetcher = defaultProjectsFetcher,
  projectCreator = defaultProjectCreator,
}) => {
  const [healthState, setHealthState] = useState<HealthState>({ status: 'loading' });

  // Estado de proyectos
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectResponse | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthState({ status: 'loading' });
    try {
      const data = await healthFetcher();
      setHealthState({ status: 'success', data });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error desconocido al conectar con el servidor';
      setHealthState({ status: 'error', message });
    }
  }, [healthFetcher]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setProjectsError(null);
    try {
      const data = await projectsFetcher();
      setProjects(data);
    } catch (err) {
      setProjectsError(
        err instanceof Error ? err.message : 'Error al cargar los proyectos académicos',
      );
    } finally {
      setLoadingProjects(false);
    }
  }, [projectsFetcher]);

  const handleCreateProject = async (data: CreateProjectRequest) => {
    const created = await projectCreator(data);
    setProjects((prev) => [created, ...prev]);
  };

  useEffect(() => {
    void loadHealth();
    void loadProjects();
  }, [loadHealth, loadProjects]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {/* Encabezado institucional */}
      <header className="border-b border-slate-200 bg-white shadow-sm" role="banner">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-unsch-garnet text-white shadow-sm">
              <GraduationCap className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight text-slate-900 sm:text-xl">
                Sistema de Seguimiento de Proyectos Académicos
              </h1>
              <p className="text-xs font-medium text-slate-500">
                UNSCH · Escuela Profesional de Ingeniería de Sistemas (IS488)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <span className="hidden items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 border border-amber-200 sm:inline-flex">
              <UserCheck className="mr-1.5 h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
              Sesión Dev: {DEFAULT_DEV_IDENTITY.userId} (Estudiante)
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              <Layers className="mr-1.5 h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              v0.1.0
            </span>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Sección de Gestión de Proyectos Académicos */}
        <section aria-labelledby="projects-section-title">
          {selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              currentUserId={DEFAULT_DEV_IDENTITY.userId}
              onBack={() => setSelectedProject(null)}
            />
          ) : (
            <>
              <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center space-x-2">
                    <FolderKanban className="h-6 w-6 text-unsch-garnet" aria-hidden="true" />
                    <h2
                      id="projects-section-title"
                      className="text-xl font-bold tracking-tight text-slate-900"
                    >
                      Gestión de Proyectos Académicos
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Crea y monitorea tus proyectos asignados con cronogramas y trazabilidad
                    académica.
                  </p>
                </div>

                {/* Aviso de persistencia volátil en memoria */}
                <div className="inline-flex items-center rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-800 border border-blue-200">
                  <Info className="mr-1.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                  <span>Modo desarrollo: almacenamiento volátil en memoria RAM (ADR-003).</span>
                </div>
              </div>

              <ProjectList
                projects={projects}
                loading={loadingProjects}
                error={projectsError}
                onRetry={loadProjects}
                onOpenCreateModal={() => setIsModalOpen(true)}
                onSelectProject={(p) => setSelectedProject(p)}
              />
            </>
          )}
        </section>

        {/* Tarjeta de estado de salud del sistema */}
        <section
          aria-labelledby="health-card-title"
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center space-x-2">
              <Server className="h-5 w-5 text-unsch-garnet" aria-hidden="true" />
              <h3 id="health-card-title" className="text-base font-semibold text-slate-900">
                Diagnóstico de Disponibilidad Operativa
              </h3>
            </div>

            <button
              type="button"
              onClick={() => void loadHealth()}
              disabled={healthState.status === 'loading'}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2 disabled:opacity-50"
              aria-label="Reintentar comprobación de salud del sistema"
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${healthState.status === 'loading' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Actualizar
            </button>
          </div>

          <div className="mt-6">
            {healthState.status === 'loading' && (
              <div
                role="status"
                aria-live="polite"
                aria-busy="true"
                className="flex items-center space-x-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-blue-900"
              >
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
                <span className="text-sm font-medium">
                  Consultando disponibilidad operativa en el backend (/api/health)...
                </span>
              </div>
            )}

            {healthState.status === 'success' && (
              <div
                role="status"
                aria-live="polite"
                className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4"
              >
                <div className="flex items-center space-x-2.5">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  <span className="text-sm font-semibold text-emerald-900">
                    Backend conectado y operativo
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                    {healthState.data.status.toUpperCase()}
                  </span>
                </div>

                <dl className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
                  <div className="rounded-md border border-emerald-100 bg-white p-3">
                    <dt className="text-slate-500">Versión del sistema</dt>
                    <dd className="mt-1 font-mono font-semibold text-slate-900">
                      {healthState.data.version}
                    </dd>
                  </div>
                  <div className="rounded-md border border-emerald-100 bg-white p-3">
                    <dt className="text-slate-500">Marca temporal del servidor (UTC)</dt>
                    <dd className="mt-1 font-mono font-semibold text-slate-900">
                      {healthState.data.timestamp}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {healthState.status === 'error' && (
              <div
                role="alert"
                aria-live="assertive"
                className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/50 p-4 text-rose-900"
              >
                <div className="flex items-center space-x-2.5">
                  <AlertCircle className="h-6 w-6 text-rose-600" aria-hidden="true" />
                  <span className="text-sm font-semibold text-rose-900">
                    No fue posible conectar con el backend
                  </span>
                </div>
                <p className="text-xs text-rose-700">{healthState.message}</p>
                <div>
                  <button
                    type="button"
                    onClick={() => void loadHealth()}
                    className="inline-flex items-center rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
                  >
                    Reintentar conexión
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Guía informativa de la línea base */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center space-x-2 text-slate-900">
            <Activity className="h-5 w-5 text-slate-600" aria-hidden="true" />
            <h3 className="text-base font-semibold">Arquitectura y Gobernanza</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Esta interfaz integra el primer flujo vertical de negocio académico. El frontend SPA en
            React y Vite consume la API en Cloudflare Workers / Hono validada con contratos Zod en{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800">
              @is488/shared
            </code>
            . Las consultas de proyectos aplican aislamiento estricto en el servidor y operan sobre
            un repositorio en memoria antes de evaluar el spike técnico de PostgreSQL (ADR-003).
          </p>
        </section>
      </main>

      {/* Modal de creación de proyecto */}
      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateProject}
      />

      {/* Pie de página */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-4" role="contentinfo">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-slate-500 sm:px-6 lg:px-8">
          Sistema de Seguimiento de Proyectos Académicos · Escuela Profesional de Ingeniería de
          Sistemas · UNSCH 2026
        </div>
      </footer>
    </div>
  );
};
