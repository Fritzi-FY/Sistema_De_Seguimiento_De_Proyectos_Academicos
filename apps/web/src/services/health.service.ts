import { HealthResponseSchema, type HealthResponse } from '@is488/shared';

/**
 * Consulta el endpoint de diagnóstico de salud del backend (/api/health)
 * y valida la respuesta contra el contrato canónico compartido.
 */
export async function fetchSystemHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Error en la consulta de diagnóstico: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const parsed = HealthResponseSchema.safeParse(payload);

  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((i) => i.message).join(', ');
    throw new Error(`Respuesta inválida según el contrato de salud: ${errorDetails}`);
  }

  return parsed.data;
}
