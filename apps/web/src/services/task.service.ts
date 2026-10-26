import {
  type CreateTaskRequest,
  type TaskResponse,
  type PaginatedTasksResponse,
  TaskActivityListResponseSchema,
  type TaskActivityListResponse,
  type ListTasksQuery,
  type UpdateTaskRequest,
  CreateTaskSchema,
  UpdateTaskSchema,
  MoveTaskSchema,
  type MoveTaskRequest,
  PaginatedTasksResponseSchema,
  TaskResponseSchema,
} from '@is488/shared';
import type { DevUserHeaders } from './project.service.js';

import { DEFAULT_DEV_IDENTITY } from './dev-identity.js';

const DEFAULT_DEV_HEADERS: DevUserHeaders = DEFAULT_DEV_IDENTITY;

function buildHeaders(userHeaders?: DevUserHeaders): HeadersInit {
  const current = { ...DEFAULT_DEV_HEADERS, ...userHeaders };
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Dev-User-Id': current.userId ?? DEFAULT_DEV_IDENTITY.userId,
    'X-Dev-User-Role': current.role ?? DEFAULT_DEV_IDENTITY.role,
  };
}

export interface RequestOptions {
  signal?: AbortSignal;
}

const MAX_TASKS_PAGE_LIMIT = 100;

/**
 * Consulta una página de tareas de un proyecto académico según los filtros especificados.
 */
export async function getTasks(
  projectId: string,
  query?: ListTasksQuery,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<PaginatedTasksResponse> {
  const params = new URLSearchParams();
  if (query?.page !== undefined) params.set('page', String(query.page));
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.columnId !== undefined) params.set('columnId', query.columnId);
  if (query?.priority !== undefined) params.set('priority', query.priority);
  if (query?.assigneeId !== undefined) params.set('assigneeId', query.assigneeId);
  if (query?.label !== undefined) params.set('label', query.label);
  if (query?.search !== undefined) params.set('search', query.search);

  const queryString = params.toString();
  const url = `/api/projects/${projectId}/tasks${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(userHeaders),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ??
        `Error al consultar tareas del proyecto: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = PaginatedTasksResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta inválida del servidor según contrato de tareas: ${issues}`);
  }

  return parsed.data;
}

/**
 * Crea una tarea y valida tanto el payload enviado como la respuesta recibida.
 */
export async function createTask(
  projectId: string,
  data: CreateTaskRequest,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<TaskResponse> {
  const validation = CreateTaskSchema.safeParse(data);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Datos inválidos para crear la tarea: ${issues}`);
  }

  const response = await fetch(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: buildHeaders(userHeaders),
    body: JSON.stringify(validation.data),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ?? `Error al crear la tarea: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = TaskResponseSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Respuesta inválida del servidor al crear la tarea: ${issues}`);
  }

  return parsed.data;
}

export async function updateTask(
  projectId: string,
  taskId: string,
  data: UpdateTaskRequest,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<TaskResponse> {
  const validation = UpdateTaskSchema.safeParse(data);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Datos inválidos para actualizar la tarea: ${issues}`);
  }

  const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: buildHeaders(userHeaders),
    body: JSON.stringify(validation.data),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ??
        `Error al actualizar la tarea: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = TaskResponseSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Respuesta inválida del servidor al actualizar la tarea: ${issues}`);
  }

  if (parsed.data.id !== taskId || parsed.data.projectId !== projectId) {
    throw new Error('La respuesta de actualización no corresponde a la tarea solicitada');
  }

  return parsed.data;
}

export async function moveTask(
  projectId: string,
  taskId: string,
  data: MoveTaskRequest,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<TaskResponse> {
  const validation = MoveTaskSchema.safeParse(data);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Datos inválidos para mover la tarea: ${issues}`);
  }

  const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/move`, {
    method: 'POST',
    headers: buildHeaders(userHeaders),
    body: JSON.stringify(validation.data),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ?? `Error al mover la tarea: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = TaskResponseSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Respuesta inválida del servidor al mover la tarea: ${issues}`);
  }

  if (parsed.data.id !== taskId || parsed.data.projectId !== projectId) {
    throw new Error('La respuesta de movimiento no corresponde a la tarea solicitada');
  }

  return parsed.data;
}

/**
 * Carga exhaustivamente todas las tareas de un proyecto recorriendo todas las páginas necesarias,
 * respetando el límite máximo de 100 tareas por petición sin presentar datos parciales incompletos.
 * Si alguna página falla, la operación completa es rechazada.
 */
export async function getAllProjectTasks(
  projectId: string,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<TaskResponse[]> {
  const firstPage = await getTasks(
    projectId,
    { page: 1, limit: MAX_TASKS_PAGE_LIMIT },
    userHeaders,
    options,
  );

  if (firstPage.totalPages <= 1) {
    return firstPage.items;
  }

  const allTasks: TaskResponse[] = [...firstPage.items];

  for (let currentPage = 2; currentPage <= firstPage.totalPages; currentPage++) {
    const pageResult = await getTasks(
      projectId,
      { page: currentPage, limit: MAX_TASKS_PAGE_LIMIT },
      userHeaders,
      options,
    );
    allTasks.push(...pageResult.items);
  }

  return allTasks;
}

export const TaskService = {
  getTaskActivity,
  createTask,
  updateTask,
  moveTask,
  getTasks,
  getAllProjectTasks,
};

export async function getTaskActivity(
  projectId: string,
  taskId: string,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<TaskActivityListResponse> {
  const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/activity`, {
    method: 'GET',
    headers: buildHeaders(userHeaders),
    signal: options?.signal,
  });
  if (!response.ok) throw new Error(`No se pudo consultar el historial (${response.status})`);
  const events = TaskActivityListResponseSchema.parse(await response.json());
  if (events.some((event) => event.projectId !== projectId || event.taskId !== taskId))
    throw new Error('El historial no corresponde a la tarea solicitada');
  return events;
}
