import {
  type AddMemberRequest,
  type MembershipResponse,
  type MemberListResponse,
  AddMemberRequestSchema,
  MembershipResponseSchema,
  MemberListResponseSchema,
} from '@is488/shared';
import type { DevUserHeaders } from './project.service.js';

const DEFAULT_DEV_HEADERS: DevUserHeaders = {
  userId: 'dev-student-01',
  role: 'student',
};

function buildHeaders(userHeaders?: DevUserHeaders): HeadersInit {
  const current = { ...DEFAULT_DEV_HEADERS, ...userHeaders };
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Dev-User-Id': current.userId ?? 'dev-student-01',
    'X-Dev-User-Role': current.role ?? 'student',
  };
}

/**
 * Consulta la lista de miembros activos de un proyecto académico.
 */
export async function getMembers(
  projectId: string,
  userHeaders?: DevUserHeaders,
): Promise<MemberListResponse> {
  const response = await fetch(`/api/projects/${projectId}/members`, {
    method: 'GET',
    headers: buildHeaders(userHeaders),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      errorBody?.message ??
        `Error al consultar miembros del proyecto: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = MemberListResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta inválida del servidor: ${issues}`);
  }

  return parsed.data;
}

/**
 * Agrega un nuevo colaborador al proyecto académico.
 */
export async function addMember(
  projectId: string,
  data: AddMemberRequest,
  userHeaders?: DevUserHeaders,
): Promise<MembershipResponse> {
  const validation = AddMemberRequestSchema.safeParse(data);
  if (!validation.success) {
    const message = validation.error.issues.map((i) => i.message).join('. ');
    throw new Error(message);
  }

  const response = await fetch(`/api/projects/${projectId}/members`, {
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
      throw new Error(detailsMsg || errorBody.message || 'Error al agregar miembro al proyecto');
    }

    throw new Error(
      errorBody?.message ??
        `Error al agregar miembro al proyecto: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = MembershipResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta del servidor no válida según contrato: ${issues}`);
  }

  return parsed.data;
}

/**
 * Retira a un colaborador del proyecto académico (cambia estado a 'removed').
 */
export async function removeMember(
  projectId: string,
  userId: string,
  userHeaders?: DevUserHeaders,
): Promise<MembershipResponse> {
  const response = await fetch(`/api/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
    headers: buildHeaders(userHeaders),
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
      throw new Error(detailsMsg || errorBody.message || 'Error al retirar miembro del proyecto');
    }

    throw new Error(
      errorBody?.message ??
        `Error al retirar miembro del proyecto: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = MembershipResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta del servidor no válida según contrato: ${issues}`);
  }

  return parsed.data;
}

export const MembershipService = {
  getMembers,
  addMember,
  removeMember,
};
