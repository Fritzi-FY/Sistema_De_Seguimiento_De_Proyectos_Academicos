import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBoard, BoardService } from './board.service.js';
import type { BoardResponse } from '@is488/shared';

describe('board.service', () => {
  const sampleProjectId = '11111111-1111-4111-8111-111111111111';
  const sampleBoard: BoardResponse = {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: sampleProjectId,
    columns: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        boardId: '22222222-2222-4222-8222-222222222222',
        name: 'Por hacer',
        orderIndex: 0,
        category: 'TODO',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        boardId: '22222222-2222-4222-8222-222222222222',
        name: 'En progreso',
        orderIndex: 1,
        category: 'IN_PROGRESS',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
    ],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debe retornar el tablero validado cuando el backend responde 200 conforme al contrato', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => sampleBoard,
    } as Response);

    const result = await getBoard(sampleProjectId, {
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'student',
    });

    expect(result).toEqual(sampleBoard);
    expect(fetch).toHaveBeenCalledWith(`/api/projects/${sampleProjectId}/board`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Dev-User-Id': '11111111-1111-4111-8111-111111111111',
        'X-Dev-User-Role': 'student',
      },
      signal: undefined,
    });
  });

  it('debe pasar la señal AbortSignal en las opciones de la petición', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => sampleBoard,
    } as Response);

    const controller = new AbortController();
    await getBoard(sampleProjectId, undefined, { signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith(`/api/projects/${sampleProjectId}/board`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Dev-User-Id': '11111111-1111-4111-8111-111111111111',
        'X-Dev-User-Role': 'student',
      },
      signal: controller.signal,
    });
  });

  it('debe manejar error 404 cuando el tablero o proyecto no existe', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'Tablero no encontrado' }),
    } as Response);

    await expect(getBoard(sampleProjectId)).rejects.toThrow(/Tablero no encontrado/i);
  });

  it('debe rechazar con error descriptivo si el payload del servidor no cumple el esquema Zod', async () => {
    const invalidPayload = {
      id: 'not-a-uuid',
      projectId: sampleProjectId,
      columns: [],
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => invalidPayload,
    } as Response);

    await expect(getBoard(sampleProjectId)).rejects.toThrow(
      /Respuesta inválida del servidor según contrato de tablero/i,
    );
  });

  it('exporta BoardService como objeto envolvente', () => {
    expect(BoardService.getBoard).toBe(getBoard);
  });
});
