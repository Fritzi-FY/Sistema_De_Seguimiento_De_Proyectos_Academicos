import { describe, it, expect, beforeEach } from 'vitest';
import type { SystemClockPort, Project, ProjectMembership } from '@is488/shared';
import { BoardResponseSchema, BoardColumnResponseSchema } from '@is488/shared';
import { InMemoryKanbanProjectStorage } from '../../adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryBoardRepository } from '../../adapters/repositories/in-memory-board.repository.js';
import { InMemoryBoardColumnDeletionAdapter } from '../../adapters/repositories/in-memory-board-column-deletion.adapter.js';
import { InMemoryTaskRepository } from '../../adapters/repositories/in-memory-task.repository.js';
import { createApp } from '../app.js';
import { InMemoryProjectRepository } from '../../adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryProjectCreationAdapter } from '../../adapters/repositories/in-memory-project-creation.adapter.js';

class FakeClock implements SystemClockPort {
  constructor(private readonly iso: string = '2026-10-23T14:00:00.000Z') {}
  now(): Date {
    return new Date(this.iso);
  }
  isoString(): string {
    return this.iso;
  }
}

interface TestSetup {
  app: ReturnType<typeof createApp>;
  projectRepository: InMemoryProjectRepository;
  membershipRepository: InMemoryMembershipRepository;
  kanbanStorage: InMemoryKanbanProjectStorage;
  clock: FakeClock;
}

interface CreateTestAppOptions {
  nodeEnv?: string;
  customStorage?: InMemoryKanbanProjectStorage;
}

function createTestApp(
  optionsOrEnv: string | CreateTestAppOptions = 'development',
  customStorage?: InMemoryKanbanProjectStorage,
): TestSetup {
  const clock = new FakeClock();
  const projectMap = new Map<string, Project>();
  const membershipMap = new Map<string, ProjectMembership>();

  let nodeEnv: string | undefined;
  let kanbanStorage: InMemoryKanbanProjectStorage;

  if (typeof optionsOrEnv === 'string') {
    nodeEnv = optionsOrEnv;
    kanbanStorage = customStorage ?? new InMemoryKanbanProjectStorage();
  } else {
    nodeEnv = optionsOrEnv.nodeEnv;
    kanbanStorage =
      optionsOrEnv.customStorage ?? customStorage ?? new InMemoryKanbanProjectStorage();
  }

  const projectRepository = new InMemoryProjectRepository(projectMap);
  const membershipRepository = new InMemoryMembershipRepository(membershipMap);
  const projectCreationPort = new InMemoryProjectCreationAdapter(projectMap, membershipMap);
  const boardRepository = new InMemoryBoardRepository(kanbanStorage);
  const boardColumnDeletionPort = new InMemoryBoardColumnDeletionAdapter(kanbanStorage);

  const app = createApp({
    clock,
    projectRepository,
    membershipRepository,
    projectCreationPort,
    kanbanStorage,
    boardRepository,
    boardColumnDeletionPort,
    nodeEnv,
  });

  return { app, projectRepository, membershipRepository, kanbanStorage, clock };
}

const CREATOR_ID = 'dev-student-01';
const COLLABORATOR_ID = '550e8400-e29b-41d4-a716-446655440000';
const OUTSIDER_ID = 'outsider-user-99';
const TEACHER_UNASSIGNED_ID = 'teacher-unassigned-01';

const VALID_PROJECT_PAYLOAD = {
  title: 'Proyecto Kanban IS488',
  courseCode: 'IS-488',
  startDate: '2026-10-15T00:00:00.000Z',
  targetDate: '2026-12-20T00:00:00.000Z',
};

