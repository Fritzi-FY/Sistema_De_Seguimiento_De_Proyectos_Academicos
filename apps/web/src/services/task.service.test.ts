import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTask,
  getTasks,
  getAllProjectTasks,
  TaskService,
  moveTask,
  updateTask,
} from './task.service.js';
import type { TaskResponse, PaginatedTasksResponse } from '@is488/shared';

describe('task.service', () => {
  const sampleProjectId = '11111111-1111-4111-8111-111111111111';
  const sampleColumnId = '22222222-2222-4222-8222-222222222222';

  const makeSampleTask = (id: string, orderIndex: number, title: string): TaskResponse => ({
    id,
    projectId: sampleProjectId,
    columnId: sampleColumnId,
    title,
    description: `Descripción de ${title}`,
    priority: 'MEDIUM',
    orderIndex,
    labels: ['frontend'],
    creatorId: '11111111-1111-4111-8111-111111111111',
    assigneeIds: [],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getTasks', () => {
    it('codifica los cuatro filtros combinados sin añadir campos vacíos', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], totalItems: 0, totalPages: 0, page: 1, limit: 20 }),
      } as Response);
      await getTasks(sampleProjectId, {
        page: 1,
        limit: 20,
        search: 'QA & revisión',
        columnId: sampleColumnId,
        priority: 'HIGH',
        label: 'UX/UI',
        assigneeId: sampleProjectId,
      });
      const url = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]), 'http://localhost');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        page: '1',
        limit: '20',
        search: 'QA & revisión',
        columnId: sampleColumnId,
        priority: 'HIGH',
        label: 'UX/UI',
        assigneeId: sampleProjectId,
      });
      expect(url.searchParams.get('assigneeId')).toBe(sampleProjectId);
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('GET');
    });
    it('debe construir la URL con parámetros query y retornar datos paginados validados', async () => {
      const mockResponse: PaginatedTasksResponse = {
        items: [makeSampleTask('33333333-3333-4333-8333-333333333333', 0, 'Tarea 1')],
        totalItems: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await getTasks(sampleProjectId, {
        page: 2,
        limit: 50,
        columnId: sampleColumnId,
        priority: 'HIGH',
      });

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/tasks?page=2&limit=50&columnId=${sampleColumnId}&priority=HIGH`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
            'X-Dev-User-Id': '11111111-1111-4111-8111-111111111111',
          }),
        }),
      );
    });

    it('debe manejar errores HTTP arrojando mensaje de error legible', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Proyecto no encontrado' }),
      } as Response);

      await expect(getTasks(sampleProjectId)).rejects.toThrow(/Proyecto no encontrado/i);
    });

    it('debe rechazar si la respuesta no cumple con el esquema PaginatedTasksResponseSchema', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: 'not-an-array' }),
      } as Response);

      await expect(getTasks(sampleProjectId)).rejects.toThrow(
        /Respuesta inválida del servidor según contrato de tareas/i,
      );
    });
  });

  describe('getAllProjectTasks (Paginación exhaustiva)', () => {
    it('debe retornar inmediatamente los elementos si solo existe una sola página (totalPages <= 1)', async () => {
      const page1Tasks = [
        makeSampleTask('33333333-3333-4333-8333-333333333331', 0, 'Tarea A'),
        makeSampleTask('33333333-3333-4333-8333-333333333332', 1, 'Tarea B'),
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: page1Tasks,
          totalItems: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      } as Response);

      const result = await getAllProjectTasks(sampleProjectId);

      expect(result).toEqual(page1Tasks);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/tasks?page=1&limit=100`,
        expect.anything(),
      );
    });

    it('debe solicitar todas las páginas consecutivas y combinar sus tareas cuando hay múltiples páginas', async () => {
      const page1Tasks = Array.from({ length: 100 }, (_, index) =>
        makeSampleTask(
          `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
          index,
          `Tarea P1-${index + 1}`,
        ),
      );
      const page2Tasks = [
        makeSampleTask('33333333-3333-4333-8333-000000000101', 100, 'Tarea P2-1'),
      ];

      // Respuesta para la página 1
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: page1Tasks,
          totalItems: 101,
          page: 1,
          limit: 100,
          totalPages: 2,
        }),
      } as Response);

      // Respuesta para la página 2
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: page2Tasks,
          totalItems: 101,
          page: 2,
          limit: 100,
          totalPages: 2,
        }),
      } as Response);

      const result = await getAllProjectTasks(sampleProjectId);

      expect(result).toHaveLength(101);
      expect(result).toEqual([...page1Tasks, ...page2Tasks]);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        `/api/projects/${sampleProjectId}/tasks?page=1&limit=100`,
        expect.anything(),
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        `/api/projects/${sampleProjectId}/tasks?page=2&limit=100`,
        expect.anything(),
      );
    });

    it('debe fallar completamente y NO retornar datos parciales si alguna página posterior falla', async () => {
      const page1Tasks = Array.from({ length: 100 }, (_, index) =>
        makeSampleTask(
          `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
          index,
          `Tarea P1-${index + 1}`,
        ),
      );

      // Página 1 exitosa que indica totalPages: 2
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: page1Tasks,
          totalItems: 101,
          page: 1,
          limit: 100,
          totalPages: 2,
        }),
      } as Response);

      // Página 2 falla con error 500
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Fallo al recuperar página 2' }),
      } as Response);

      await expect(getAllProjectTasks(sampleProjectId)).rejects.toThrow(
        /Fallo al recuperar página 2/i,
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('createTask', () => {
    it('debe enviar el payload validado y retornar la tarea creada', async () => {
      const task = makeSampleTask('33333333-3333-4333-8333-333333333333', 2, 'Nueva tarea');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => task,
      } as Response);

      const result = await createTask(sampleProjectId, {
        title: 'Nueva tarea',
        columnId: sampleColumnId,
        priority: 'HIGH',
        dueDate: '2026-10-21T00:00:00.000Z',
        labels: [],
        assigneeIds: [],
      });

      expect(result).toEqual(task);
      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/tasks`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Nueva tarea',
            columnId: sampleColumnId,
            priority: 'HIGH',
            dueDate: '2026-10-21T00:00:00.000Z',
            labels: [],
            assigneeIds: [],
          }),
        }),
      );
    });

    it('debe rechazar payload inválido sin llamar a la API', async () => {
      await expect(
        createTask(sampleProjectId, {
          title: 'x',
          columnId: sampleColumnId,
          priority: 'MEDIUM',
          labels: [],
          assigneeIds: [],
        }),
      ).rejects.toThrow(/Datos inválidos/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('debe propagar errores HTTP y respuestas inválidas', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'No se pudo guardar' }),
      } as Response);
      await expect(
        createTask(sampleProjectId, {
          title: 'Nueva tarea',
          columnId: sampleColumnId,
          priority: 'MEDIUM',
          labels: [],
          assigneeIds: [],
        }),
      ).rejects.toThrow('No se pudo guardar');

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'invalid' }),
      } as Response);
      await expect(
        createTask(sampleProjectId, {
          title: 'Otra tarea',
          columnId: sampleColumnId,
          priority: 'MEDIUM',
          labels: [],
          assigneeIds: [],
        }),
      ).rejects.toThrow(/Respuesta inválida/i);
    });
  });

  describe('moveTask', () => {
    it('debe enviar únicamente el destino y validar la respuesta', async () => {
      const task = makeSampleTask('33333333-3333-4333-8333-333333333333', 1, 'Tarea movida');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => task,
      } as Response);

      await expect(
        moveTask(sampleProjectId, task.id, {
          destinationColumnId: sampleColumnId,
          destinationIndex: 1,
        }),
      ).resolves.toEqual(task);

      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/tasks/${task.id}/move`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            destinationColumnId: sampleColumnId,
            destinationIndex: 1,
          }),
        }),
      );
    });

    it('debe rechazar una respuesta con identidad distinta', async () => {
      const task = makeSampleTask('33333333-3333-4333-8333-333333333334', 0, 'Otra tarea');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => task,
      } as Response);

      await expect(
        moveTask(sampleProjectId, '33333333-3333-4333-8333-333333333333', {
          destinationColumnId: sampleColumnId,
          destinationIndex: 0,
        }),
      ).rejects.toThrow(/no corresponde/i);
    });

    it('debe rechazar payload inválido sin llamar a la API', async () => {
      await expect(
        moveTask(sampleProjectId, '33333333-3333-4333-8333-333333333333', {
          destinationColumnId: 'columna-invalida',
          destinationIndex: -1,
        }),
      ).rejects.toThrow(/Datos inválidos/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('debe propagar errores HTTP y de red', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ message: 'Movimiento rechazado' }),
      } as Response);

      await expect(
        moveTask(sampleProjectId, '33333333-3333-4333-8333-333333333333', {
          destinationColumnId: sampleColumnId,
          destinationIndex: 0,
        }),
      ).rejects.toThrow('Movimiento rechazado');

      vi.mocked(fetch).mockRejectedValueOnce(new Error('Red no disponible'));
      await expect(
        moveTask(sampleProjectId, '33333333-3333-4333-8333-333333333333', {
          destinationColumnId: sampleColumnId,
          destinationIndex: 0,
        }),
      ).rejects.toThrow('Red no disponible');
    });
  });

  describe('updateTask', () => {
    it('envía únicamente el parche validado y valida identidad de la respuesta', async () => {
      const task = makeSampleTask('33333333-3333-4333-8333-333333333333', 2, 'Tarea actualizada');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => task,
      } as Response);

      await expect(
        updateTask(sampleProjectId, task.id, {
          description: '',
          dueDate: null,
          labels: [],
        }),
      ).resolves.toEqual(task);
      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/tasks/${task.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ description: '', dueDate: null, labels: [] }),
        }),
      );
    });

    it('rechaza una respuesta con otra tarea o proyecto', async () => {
      const task = makeSampleTask('33333333-3333-4333-8333-333333333333', 2, 'Otra tarea');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...task, id: '33333333-3333-4333-8333-333333333334' }),
      } as Response);

      await expect(updateTask(sampleProjectId, task.id, { priority: 'HIGH' })).rejects.toThrow(
        /no corresponde/i,
      );
    });
  });

  it('exporta TaskService como objeto envolvente', () => {
    expect(TaskService.createTask).toBe(createTask);
    expect(TaskService.updateTask).toBe(updateTask);
    expect(TaskService.getTasks).toBe(getTasks);
    expect(TaskService.getAllProjectTasks).toBe(getAllProjectTasks);
  });
});
