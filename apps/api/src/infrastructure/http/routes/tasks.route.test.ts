import { describe, it, expect, beforeEach } from 'vitest';
import type { SystemClockPort, Project, ProjectMembership } from '@is488/shared';
import { TaskResponseSchema, PaginatedTasksResponseSchema } from '@is488/shared';
import { InMemoryKanbanProjectStorage } from '../../adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryBoardRepository } from '../../adapters/repositories/in-memory-board.repository.js';
import { InMemoryBoardColumnDeletionAdapter } from '../../adapters/repositories/in-memory-board-column-deletion.adapter.js';
import { InMemoryTaskCreationAdapter } from '../../adapters/repositories/in-memory-task-creation.adapter.js';
import { InMemoryTaskUpdateAdapter } from '../../adapters/repositories/in-memory-task-update.adapter.js';
import { InMemoryTaskMoveAdapter } from '../../adapters/repositories/in-memory-task-move.adapter.js';
import { InMemoryTaskListAdapter } from '../../adapters/repositories/in-memory-task-list.adapter.js';
import { createApp } from '../app.js';
import { InMemoryProjectRepository } from '../../adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryProjectCreationAdapter } from '../../adapters/repositories/in-memory-project-creation.adapter.js';

class FakeClock implements SystemClockPort {
  constructor(private iso: string = '2026-10-23T14:00:00.000Z') {}
  now(): Date {
    return new Date(this.iso);
  }
  isoString(): string {
    return this.iso;
  }
  setIsoString(newIso: string): void {
    this.iso = newIso;
  }
}

interface TestSetup {
  app: ReturnType<typeof createApp>;
  projectRepository: InMemoryProjectRepository;
  membershipRepository: InMemoryMembershipRepository;
  kanbanStorage: InMemoryKanbanProjectStorage;
  clock: FakeClock;
}

function createTestApp(
  nodeEnv = 'development',
  customStorage?: InMemoryKanbanProjectStorage,
): TestSetup {
  const clock = new FakeClock();
  const projectMap = new Map<string, Project>();
  const membershipMap = new Map<string, ProjectMembership>();
  const kanbanStorage = customStorage ?? new InMemoryKanbanProjectStorage();

  const projectRepository = new InMemoryProjectRepository(projectMap);
  const membershipRepository = new InMemoryMembershipRepository(membershipMap);
  const projectCreationPort = new InMemoryProjectCreationAdapter(projectMap, membershipMap);
  const boardRepository = new InMemoryBoardRepository(kanbanStorage);
  const boardColumnDeletionPort = new InMemoryBoardColumnDeletionAdapter(kanbanStorage);
  const taskCreationPort = new InMemoryTaskCreationAdapter(kanbanStorage);
  const taskUpdatePort = new InMemoryTaskUpdateAdapter(kanbanStorage);
  const taskMovePort = new InMemoryTaskMoveAdapter(kanbanStorage);
  const taskListPort = new InMemoryTaskListAdapter(kanbanStorage);

  const app = createApp({
    clock,
    projectRepository,
    membershipRepository,
    projectCreationPort,
    kanbanStorage,
    boardRepository,
    boardColumnDeletionPort,
    taskCreationPort,
    taskUpdatePort,
    taskMovePort,
    taskListPort,
    nodeEnv,
  });

  return { app, projectRepository, membershipRepository, kanbanStorage, clock };
}

const CREATOR_ID = 'dev-student-01';
const COLLABORATOR_ID = '550e8400-e29b-41d4-a716-446655440000';
const OUTSIDER_ID = 'outsider-user-99';
const TEACHER_UNASSIGNED_ID = 'teacher-unassigned-01';

const VALID_PROJECT_PAYLOAD = {
  title: 'Proyecto Kanban IS488 Tareas',
  courseCode: 'IS-488',
  startDate: '2026-10-15T00:00:00.000Z',
  targetDate: '2026-12-20T00:00:00.000Z',
};