describe('Pruebas de integración HTTP de Tablero y Columnas (/api/projects/:projectId/board)', () => {
  let setup: TestSetup;
  let projectId: string;

  beforeEach(async () => {
    setup = createTestApp('development');

    // 1. Crear proyecto base
    const res = await setup.app.request('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': CREATOR_ID,
      },
      body: JSON.stringify(VALID_PROJECT_PAYLOAD),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string };
    projectId = data.id;

    // 2. Agregar colaborador activo
    await setup.app.request(`/api/projects/${projectId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': CREATOR_ID,
      },
      body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
    });
  });

  describe('1. Consulta y creación perezosa (GET /api/projects/:projectId/board)', () => {
    it('debe inicializar el tablero con 3 columnas por defecto, responder 200 y Cache-Control: no-store', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/board`, {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': CREATOR_ID,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const body = (await res.json()) as {
        id: string;
        projectId: string;
        columns: Array<{ name: string; orderIndex: number; category: string }>;
      };
      const parsed = BoardResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      expect(body.projectId).toBe(projectId);
      expect(body.columns).toHaveLength(3);
      expect(body.columns.map((c) => c.category)).toEqual(['TODO', 'IN_PROGRESS', 'DONE']);
      expect(body.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    });

    it('la segunda consulta debe ser idempotente y retornar el mismo tablero', async () => {
      const res1 = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const data1 = (await res1.json()) as { id: string };

      const res2 = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': COLLABORATOR_ID },
      });
      const data2 = (await res2.json()) as { id: string };

      expect(res2.status).toBe(200);
      expect(data1.id).toBe(data2.id);
    });
  });

  describe('2. Creaci?n de columnas (POST /api/projects/:projectId/board/columns)', () => {
    it('debe crear una columna con HTTP 201, Cache-Control: no-store y orderIndex contiguo', async () => {
      // Inicializar tablero
      await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      const res = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': COLLABORATOR_ID,
        },
        body: JSON.stringify({
          name: 'QA y Pruebas',
          category: 'IN_REVIEW',
          color: '#3b82f6',
        }),
      });

      expect(res.status).toBe(201);
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const column = (await res.json()) as {
        id: string;
        name: string;
        orderIndex: number;
        category: string;
        color: string;
      };
      const parseResult = BoardColumnResponseSchema.safeParse(column);
      expect(parseResult.success).toBe(true);

      expect(column.name).toBe('QA y Pruebas');
      expect(column.category).toBe('IN_REVIEW');
      expect(column.color).toBe('#3b82f6');
      expect(column.orderIndex).toBe(3); // Inicialmente habían 3 columnas por defecto (0..3)
    });

    it('debe rechazar con HTTP 400 si se intenta exceder el límite máximo de 10 columnas', async () => {
      // Inicializar tablero (3 columnas)
      await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      // Crear 6 columnas adicionales para llegar exactamente a 10
      for (let i = 4; i <= 10; i++) {
        const createRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({ name: `Columna ${i}`, category: 'TODO' }),
        });
        expect(createRes.status).toBe(201);
      }

      // Intentar crear la columna 11
      const res = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ name: 'Columna Excedente', category: 'TODO' }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Bad Request');
      expect(json.message).toMatch(/l[\u00ed]mite m[\u00e1]ximo/i);
    });
  });

  describe('3. Edición y reordenamiento (PATCH /api/projects/:projectId/board/columns/:columnId)', () => {
    it('debe actualizar atributos de una columna con HTTP 200 y Cache-Control: no-store', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const colId = board.columns[0]!.id;

      const res = await setup.app.request(`/api/projects/${projectId}/board/columns/${colId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': COLLABORATOR_ID,
        },
        body: JSON.stringify({
          name: 'Por Hacer (Actualizado)',
          color: '#10b981',
          category: 'TODO',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const updated = (await res.json()) as { name: string; color: string };
      expect(updated.name).toBe('Por Hacer (Actualizado)');
      expect(updated.color).toBe('#10b981');
    });

    it('debe reordenar contiguamente una columna cuando se modifica orderIndex', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string; name: string }> };
      const firstColId = board.columns[0]!.id; // orderIndex 0

      // Mover la primera columna a la ?ltima posición (índice 3)
      const res = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${firstColId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({ orderIndex: 2 }),
        },
      );

      expect(res.status).toBe(200);
      const updated = (await res.json()) as { orderIndex: number };
      expect(updated.orderIndex).toBe(2);

      // Verificar que el tablero completo mantiene índices contiguos 0..3
      const checkRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const checkBoard = (await checkRes.json()) as {
        columns: Array<{ id: string; orderIndex: number }>;
      };
      expect(checkBoard.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
      expect(checkBoard.columns[2]!.id).toBe(firstColId);
    });

    it('debe rechazar con HTTP 400 si el cuerpo de actualización está vacío', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const colId = board.columns[0]!.id;

      const res = await setup.app.request(`/api/projects/${projectId}/board/columns/${colId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Bad Request');
    });

    it('debe retornar 404 si la columna no existe en el proyecto', async () => {
      const nonExistentColId = '00000000-0000-4000-8000-000000000000';
      const res = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${nonExistentColId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({ name: 'Nuevo Nombre' }),
        },
      );

      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Not Found');
    });
  });

  describe('4. Aislamiento horizontal y autorización de acceso', () => {
    it('usuario ajeno recibe 404 en consulta y modificación para no divulgar metadatos', async () => {
      const getRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': OUTSIDER_ID },
      });
      expect(getRes.status).toBe(404);

      const postRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': OUTSIDER_ID,
        },
        body: JSON.stringify({ name: 'Columna Espuria' }),
      });
      expect(postRes.status).toBe(404);
    });

    it('docente no asignado recibe 404 en operaciones de tablero', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: {
          'X-Dev-User-Id': TEACHER_UNASSIGNED_ID,
          'X-Dev-User-Role': 'teacher',
        },
      });
      expect(res.status).toBe(404);
    });

    it('proyecto inexistente responde 404', async () => {
      const nonExistentProject = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
      const res = await setup.app.request(`/api/projects/${nonExistentProject}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('5. Identidad exclusiva y parameter pollution', () => {
    it('rechaza inyección de identidad o campos desconocidos en body con HTTP 400 (additionalProperties: false)', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          name: 'Columna con Injection en Body',
          category: 'TODO',
          requesterId: OUTSIDER_ID,
          creatorId: OUTSIDER_ID,
          userId: OUTSIDER_ID,
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Bad Request');
    });

    it('ignora parameter pollution en query params y toma identidad exclusivamente de context.user', async () => {
      const res = await setup.app.request(
        `/api/projects/${projectId}/board/columns?requesterId=${OUTSIDER_ID}&userId=${OUTSIDER_ID}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({
            name: 'Columna con Query Pollution',
            category: 'TODO',
          }),
        },
      );

      expect(res.status).toBe(201);
      const json = (await res.json()) as { name: string };
      expect(json.name).toBe('Columna con Query Pollution');
    });
  });

  describe('6. Validación estricta de parámetros y payloads', () => {
    it('debe rechazar con HTTP 400 si el payload de creación de columna incluye campos desconocidos (additionalProperties: false)', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          name: 'Columna Inválida',
          campoDesconocido: 'no permitido',
        }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Bad Request');
    });

    it('debe rechazar con HTTP 400 si el payload de actualización de columna incluye campos desconocidos (additionalProperties: false)', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const colId = board.columns[0]!.id;

      const res = await setup.app.request(`/api/projects/${projectId}/board/columns/${colId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          name: 'Nombre Válido',
          extraInvalido: 'no permitido',
        }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Bad Request');
    });

    it('debe rechazar con HTTP 400 si el payload de actualización está vacío o contiene solo undefined (minProperties: 1)', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const colId = board.columns[0]!.id;

      const emptyRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${colId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({}),
        },
      );
      expect(emptyRes.status).toBe(400);
      const json = (await emptyRes.json()) as { error: string; message: string };
      expect(json.error).toBe('Bad Request');
    });

    it('debe rechazar con HTTP 400 si projectId no es UUID válido', async () => {
      const res = await setup.app.request('/api/projects/invalido-no-uuid/board', {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Bad Request');
      expect(json.message).toMatch(/UUID v[a\u00e1]lido/i);
    });

    it('debe rechazar con HTTP 400 si columnId no es UUID válido en PATCH y DELETE', async () => {
      const patchRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/no-es-uuid`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({ name: 'Col' }),
        },
      );
      expect(patchRes.status).toBe(400);

      const delRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/no-es-uuid`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(delRes.status).toBe(400);
    });

    it('debe rechazar JSON malformado con HTTP 400', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: '{ malformed json',
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Bad Request');
    });

    it('debe rechazar payloads null o array ([]) con HTTP 400', async () => {
      const nullRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: 'null',
      });
      expect(nullRes.status).toBe(400);

      const arrRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: '[]',
      });
      expect(arrRes.status).toBe(400);
    });

    it('debe validar límites de longitud de nombre y formato de color hexadecimal', async () => {
      const emptyNameRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ name: '   ', category: 'TODO' }),
      });
      expect(emptyNameRes.status).toBe(400);

      const invalidColorRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ name: 'Col', color: 'rojo-no-hex' }),
      });
      expect(invalidColorRes.status).toBe(400);
    });
  });

  describe('7. Eliminación de columnas (DELETE /api/projects/:projectId/board/columns/:columnId)', () => {
    it('columna vacía se elimina exitosamente y recompacta índices contiguos', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const colIdToDelete = board.columns[1]!.id; // IN_PROGRESS

      const res = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${colIdToDelete}`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const result = (await res.json()) as {
        success: boolean;
        deletedColumnId: string;
        migratedTasksCount: number;
      };
      expect(result.success).toBe(true);
      expect(result.deletedColumnId).toBe(colIdToDelete);
      expect(result.migratedTasksCount).toBe(0);

      // Verificar que quedan 3 columnas con índices 0, 1, 2
      const checkRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const checkBoard = (await checkRes.json()) as {
        columns: Array<{ id: string; orderIndex: number }>;
      };
      expect(checkBoard.columns).toHaveLength(2);
      expect(checkBoard.columns.map((c) => c.orderIndex)).toEqual([0, 1]);
      expect(checkBoard.columns.some((c) => c.id === colIdToDelete)).toBe(false);
    });

    it('columna con tareas sin targetColumnId es rechazada con HTTP 409 Conflict', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const sourceColId = board.columns[0]!.id;

      // Insertar tarea en la columna de origen usando InMemoryTaskRepository directamente
      const taskRepo = new InMemoryTaskRepository(setup.kanbanStorage);
      await taskRepo.create({
        projectId,
        columnId: sourceColId,
        title: 'Tarea en columna origen',
        priority: 'MEDIUM',
        orderIndex: 0,
        creatorId: CREATOR_ID,
        assigneeIds: [],
        labels: [],
      });

      // Intentar eliminar sin targetColumnId
      const res = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${sourceColId}`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );

      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Conflict');
      expect(json.message).toMatch(/tareas activas/i);
    });

    it('columna con tareas con targetColumnId migra tareas y emite auditoría atómica', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const sourceColId = board.columns[0]!.id; // TODO
      const targetColId = board.columns[1]!.id; // IN_PROGRESS

      // Insertar 2 tareas en la columna origen usando el adaptador real
      const taskRepo = new InMemoryTaskRepository(setup.kanbanStorage);
      const task1 = await taskRepo.create({
        projectId,
        columnId: sourceColId,
        title: 'Tarea 1 a migrar',
        priority: 'HIGH',
        orderIndex: 0,
        creatorId: CREATOR_ID,
        assigneeIds: [],
        labels: [],
      });
      const task2 = await taskRepo.create({
        projectId,
        columnId: sourceColId,
        title: 'Tarea 2 a migrar',
        priority: 'LOW',
        orderIndex: 1,
        creatorId: CREATOR_ID,
        assigneeIds: [],
        labels: [],
      });

      // Eliminar con targetColumnId en query param
      const res = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${sourceColId}?targetColumnId=${targetColId}`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );

      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        success: boolean;
        deletedColumnId: string;
        migratedTasksCount: number;
      };
      expect(result.success).toBe(true);
      expect(result.migratedTasksCount).toBe(2);

      // Verificar que las tareas migraron al target con índices contiguos
      const snapshot = setup.kanbanStorage.getSnapshot(projectId);
      const migratedTasks = snapshot.tasks.filter((t) => t.id === task1.id || t.id === task2.id);
      expect(migratedTasks).toHaveLength(2);
      expect(migratedTasks.every((t) => t.columnId === targetColId)).toBe(true);

      // Verificar eventos de auditor?a registrados de forma indivisible
      const events = snapshot.events.filter(
        (e) =>
          e.action === 'COLUMN_DELETED_REALLOCATION' &&
          (e.taskId === task1.id || e.taskId === task2.id),
      );
      expect(events).toHaveLength(2);
      expect(events[0]!.fromColumnId).toBe(sourceColId);
      expect(events[0]!.toColumnId).toBe(targetColId);
    });

    it('debe rechazar con HTTP 400 si targetColumnId es igual a la columna a eliminar o inexistente', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };
      const sourceColId = board.columns[0]!.id;

      // Insertar tarea en la columna de origen
      const taskRepo = new InMemoryTaskRepository(setup.kanbanStorage);
      await taskRepo.create({
        projectId,
        columnId: sourceColId,
        title: 'Tarea en columna origen',
        priority: 'MEDIUM',
        orderIndex: 0,
        creatorId: CREATOR_ID,
        assigneeIds: [],
        labels: [],
      });

      // Target igual a Source
      const sameTargetRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${sourceColId}?targetColumnId=${sourceColId}`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(sameTargetRes.status).toBe(400);

      // Target inexistente
      const nonExistentTarget = '11111111-1111-4111-8111-111111111111';
      const nonExistentRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${sourceColId}?targetColumnId=${nonExistentTarget}`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(nonExistentRes.status).toBe(400);
    });

    it('debe rechazar con HTTP 400 si se intenta eliminar la última columna restante del tablero', async () => {
      const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const board = (await boardRes.json()) as { columns: Array<{ id: string }> };

      // Eliminar columnas hasta dejar exactamente 1
      for (let i = 0; i < 2; i++) {
        const delRes = await setup.app.request(
          `/api/projects/${projectId}/board/columns/${board.columns[i]!.id}`,
          {
            method: 'DELETE',
            headers: { 'X-Dev-User-Id': CREATOR_ID },
          },
        );
        expect(delRes.status).toBe(200);
      }

      // Intentar eliminar la última columna
      const lastColId = board.columns[2]!.id;
      const res = await setup.app.request(`/api/projects/${projectId}/board/columns/${lastColId}`, {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Bad Request');
      expect(json.message).toMatch(/al menos una columna/i);
    });
  });

  describe('8. Manejo de métodos HTTP (405 Method Not Allowed) y CORS preflight', () => {
    it('debe retornar 405 Method Not Allowed con cabecera Allow correcta en rutas de tablero', async () => {
      // PUT /api/projects/:projectId/board -> Allow: GET
      const putBoardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        method: 'PUT',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(putBoardRes.status).toBe(405);
      expect(putBoardRes.headers.get('Allow')).toBe('GET');

      // GET /api/projects/:projectId/board/columns -> Allow: POST
      const getColumnsRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(getColumnsRes.status).toBe(405);
      expect(getColumnsRes.headers.get('Allow')).toBe('POST');

      // POST /api/projects/:projectId/board/columns/:columnId -> Allow: PATCH, DELETE
      const dummyColId = '00000000-0000-4000-8000-000000000000';
      const postColDetailRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${dummyColId}`,
        {
          method: 'POST',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(postColDetailRes.status).toBe(405);
      expect(postColDetailRes.headers.get('Allow')).toBe('PATCH, DELETE');
    });

    it('peticiones OPTIONS retornan 404 al estar CORS fuera del alcance del enrutador', async () => {
      const optionsRes = await setup.app.request(`/api/projects/${projectId}/board`, {
        method: 'OPTIONS',
      });
      // Limitación documentada: CORS preflight no está implementado a nivel de enrutador
      expect(optionsRes.status).toBe(404);
    });
  });

  describe('9. Entornos dev-auth y seguridad', () => {
    it('debe permitir acceso en entorno development con cabecera X-Dev-User-Id', async () => {
      const devSetup = createTestApp('development');
      const pRes = await devSetup.app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify(VALID_PROJECT_PAYLOAD),
      });
      expect(pRes.status).toBe(201);
      const p = (await pRes.json()) as { id: string };
      const res = await devSetup.app.request(`/api/projects/${p.id}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(200);
    });

    it('debe permitir acceso en entorno test con cabecera X-Dev-User-Id', async () => {
      const testSetup = createTestApp('test');
      const pRes = await testSetup.app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify(VALID_PROJECT_PAYLOAD),
      });
      expect(pRes.status).toBe(201);
      const p = (await pRes.json()) as { id: string };
      const res = await testSetup.app.request(`/api/projects/${p.id}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(200);
    });

    it('en producción rechaza con HTTP 401 sin importar cabeceras', async () => {
      const prodSetup = createTestApp('production');
      const res = await prodSetup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Unauthorized');
    });

    it('en entorno staging rechaza con HTTP 401', async () => {
      const stagingSetup = createTestApp('staging');
      const res = await stagingSetup.app.request(`/api/projects/${projectId}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Unauthorized');
    });

    it('en entorno realmente ausente (sin nodeEnv inyectado y sin process.env.NODE_ENV) rechaza con HTTP 401', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        delete process.env.NODE_ENV;
        const absentSetup = createTestApp({ nodeEnv: undefined });
        const res = await absentSetup.app.request(`/api/projects/${projectId}/board`, {
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        });
        expect(res.status).toBe(401);
        const json = (await res.json()) as { error: string; message: string };
        expect(json.error).toBe('Unauthorized');
        expect(json.message).toMatch(/deshabilitado en entornos de producción o no configurados/i);
      } finally {
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    it('falta de cabecera X-Dev-User-Id rechaza con HTTP 401', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/board`);
      expect(res.status).toBe(401);
    });
  });

  describe('10. Aislamiento de estado Kanban entre distintas instancias de createApp', () => {
    it('ambas apps acceden al mismo proyecto y usuario pero usan storage Kanban predeterminado independiente', async () => {
      // Repositorios compartidos para proyecto y membresía
      const sharedProjectMap = new Map<string, Project>();
      const sharedMembershipMap = new Map<string, ProjectMembership>();
      const sharedProjectRepository = new InMemoryProjectRepository(sharedProjectMap);
      const sharedMembershipRepository = new InMemoryMembershipRepository(sharedMembershipMap);
      const sharedProjectCreationPort = new InMemoryProjectCreationAdapter(
        sharedProjectMap,
        sharedMembershipMap,
      );

      // Ambas apps comparten los mismos repositorios de proyecto/membresía,
      // pero NO se les inyecta kanbanStorage: cada una instancia su propio storage Kanban predeterminado
      const app1 = createApp({
        projectRepository: sharedProjectRepository,
        membershipRepository: sharedMembershipRepository,
        projectCreationPort: sharedProjectCreationPort,
        nodeEnv: 'development',
      });

      const app2 = createApp({
        projectRepository: sharedProjectRepository,
        membershipRepository: sharedMembershipRepository,
        projectCreationPort: sharedProjectCreationPort,
        nodeEnv: 'development',
      });

      // Crear proyecto a través de app1
      const pRes = await app1.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify(VALID_PROJECT_PAYLOAD),
      });
      expect(pRes.status).toBe(201);
      const project = (await pRes.json()) as { id: string };

      // Ambas apps pueden acceder al proyecto e inicializar su propio tablero predeterminado
      const b1Init = await app1.request(`/api/projects/${project.id}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(b1Init.status).toBe(200);
      const b1Data = (await b1Init.json()) as { columns: Array<{ name: string }> };
      expect(b1Data.columns).toHaveLength(3);

      const b2Init = await app2.request(`/api/projects/${project.id}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(b2Init.status).toBe(200);
      const b2Data = (await b2Init.json()) as { columns: Array<{ name: string }> };
      expect(b2Data.columns).toHaveLength(3);

      // Modificar el tablero de app1 agregando una columna exclusiva
      const addColRes = await app1.request(`/api/projects/${project.id}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ name: 'Columna Exclusiva App 1' }),
      });
      expect(addColRes.status).toBe(201);

      // Verificar que app1 ahora tiene 4 columnas, incluyendo la nueva columna
      const b1After = await app1.request(`/api/projects/${project.id}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const b1AfterData = (await b1After.json()) as { columns: Array<{ name: string }> };
      expect(b1AfterData.columns).toHaveLength(4);
      expect(b1AfterData.columns.some((c) => c.name === 'Columna Exclusiva App 1')).toBe(true);

      // Verificar que app2 NO recibe el cambio: sigue teniendo exactamente 3 columnas y no contiene la columna creada en app1
      const b2After = await app2.request(`/api/projects/${project.id}/board`, {
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const b2AfterData = (await b2After.json()) as { columns: Array<{ name: string }> };
      expect(b2AfterData.columns).toHaveLength(3);
      expect(b2AfterData.columns.some((c) => c.name === 'Columna Exclusiva App 1')).toBe(false);
    });
  });
});
