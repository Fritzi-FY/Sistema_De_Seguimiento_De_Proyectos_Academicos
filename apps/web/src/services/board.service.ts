import {
  type BoardResponse,
  BoardResponseSchema,
  BoardColumnResponseSchema,
  CreateBoardColumnSchema,
  UpdateBoardColumnSchema,
  DeleteBoardColumnQuerySchema,
  type CreateBoardColumnRequest,
  type UpdateBoardColumnRequest,
  type DeleteBoardColumnQuery,
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

/**
 * Consulta el tablero Kanban y sus columnas configuradas para un proyecto académico.
 */
export async function getBoard(
  projectId: string,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<BoardResponse> {
  const response = await fetch(`/api/projects/${projectId}/board`, {
    method: 'GET',
    headers: buildHeaders(userHeaders),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ??
        `Error al consultar tablero del proyecto: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = BoardResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta inválida del servidor según contrato de tablero: ${issues}`);
  }

  if (
    parsed.data.projectId !== projectId ||
    parsed.data.columns.some((column) => column.boardId !== parsed.data.id)
  ) {
    throw new Error('El tablero recibido no corresponde al proyecto solicitado');
  }
  return parsed.data;
}

async function columnRequest(
  projectId: string,
  columnId: string | undefined,
  method: string,
  data: unknown,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
) {
  const response = await fetch(
    `/api/projects/${projectId}/board/columns${columnId ? `/${columnId}` : ''}`,
    {
      method,
      headers: buildHeaders(userHeaders),
      body: JSON.stringify(data),
      signal: options?.signal,
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `No se pudo modificar la columna (${response.status})`);
  }
  return BoardColumnResponseSchema.parse(await response.json());
}

export async function createBoardColumn(
  projectId: string,
  boardId: string,
  data: CreateBoardColumnRequest,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
) {
  const column = await columnRequest(
    projectId,
    undefined,
    'POST',
    CreateBoardColumnSchema.parse(data),
    userHeaders,
    options,
  );
  if (column.boardId !== boardId) throw new Error('La columna recibida pertenece a otro tablero');
  return column;
}

export async function updateBoardColumn(
  projectId: string,
  boardId: string,
  columnId: string,
  data: UpdateBoardColumnRequest,
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
) {
  const column = await columnRequest(
    projectId,
    columnId,
    'PATCH',
    UpdateBoardColumnSchema.parse(data),
    userHeaders,
    options,
  );
  if (column.boardId !== boardId || column.id !== columnId)
    throw new Error('La respuesta no corresponde a la columna solicitada');
  return column;
}

export interface DeleteBoardColumnResult {
  success: true;
  deletedColumnId: string;
  migratedTasksCount: number;
}

export async function deleteBoardColumn(
  projectId: string,
  columnId: string,
  query: DeleteBoardColumnQuery = {},
  userHeaders?: DevUserHeaders,
  options?: RequestOptions,
): Promise<DeleteBoardColumnResult> {
  const parsed = DeleteBoardColumnQuerySchema.parse(query);
  const suffix = parsed.targetColumnId
    ? `?${new URLSearchParams({ targetColumnId: parsed.targetColumnId })}`
    : '';
  const response = await fetch(`/api/projects/${projectId}/board/columns/${columnId}${suffix}`, {
    method: 'DELETE',
    headers: buildHeaders(userHeaders),
    signal: options?.signal,
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `No se pudo eliminar la columna (${response.status})`);
  }
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('success' in result) ||
    result.success !== true ||
    !('deletedColumnId' in result) ||
    result.deletedColumnId !== columnId ||
    !BoardColumnResponseSchema.shape.id.safeParse(result.deletedColumnId).success ||
    !('migratedTasksCount' in result) ||
    typeof result.migratedTasksCount !== 'number' ||
    !Number.isInteger(result.migratedTasksCount) ||
    result.migratedTasksCount < 0
  ) {
    throw new Error('Respuesta de eliminación inválida o de otra columna');
  }
  return result as DeleteBoardColumnResult;
}

export const BoardService = {
  getBoard,
  createBoardColumn,
  updateBoardColumn,
  deleteBoardColumn,
};
