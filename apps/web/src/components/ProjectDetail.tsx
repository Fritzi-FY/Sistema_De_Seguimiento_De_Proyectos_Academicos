import React, { useState, useEffect, useCallback } from 'react';
import { DEFAULT_DEV_IDENTITY } from '../services/dev-identity.js';
import type {
  ProjectResponse,
  MembershipResponse,
  AddMemberRequest,
  BoardResponse,
  TaskResponse,
} from '@is488/shared';
import { getMembers, addMember, removeMember } from '../services/membership.service.js';
import { getBoard } from '../services/board.service.js';
import { getAllProjectTasks } from '../services/task.service.js';
import { ProjectMembersList } from './ProjectMembersList.js';
import { AddMemberModal } from './AddMemberModal.js';
import { KanbanBoard } from './KanbanBoard.js';
import { TaskListView, type TaskPageFetcher } from './TaskListView.js';
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  FolderKanban,
  UserPlus,
  ShieldAlert,
} from 'lucide-react';

export interface ProjectDetailProps {
  taskPageFetcher?: TaskPageFetcher;
  project: ProjectResponse;
  currentUserId?: string;
  onBack: () => void;
  membersFetcher?: (projectId: string) => Promise<MembershipResponse[]>;
  memberAdder?: (projectId: string, data: AddMemberRequest) => Promise<MembershipResponse>;
  memberRemover?: (projectId: string, userId: string) => Promise<MembershipResponse>;
  boardFetcher?: (projectId: string, options?: { signal?: AbortSignal }) => Promise<BoardResponse>;
  tasksFetcher?: (projectId: string, options?: { signal?: AbortSignal }) => Promise<TaskResponse[]>;
}

const defaultBoardFetcher = (id: string, options?: { signal?: AbortSignal }) =>
  getBoard(id, undefined, options);
const defaultTasksFetcher = (id: string, options?: { signal?: AbortSignal }) =>
  getAllProjectTasks(id, undefined, options);

function formatUtcDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('es-PE', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoString.split('T')[0] ?? isoString;
  }
}

export const ProjectDetail: React.FC<ProjectDetailProps> = (props) => (
  <ProjectDetailContent key={props.project.id} {...props} />
);

