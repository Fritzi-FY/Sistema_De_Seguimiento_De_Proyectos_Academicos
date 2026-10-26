import {
  type CreateProjectRequest,
  type ProjectResponse,
  type ProjectListResponse,
  ProjectResponseSchema,
  ProjectListResponseSchema,
  CreateProjectRequestSchema,
} from '@is488/shared';

export interface DevUserHeaders {
  userId?: string;
  role?: string;
}

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

/**
 * Consulta la lista de proyectos académicos autorizados para el usuario.
 */
export async function fetchProjects(userHeaders?: DevUserHeaders): Promise<ProjectListResponse> {
  const response = await fetch('/api/projects', {
    method: 'GET',
    headers: buildHeaders(userHeaders),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ??
        `Error al consultar proyectos: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = ProjectListResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta inválida del servidor: ${issues}`);
  }

  return parsed.data;
}

/**
 * Envía la solicitud de creación de un nuevo proyecto académico al backend.
 */
export async function createProject(
  data: CreateProjectRequest,
  userHeaders?: DevUserHeaders,
): Promise<ProjectResponse> {
  // Validación previa en cliente usando el esquema compartido
  const validation = CreateProjectRequestSchema.safeParse(data);
  if (!validation.success) {
    const message = validation.error.issues.map((i) => i.message).join('. ');
    throw new Error(message);
  }

  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: buildHeaders(userHeaders),
    body: JSON.stringify(validation.data),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      message?: string;
      details?: Array<{ message?: string }>;
    } | null;

    if (errorBody?.details && errorBody.details.length > 0) {
      const detailsMsg = errorBody.details
        .map((d) => d.message)
        .filter(Boolean)
        .join('. ');
      throw new Error(detailsMsg || errorBody.message || 'Error al crear el proyecto');
    }

    throw new Error(
      errorBody?.message ?? `Error al crear proyecto: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = ProjectResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta del servidor no válida según contrato: ${issues}`);
  }

  return parsed.data;
}