describe('Pruebas de integración HTTP de Rutas de Tareas (/api/projects/:projectId/tasks)', () => {
  let setup: TestSetup;
  let projectId: string;
  let columnTodoId: string;
  let columnInProgressId: string;
  let columnDoneId: string;

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
    const memberRes = await setup.app.request(`/api/projects/${projectId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': CREATOR_ID,
      },
      body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
    });
    expect(memberRes.status).toBe(201);

    // 3. Inicializar tablero para obtener columnas canónicas
    const boardRes = await setup.app.request(`/api/projects/${projectId}/board`, {
      method: 'GET',
      headers: { 'X-Dev-User-Id': CREATOR_ID },
    });
    expect(boardRes.status).toBe(200);
    const board = (await boardRes.json()) as {
      columns: Array<{ id: string; category: string }>;
    };
    columnTodoId = board.columns[0]!.id;
    columnInProgressId = board.columns[1]!.id;
    columnDoneId = board.columns[2]!.id;
  });

  describe('1. Flujo completo: crear → listar → editar/asignar → mover → listar', () => {
    it('debe completar el ciclo de vida completo de una tarea con persistencia y respuestas conformes', async () => {
      // 1.1 Crear tarea
      const createRes = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Diseñar arquitectura de tareas',
          description: 'Definir interfaces y adaptadores hexagonales',
          columnId: columnTodoId,
          priority: 'HIGH',
          dueDate: '2026-11-15T00:00:00.000Z',
          labels: ['arquitectura', 'backend'],
          assigneeIds: [COLLABORATOR_ID],
        }),
      });

      expect(createRes.status).toBe(201);
      expect(createRes.headers.get('Cache-Control')).toBe('no-store');
      const createdTask = (await createRes.json()) as {
        id: string;
        projectId: string;
        columnId: string;
        title: string;
        orderIndex: number;
        priority: string;
        creatorId: string;
        assigneeIds: string[];
      };

      const parsedCreated = TaskResponseSchema.safeParse(createdTask);
      expect(parsedCreated.success).toBe(true);
      expect(createdTask.projectId).toBe(projectId);
      expect(createdTask.columnId).toBe(columnTodoId);
      expect(createdTask.title).toBe('Diseñar arquitectura de tareas');
      expect(createdTask.orderIndex).toBe(0);
      expect(createdTask.creatorId).toBe(CREATOR_ID);
      expect(createdTask.assigneeIds).toEqual([COLLABORATOR_ID]);

      const taskId = createdTask.id;

      // 1.2 Listar tareas
      const listRes1 = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(listRes1.status).toBe(200);
      expect(listRes1.headers.get('Cache-Control')).toBe('no-store');
      const listBody1 = (await listRes1.json()) as {
        items: Array<{ id: string; title: string }>;
        totalItems: number;
        page: number;
        limit: number;
        totalPages: number;
      };
      const parsedList1 = PaginatedTasksResponseSchema.safeParse(listBody1);
      expect(parsedList1.success).toBe(true);
      expect(listBody1.totalItems).toBe(1);
      expect(listBody1.items).toHaveLength(1);
      expect(listBody1.items[0]!.id).toBe(taskId);

      // 1.3 Editar campos y vaciar descripción
      setup.clock.setIsoString('2026-10-23T15:30:00.000Z');
      const updateRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Diseñar arquitectura hexagonal avanzada',
          priority: 'URGENT',
          description: '', // semántica de vaciado
          labels: ['hexagonal'],
        }),
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.headers.get('Cache-Control')).toBe('no-store');
      const updatedTask = (await updateRes.json()) as {
        id: string;
        title: string;
        priority: string;
        description?: string;
        labels: string[];
        updatedAt: string;
      };
      expect(updatedTask.id).toBe(taskId);
      expect(updatedTask.title).toBe('Diseñar arquitectura hexagonal avanzada');
      expect(updatedTask.priority).toBe('URGENT');
      expect(updatedTask.description).toBeUndefined();
      expect(updatedTask.labels).toEqual(['hexagonal']);
      expect(updatedTask.updatedAt).toBe('2026-10-23T15:30:00.000Z');

      // 1.4 Mover tarea a columna IN_PROGRESS
      setup.clock.setIsoString('2026-10-23T16:00:00.000Z');
      const moveRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          destinationColumnId: columnInProgressId,
          destinationIndex: 0,
        }),
      });

      expect(moveRes.status).toBe(200);
      expect(moveRes.headers.get('Cache-Control')).toBe('no-store');
      const movedTask = (await moveRes.json()) as {
        id: string;
        columnId: string;
        orderIndex: number;
        updatedAt: string;
      };
      expect(movedTask.id).toBe(taskId);
      expect(movedTask.columnId).toBe(columnInProgressId);
      expect(movedTask.orderIndex).toBe(0);
      expect(movedTask.updatedAt).toBe('2026-10-23T16:00:00.000Z');

      // 1.5 Listar tras movimiento verificando columna actualizada
      const listRes2 = await setup.app.request(
        `/api/projects/${projectId}/tasks?columnId=${columnInProgressId}`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': COLLABORATOR_ID },
        },
      );
      expect(listRes2.status).toBe(200);
      const listBody2 = (await listRes2.json()) as {
        items: Array<{ id: string; columnId: string }>;
      };
      expect(listBody2.items).toHaveLength(1);
      expect(listBody2.items[0]!.id).toBe(taskId);
      expect(listBody2.items[0]!.columnId).toBe(columnInProgressId);
    });
  });

  describe('2. Filtros combinados, orden estable, paginación y total filtrado', () => {
    beforeEach(async () => {
      // Crear un conjunto de tareas para pruebas de filtrado y ordenamiento
      const tasksToCreate = [
        {
          title: 'Alpha Tarea Backend',
          description: 'Documentación API',
          columnId: columnTodoId,
          priority: 'HIGH',
          labels: ['backend'],
          assigneeIds: [COLLABORATOR_ID],
        },
        {
          title: 'Beta Tarea Frontend',
          description: 'Componente Kanban Board',
          columnId: columnTodoId,
          priority: 'LOW',
          labels: ['frontend'],
          assigneeIds: [],
        },
        {
          title: 'Gamma Tarea Backend Crítica',
          description: 'Pruebas de concurrencia y seguridad',
          columnId: columnInProgressId,
          priority: 'URGENT',
          labels: ['backend', 'security'],
          assigneeIds: [COLLABORATOR_ID],
        },
        {
          title: 'Delta Tarea Base de Datos',
          description: 'Spike Neon Postgres',
          columnId: columnDoneId,
          priority: 'MEDIUM',
          labels: ['database'],
          assigneeIds: [],
        },
        {
          title: 'Epsilon Tarea Backend',
          description: 'Endpoints OpenAPI',
          columnId: columnDoneId,
          priority: 'HIGH',
          labels: ['backend'],
          assigneeIds: [COLLABORATOR_ID],
        },
      ];

      for (const t of tasksToCreate) {
        const res = await setup.app.request(`/api/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify(t),
        });
        expect(res.status).toBe(201);
      }
    });

    it('debe paginar correctamente con page y limit, calculando totalItems y totalPages', async () => {
      const resPage1 = await setup.app.request(`/api/projects/${projectId}/tasks?page=1&limit=2`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(resPage1.status).toBe(200);
      const data1 = (await resPage1.json()) as {
        items: Array<{ title: string }>;
        totalItems: number;
        page: number;
        limit: number;
        totalPages: number;
      };
      expect(data1.totalItems).toBe(5);
      expect(data1.page).toBe(1);
      expect(data1.limit).toBe(2);
      expect(data1.totalPages).toBe(3);
      expect(data1.items).toHaveLength(2);

      const resPage2 = await setup.app.request(`/api/projects/${projectId}/tasks?page=2&limit=2`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(resPage2.status).toBe(200);
      const data2 = (await resPage2.json()) as { items: Array<{ title: string }> };
      expect(data2.items).toHaveLength(2);
      // Los elementos de la página 2 no deben solaparse con la página 1
      expect(data2.items[0]!.title).not.toBe(data1.items[0]!.title);
      expect(data2.items[1]!.title).not.toBe(data1.items[1]!.title);
    });

    it('debe aplicar filtros individuales (prioridad, responsable, etiqueta, búsqueda) y AND combinados', async () => {
      // Filtro por prioridad
      const resPriority = await setup.app.request(
        `/api/projects/${projectId}/tasks?priority=HIGH`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      const dataPriority = (await resPriority.json()) as {
        items: Array<{ priority: string }>;
        totalItems: number;
      };
      expect(dataPriority.totalItems).toBe(2);
      expect(dataPriority.items.every((t) => t.priority === 'HIGH')).toBe(true);

      // Filtro por responsable
      const resAssignee = await setup.app.request(
        `/api/projects/${projectId}/tasks?assigneeId=${COLLABORATOR_ID}`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      const dataAssignee = (await resAssignee.json()) as {
        items: Array<{ assigneeIds: string[] }>;
        totalItems: number;
      };
      expect(dataAssignee.totalItems).toBe(3);
      expect(dataAssignee.items.every((t) => t.assigneeIds.includes(COLLABORATOR_ID))).toBe(true);

      // Filtro por etiqueta
      const resLabel = await setup.app.request(`/api/projects/${projectId}/tasks?label=security`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const dataLabel = (await resLabel.json()) as {
        items: Array<{ labels: string[] }>;
        totalItems: number;
      };
      expect(dataLabel.totalItems).toBe(1);
      expect(dataLabel.items[0]!.labels).toContain('security');

      // Filtro por búsqueda insensible a mayúsculas
      const resSearch = await setup.app.request(
        `/api/projects/${projectId}/tasks?search=concurrencia`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      const dataSearch = (await resSearch.json()) as {
        items: Array<{ description: string }>;
        totalItems: number;
      };
      expect(dataSearch.totalItems).toBe(1);
      expect(dataSearch.items[0]!.description).toContain('concurrencia');

      // Filtros COMBINADOS: priority=HIGH AND label=backend AND assigneeId
      const resCombined = await setup.app.request(
        `/api/projects/${projectId}/tasks?priority=HIGH&label=backend&assigneeId=${COLLABORATOR_ID}&search=Alpha`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      const dataCombined = (await resCombined.json()) as {
        items: Array<{ title: string }>;
        totalItems: number;
      };
      expect(dataCombined.totalItems).toBe(1);
      expect(dataCombined.items[0]!.title).toBe('Alpha Tarea Backend');
    });

    it('debe mantener orden determinista y estable (columnId asc, orderIndex asc, createdAt asc)', async () => {
      const res1 = await setup.app.request(`/api/projects/${projectId}/tasks?limit=100`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const data1 = (await res1.json()) as { items: Array<{ id: string }> };

      const res2 = await setup.app.request(`/api/projects/${projectId}/tasks?limit=100`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const data2 = (await res2.json()) as { items: Array<{ id: string }> };

      expect(data1.items.map((i) => i.id)).toEqual(data2.items.map((i) => i.id));
    });

    it('debe devolver totalItems: 0 y totalPages: 0 cuando no coinciden tareas', async () => {
      const res = await setup.app.request(
        `/api/projects/${projectId}/tasks?search=terminoInexistenteXYZ`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        items: unknown[];
        totalItems: number;
        totalPages: number;
      };
      expect(data.items).toEqual([]);
      expect(data.totalItems).toBe(0);
      expect(data.totalPages).toBe(0);
    });
  });

  describe('3. Aislamiento por proyecto y rechazo de identidad manipulada', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea aislada',
          columnId: columnTodoId,
        }),
      });
      const body = (await res.json()) as { id: string };
      taskId = body.id;
    });

    it('debe rechazar con 404 estricto peticiones de no miembros o docentes no asignados', async () => {
      // Outsider intentando listar
      const resOutsiderList = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': OUTSIDER_ID },
      });
      expect(resOutsiderList.status).toBe(404);

      // Docente no asignado intentando crear
      const resTeacherCreate = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': TEACHER_UNASSIGNED_ID,
        },
        body: JSON.stringify({ title: 'Intento ilegal', columnId: columnTodoId }),
      });
      expect(resTeacherCreate.status).toBe(404);

      // Outsider intentando editar
      const resOutsiderUpdate = await setup.app.request(
        `/api/projects/${projectId}/tasks/${taskId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': OUTSIDER_ID,
          },
          body: JSON.stringify({ title: 'Edición ilegal' }),
        },
      );
      expect(resOutsiderUpdate.status).toBe(404);

      // Outsider intentando mover
      const resOutsiderMove = await setup.app.request(
        `/api/projects/${projectId}/tasks/${taskId}/move`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': OUTSIDER_ID,
          },
          body: JSON.stringify({
            destinationColumnId: columnInProgressId,
            destinationIndex: 0,
          }),
        },
      );
      expect(resOutsiderMove.status).toBe(404);
    });

    it('la identidad del creador debe provenir exclusivamente del middleware y no del cuerpo de la petición', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea con suplantación intentada',
          columnId: columnTodoId,
          creatorId: 'otro-usuario-falso',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as { creatorId: string };
      // Debe conservar dev-student-01 del middleware
      expect(data.creatorId).toBe(CREATOR_ID);
    });

    it('no debe permitir mover una tarea a una columna perteneciente a otro proyecto (400 Bad Request)', async () => {
      // 1. Crear otro proyecto B con su propio tablero
      const resB = await setup.app.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Proyecto B',
          courseCode: 'IS-488',
          startDate: '2026-10-15T00:00:00.000Z',
          targetDate: '2026-12-20T00:00:00.000Z',
        }),
      });
      const dataB = (await resB.json()) as { id: string };
      const projectBId = dataB.id;

      const boardBRes = await setup.app.request(`/api/projects/${projectBId}/board`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      const boardB = (await boardBRes.json()) as { columns: Array<{ id: string }> };
      const columnProjectB = boardB.columns[0]!.id;

      // 2. Intentar mover tarea del proyecto A a la columna del proyecto B
      const moveRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          destinationColumnId: columnProjectB,
          destinationIndex: 0,
        }),
      });

      expect(moveRes.status).toBe(400);
      const err = (await moveRes.json()) as { error: string };
      expect(err.error).toBe('Bad Request');
    });
  });

  describe('4. Campos protegidos, datos inválidos y asignados no elegibles', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea para pruebas negativas',
          columnId: columnTodoId,
        }),
      });
      const body = (await res.json()) as { id: string };
      taskId = body.id;
    });

    it('debe rechazar con 400 Bad Request campos protegidos en PATCH, incluso cuando acompañen a un campo válido', async () => {
      const protectedFields = [
        { id: '11111111-2222-3333-4444-555555555555', title: 'Título válido' },
        { projectId: '11111111-2222-3333-4444-555555555555', title: 'Título válido' },
        { creatorId: 'usuario-manipulado', title: 'Título válido' },
        { columnId: columnInProgressId, title: 'Título válido' },
        { orderIndex: 5, title: 'Título válido' },
        { createdAt: '2026-10-23T00:00:00.000Z', title: 'Título válido' },
        { updatedAt: '2026-10-23T00:00:00.000Z', title: 'Título válido' },
      ];

      for (const payload of protectedFields) {
        const res = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify(payload),
        });

        expect(res.status).toBe(400);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const err = (await res.json()) as { error: string; message: string };
        expect(err.error).toBe('Bad Request');
        expect(err.message).toContain('No se permite modificar campos protegidos o de movimiento');
      }
    });

    it('debe rechazar con 400 Bad Request datos inválidos en creación de tarea', async () => {
      // Título muy corto
      const resShort = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ title: 'AB', columnId: columnTodoId }),
      });
      expect(resShort.status).toBe(400);

      // Prioridad inválida
      const resPriority = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Título correcto',
          columnId: columnTodoId,
          priority: 'SUPER_HIGH',
        }),
      });
      expect(resPriority.status).toBe(400);

      // Más de 5 etiquetas
      const resLabels = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Título correcto',
          columnId: columnTodoId,
          labels: ['1', '2', '3', '4', '5', '6'],
        }),
      });
      expect(resLabels.status).toBe(400);

      // JSON malformado
      const resMalformed = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: '{"title": "incompleto"',
      });
      expect(resMalformed.status).toBe(400);

      // Array como cuerpo
      const resArray = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify([{ title: 'Tarea en array', columnId: columnTodoId }]),
      });
      expect(resArray.status).toBe(400);
    });

    it('debe rechazar con 400 Bad Request asignados no miembros en creación y actualización', async () => {
      const nonMemberId = '99999999-8888-7777-6666-555555555555';

      // En creación
      const resCreate = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea con responsable ilegal',
          columnId: columnTodoId,
          assigneeIds: [nonMemberId],
        }),
      });
      expect(resCreate.status).toBe(400);
      const errCreate = (await resCreate.json()) as { error: string };
      expect(errCreate.error).toBe('Bad Request');

      // En actualización
      const resUpdate = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          assigneeIds: [nonMemberId],
        }),
      });
      expect(resUpdate.status).toBe(400);
    });

    it('debe rechazar con 400 Bad Request PATCH con cuerpo vacío ({})', async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('debe rechazar con 400 Bad Request parámetros de consulta inválidos en GET', async () => {
      const invalidQueries = [
        'page=0',
        'page=abc',
        'limit=0',
        'limit=101',
        'priority=INVALIDA',
        'columnId=no-es-uuid',
      ];

      for (const q of invalidQueries) {
        const res = await setup.app.request(`/api/projects/${projectId}/tasks?${q}`, {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        });
        expect(res.status).toBe(400);
      }
    });

    it('debe rechazar con 400 Bad Request UUIDs de ruta inválidos', async () => {
      const resInvalidProjectId = await setup.app.request('/api/projects/no-un-uuid/tasks', {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(resInvalidProjectId.status).toBe(400);

      const resInvalidTaskId = await setup.app.request(
        `/api/projects/${projectId}/tasks/no-un-uuid`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({ title: 'Prueba' }),
        },
      );
      expect(resInvalidTaskId.status).toBe(400);
    });
  });

  describe('5. Auditoría correcta y ausencia de cambios ante peticiones rechazadas', () => {
    it('debe registrar CREATED, UPDATED, MOVED en actividades y no alterar estado ante peticiones rechazadas', async () => {
      // 1. Crear tarea -> CREATED
      const createRes = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea auditada',
          columnId: columnTodoId,
        }),
      });
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      let snapshot = setup.kanbanStorage.getSnapshot(projectId);
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]!.action).toBe('CREATED');
      expect(snapshot.events[0]!.taskId).toBe(taskId);

      // 2. Intentar actualización inválida (asignado no miembro) -> Rechazado 400
      const rejectedUpdateRes = await setup.app.request(
        `/api/projects/${projectId}/tasks/${taskId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({
            title: 'Título no persistido',
            assigneeIds: ['88888888-7777-6666-5555-444444444444'],
          }),
        },
      );
      expect(rejectedUpdateRes.status).toBe(400);

      // Comprobar que no se emitió ninguna actividad y que el título no cambió
      snapshot = setup.kanbanStorage.getSnapshot(projectId);
      expect(snapshot.events).toHaveLength(1);
      const currentTask = snapshot.tasks.find((t) => t.id === taskId);
      expect(currentTask!.title).toBe('Tarea auditada');

      // 3. Actualización válida -> UPDATED
      const validUpdateRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ title: 'Tarea auditada v2' }),
      });
      expect(validUpdateRes.status).toBe(200);

      snapshot = setup.kanbanStorage.getSnapshot(projectId);
      expect(snapshot.events).toHaveLength(2);
      expect(snapshot.events[1]!.action).toBe('UPDATED');

      // 4. Actualización no-op (mismos valores) -> No emite actividad
      const noopUpdateRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ title: 'Tarea auditada v2' }),
      });
      expect(noopUpdateRes.status).toBe(200);

      snapshot = setup.kanbanStorage.getSnapshot(projectId);
      expect(snapshot.events).toHaveLength(2); // sin cambios

      // 5. Movimiento válido -> MOVED
      const moveRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          destinationColumnId: columnInProgressId,
          destinationIndex: 0,
        }),
      });
      expect(moveRes.status).toBe(200);

      snapshot = setup.kanbanStorage.getSnapshot(projectId);
      expect(snapshot.events).toHaveLength(3);
      expect(snapshot.events[2]!.action).toBe('MOVED');

      // 6. Movimiento no-op (misma columna y misma posición) -> No emite actividad
      const noopMoveRes = await setup.app.request(
        `/api/projects/${projectId}/tasks/${taskId}/move`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({
            destinationColumnId: columnInProgressId,
            destinationIndex: 0,
          }),
        },
      );
      expect(noopMoveRes.status).toBe(200);

      snapshot = setup.kanbanStorage.getSnapshot(projectId);
      expect(snapshot.events).toHaveLength(3); // sin cambios
    });
  });

  describe('6. Edición y movimiento concurrentes sin pérdida de cambios', () => {
    it('debe serializar operaciones concurrentes mediante mutex compartido garantizando atomicidad', async () => {
      // 1. Crear tarea
      const createRes = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea para concurrencia',
          columnId: columnTodoId,
          priority: 'LOW',
        }),
      });
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      // 2. Ejecutar simultáneamente: actualización de título y movimiento a IN_PROGRESS
      const [patchRes, moveRes] = await Promise.all([
        setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({ title: 'Título actualizado concurrentemente', priority: 'HIGH' }),
        }),
        setup.app.request(`/api/projects/${projectId}/tasks/${taskId}/move`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Dev-User-Id': CREATOR_ID,
          },
          body: JSON.stringify({
            destinationColumnId: columnInProgressId,
            destinationIndex: 0,
          }),
        }),
      ]);

      expect(patchRes.status).toBe(200);
      expect(moveRes.status).toBe(200);

      // 3. Verificar estado final en almacenamiento compartido
      const snapshot = setup.kanbanStorage.getSnapshot(projectId);
      const task = snapshot.tasks.find((t) => t.id === taskId);
      expect(task).toBeDefined();
      expect(task!.title).toBe('Título actualizado concurrentemente');
      expect(task!.priority).toBe('HIGH');
      expect(task!.columnId).toBe(columnInProgressId);
      expect(task!.orderIndex).toBe(0);
    });
  });

  describe('7. Integración de tareas con columnas usando el almacenamiento compartido', () => {
    it('debe compartir almacenamiento entre tablero y tareas: creación de columna, movimiento y migración atómica al eliminar columna', async () => {
      // 1. Crear una tarea en columnTodoId
      const createRes = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea para prueba de integración de columnas',
          columnId: columnTodoId,
        }),
      });
      expect(createRes.status).toBe(201);
      const task = (await createRes.json()) as { id: string };
      const taskId = task.id;

      // 2. Crear una nueva columna en el tablero: "En Pruebas"
      const colRes = await setup.app.request(`/api/projects/${projectId}/board/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          name: 'En Pruebas',
          category: 'IN_REVIEW',
          color: '#8b5cf6',
        }),
      });
      expect(colRes.status).toBe(201);
      const newCol = (await colRes.json()) as { id: string };
      const qaColumnId = newCol.id;

      // 3. Mover la tarea a la nueva columna "En Pruebas"
      const moveRes = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          destinationColumnId: qaColumnId,
          destinationIndex: 0,
        }),
      });
      expect(moveRes.status).toBe(200);

      // 4. Eliminar la columna "En Pruebas" migrando sus tareas a columnDoneId
      const deleteColRes = await setup.app.request(
        `/api/projects/${projectId}/board/columns/${qaColumnId}?targetColumnId=${columnDoneId}`,
        {
          method: 'DELETE',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(deleteColRes.status).toBe(200);
      const deleteColBody = (await deleteColRes.json()) as {
        success: boolean;
        deletedColumnId: string;
        migratedTasksCount: number;
      };
      expect(deleteColBody.success).toBe(true);
      expect(deleteColBody.migratedTasksCount).toBe(1);

      // 5. Verificar a través de /tasks que la tarea ahora reside en columnDoneId
      const listDoneRes = await setup.app.request(
        `/api/projects/${projectId}/tasks?columnId=${columnDoneId}`,
        {
          method: 'GET',
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        },
      );
      expect(listDoneRes.status).toBe(200);
      const listDoneBody = (await listDoneRes.json()) as {
        items: Array<{ id: string; columnId: string }>;
      };
      expect(listDoneBody.items).toHaveLength(1);
      expect(listDoneBody.items[0]!.id).toBe(taskId);
      expect(listDoneBody.items[0]!.columnId).toBe(columnDoneId);
    });
  });

  describe('8. Códigos de método no permitido (405 Method Not Allowed) y cabeceras Allow', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await setup.app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({
          title: 'Tarea para 405',
          columnId: columnTodoId,
        }),
      });
      const body = (await res.json()) as { id: string };
      taskId = body.id;
    });

    it('debe devolver 405 y Allow: GET, POST en /api/projects/:projectId/tasks para métodos no soportados', async () => {
      const unsupported = ['PUT', 'DELETE'];
      for (const m of unsupported) {
        const res = await setup.app.request(`/api/projects/${projectId}/tasks`, {
          method: m,
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('GET, POST');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
    });

    it('debe devolver 405 y Allow: PATCH en /api/projects/:projectId/tasks/:taskId para métodos no soportados', async () => {
      const unsupported = ['GET', 'POST', 'PUT', 'DELETE'];
      for (const m of unsupported) {
        const res = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: m,
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('PATCH');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
    });

    it('debe devolver 405 y Allow: POST en /api/projects/:projectId/tasks/:taskId/move para métodos no soportados', async () => {
      const unsupported = ['GET', 'PUT', 'PATCH', 'DELETE'];
      for (const m of unsupported) {
        const res = await setup.app.request(`/api/projects/${projectId}/tasks/${taskId}/move`, {
          method: m,
          headers: { 'X-Dev-User-Id': CREATOR_ID },
        });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('POST');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
    });
  });
});