const ProjectDetailContent: React.FC<ProjectDetailProps> = ({
  project,
  currentUserId = DEFAULT_DEV_IDENTITY.userId,
  onBack,
  membersFetcher = getMembers,
  memberAdder = addMember,
  memberRemover = removeMember,
  boardFetcher = defaultBoardFetcher,
  tasksFetcher = defaultTasksFetcher,
  taskPageFetcher,
}) => {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingOperation, setPendingOperation] = useState(false);
  const [members, setMembers] = useState<MembershipResponse[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const isCreator = project.creatorId === currentUserId;

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const data = await membersFetcher(project.id);
      setMembers(data);
    } catch (err) {
      setMembersError(
        err instanceof Error ? err.message : 'Error al cargar los integrantes del proyecto',
      );
    } finally {
      setLoadingMembers(false);
    }
  }, [membersFetcher, project.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleAddMember = async (data: AddMemberRequest) => {
    const created = await memberAdder(project.id, data);
    setMembers((prev) => [...prev, created]);
  };

  const handleRemoveMember = async (userId: string) => {
    setRemovingUserId(userId);
    try {
      await memberRemover(project.id, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al retirar integrante');
    } finally {
      setRemovingUserId(null);
    }
  };

  return (
    <article
      data-testid="project-detail-view"
      className="space-y-6"
      aria-labelledby="project-detail-title"
    >
      {/* Botón de volver */}
      <div>
        <button
          type="button"
          onClick={onBack}
          data-testid="back-to-list-btn"
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Volver a la lista
        </button>
      </div>

      {/* Encabezado y resumen del proyecto */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-800">
                {project.courseCode}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  project.status === 'active'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {project.status === 'active' ? 'Activo' : 'Archivado'}
              </span>
              {isCreator && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                  Eres el Propietario
                </span>
              )}
            </div>

            <h2
              id="project-detail-title"
              className="text-2xl font-bold tracking-tight text-slate-900"
            >
              {project.title}
            </h2>

            {project.description && (
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
                {project.description}
              </p>
            )}
          </div>

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-unsch-garnet/10 text-unsch-garnet">
            <FolderKanban className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>

        {/* Cronograma y metadatos */}
        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <div className="flex items-center space-x-2.5 text-xs text-slate-600">
            <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <div>
              <span className="block text-[11px] font-medium text-slate-400">Fecha de Inicio</span>
              <span className="font-semibold text-slate-800">
                {formatUtcDate(project.startDate)}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 text-xs text-slate-600">
            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <div>
              <span className="block text-[11px] font-medium text-slate-400">
                Fecha Estimada de Entrega
              </span>
              <span className="font-semibold text-slate-800">
                {formatUtcDate(project.targetDate)}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 text-xs text-slate-600">
            <User className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <div>
              <span className="block text-[11px] font-medium text-slate-400">Creado por</span>
              <span className="font-mono font-semibold text-slate-800 truncate max-w-[150px] inline-block">
                {project.creatorId}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Sección del Tablero Kanban */}
      <section aria-labelledby="kanban-section-title" className="space-y-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3
              id="kanban-section-title"
              className="text-lg font-bold tracking-tight text-slate-900"
            >
              {view === 'board' ? 'Tablero de Tareas Kanban' : 'Lista de tareas'}
            </h3>
            <p className="text-xs text-slate-500">
              Seguimiento visual del flujo de trabajo y estado de las tareas del proyecto académico.
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Vista de tareas"
          aria-describedby={pendingOperation ? 'task-view-pending' : undefined}
          className="flex flex-wrap items-center gap-3"
        >
          {(['board', 'list'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              disabled={pendingOperation}
              onClick={() => {
                if (!pendingOperation) setView(value);
              }}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 aria-pressed:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-unsch-garnet disabled:cursor-not-allowed disabled:opacity-50"
            >
              {value === 'board' ? 'Tablero' : 'Lista'}
            </button>
          ))}
          <button
            type="button"
            disabled={pendingOperation}
            aria-label={
              view === 'board' ? 'Actualizar vista de tablero' : 'Actualizar vista de lista'
            }
            onClick={() => {
              if (!pendingOperation) setRefreshKey((value) => value + 1);
            }}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-unsch-garnet disabled:opacity-50"
          >
            Actualizar {view === 'board' ? 'tablero' : 'lista'}
          </button>
          <span className="text-sm text-slate-700">
            {view === 'board'
              ? 'Arrastra tareas o gestiona las columnas.'
              : 'Consulta tareas y aplica filtros.'}
          </span>
        </div>
        {pendingOperation && (
          <p id="task-view-pending" role="status">
            Operación de tarea pendiente o cambio de columnas pendiente. Espera a que termine para
            cambiar de vista.
          </p>
        )}
        {view === 'board' ? (
          <KanbanBoard
            refreshKey={refreshKey}
            projectId={project.id}
            boardFetcher={boardFetcher}
            tasksFetcher={tasksFetcher}
            onPendingChange={setPendingOperation}
            membersFetcher={membersFetcher}
          />
        ) : (
          <TaskListView
            refreshKey={refreshKey}
            projectId={project.id}
            tasksFetcher={taskPageFetcher}
            boardFetcher={boardFetcher}
          />
        )}
      </section>

      {/* Sección de integrantes */}
      <section aria-labelledby="members-section-title" className="space-y-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3
              id="members-section-title"
              className="text-lg font-bold tracking-tight text-slate-900"
            >
              Integrantes del Proyecto ({members.length})
            </h3>
            <p className="text-xs text-slate-500">
              Miembros con acceso concedido para colaborar en este proyecto académico.
            </p>
          </div>

          {isCreator ? (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              data-testid="open-add-member-modal-btn"
              className="inline-flex items-center rounded-lg bg-unsch-garnet px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-unsch-garnet/90 focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Agregar Integrante
            </button>
          ) : (
            <div className="inline-flex items-center rounded-lg bg-slate-100 px-3 py-1 text-xs text-slate-600">
              <ShieldAlert className="mr-1.5 h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>Solo el creador puede gestionar integrantes</span>
            </div>
          )}
        </div>

        <ProjectMembersList
          members={members}
          loading={loadingMembers}
          error={membersError}
          isCreator={isCreator}
          onRemoveMember={handleRemoveMember}
          removingUserId={removingUserId}
          onRetry={loadMembers}
        />
      </section>

      {/* Modal para agregar integrante */}
      <AddMemberModal
        isOpen={isModalOpen}
        isCreator={isCreator}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddMember}
      />
    </article>
  );
};
