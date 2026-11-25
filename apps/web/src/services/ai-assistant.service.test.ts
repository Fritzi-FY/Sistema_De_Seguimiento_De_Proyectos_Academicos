import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIAnalysisResponse } from '@is488/shared';
import {
  generateProjectAISummary,
  getProjectAICapabilities,
  AIAssistantServiceError,
} from './ai-assistant.service.js';

describe('AIAssistantService', () => {
  const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const mockSuccessResponse: AIAnalysisResponse = {
    projectId,
    analysis: {
      progressSummary: 'El equipo ha completado el 60% de las tareas del sprint actual.',
      riskSignals: ['Dos tareas críticas tienen fecha de entrega en menos de 48 horas.'],
      nextSteps: ['Completar la revisión de código pendiente', 'Actualizar el tablero Kanban'],
    },
    meta: {
      model: 'google/gemini-2.0-flash-lite:free',
      generatedAt: '2026-11-20T10:00:00.000Z',
      disclaimer:
        'Orientación formativa generada por IA. No constituye calificación ni evaluación académica oficial.',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna la respuesta validada en caso de HTTP 200 OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockSuccessResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await generateProjectAISummary(projectId);
    expect(result).toEqual(mockSuccessResponse);
  });

  it('envía el enfoque por defecto "full" si no se especifica', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockSuccessResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await generateProjectAISummary(projectId);

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/projects/${projectId}/ai/analysis`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ focus: 'full' }),
      }),
    );
  });

  it('mapea HTTP 400 a mensaje descriptivo de solicitud inválida', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Bad Request' }), { status: 400 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 400,
      userMessage: expect.stringContaining('Parámetros de solicitud inválidos'),
    });
  });

  it('mapea HTTP 401 a mensaje de sesión requerida', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 401,
      userMessage: expect.stringContaining('Sesión no autenticada'),
    });
  });

  it('mapea HTTP 403 a mensaje de permisos insuficientes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 403,
      userMessage: expect.stringContaining('No tiene permisos'),
    });
  });

  it('mapea HTTP 404 a mensaje de proyecto no encontrado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 404,
      userMessage: expect.stringContaining('no fue encontrado'),
    });
  });

  it('mapea HTTP 429 con IN_FLIGHT_CONFLICT a mensaje de análisis en curso', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Too Many Requests',
          reason: 'IN_FLIGHT_CONFLICT',
          retryAfterSeconds: 30,
        }),
        { status: 429 },
      ),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 429,
      reason: 'IN_FLIGHT_CONFLICT',
      retryAfterSeconds: 30,
      userMessage: expect.stringContaining('análisis en curso'),
    });
  });

  it('mapea HTTP 429 con RATE_LIMIT_EXCEEDED a mensaje de cuota con minutos estimados', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Too Many Requests',
          reason: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds: 480,
        }),
        { status: 429 },
      ),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 429,
      reason: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 480,
      userMessage: expect.stringContaining('8 minuto(s)'),
    });
  });

  it('mapea HTTP 502 a mensaje de formato de respuesta inválido', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Bad Gateway' }), { status: 502 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 502,
      userMessage: expect.stringContaining('no tiene un formato válido'),
    });
  });

  it('mapea HTTP 503 a mensaje de servicio no disponible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 503,
      userMessage: expect.stringContaining('no se encuentra disponible temporalmente'),
    });
  });

  it('mapea HTTP 504 a mensaje de tiempo límite de 8 segundos agotado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Gateway Timeout' }), { status: 504 }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toMatchObject({
      status: 504,
      userMessage: expect.stringContaining('8 segundos agotado'),
    });
  });

  it('lanza error si la respuesta HTTP 200 no cumple el esquema del contrato', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ broken: 'payload' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(generateProjectAISummary(projectId)).rejects.toBeInstanceOf(
      AIAssistantServiceError,
    );
  });

  it('consulta getProjectAICapabilities y valida la respuesta', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ projectId, canUseAIAssistant: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await getProjectAICapabilities(projectId);
    expect(result).toEqual({ projectId, canUseAIAssistant: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/ai/capabilities`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('lanza AIAssistantServiceError(502) si getProjectAICapabilities recibe payload inválido', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ projectId, canUseAIAssistant: 'yes' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getProjectAICapabilities(projectId)).rejects.toMatchObject({
      status: 502,
    });
  });
});
