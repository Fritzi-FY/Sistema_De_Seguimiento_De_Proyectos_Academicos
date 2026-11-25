import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_ASSISTANT_DISCLAIMER,
  AIAnalysisResponseSchema,
  FakeAIProvider,
  InMemoryAIQuotaAdapter,
  AITimeoutError,
  AIAuthenticationError,
} from '@is488/shared';
import { createApp } from '../app.js';
import { InMemoryProjectRepository } from '../../adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../adapters/repositories/in-memory-teacher-project-scope.adapter.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const otherStudentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '33333333-3333-4333-8333-333333333333';
const unauthorizedUserId = '44444444-4444-4444-8444-444444444444';
const nonExistentProjectId = '99999999-9999-4999-8999-999999999999';

type JsonBody = {
  error?: string;
  message?: string;
  reason?: string;
  retryAfterSeconds?: number;
  projectId?: string;
};

describe('AI Assistant HTTP Route: POST /api/projects/:projectId/ai/analysis', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let otherProjectId: string;
  let fakeAIProvider: FakeAIProvider;
  let inMemoryQuota: InMemoryAIQuotaAdapter;
  let teacherScopeMap: Map<string, readonly string[]>;

  async function postAnalysis(
    pId: string,
    body?: unknown,
    userId: string | null = studentId,
    role = 'student',
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (userId !== null) {
      headers['X-Dev-User-Id'] = userId;
      headers['X-Dev-User-Role'] = role;
    }

    return app.request(`/api/projects/${pId}/ai/analysis`, {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeEach(async () => {
    projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    otherProjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    fakeAIProvider = new FakeAIProvider();
    inMemoryQuota = new InMemoryAIQuotaAdapter();
    teacherScopeMap = new Map();
    teacherScopeMap.set(teacherId, [projectId]);

    const projectRepo = new InMemoryProjectRepository();
    const membershipRepo = new InMemoryMembershipRepository();

    const now = '2026-11-20T10:00:00.000Z';

    // Proyecto A
    await projectRepo.save({
      id: projectId,
      title: 'Sistema de Seguimiento IS488',
      courseCode: 'IS488',
      status: 'active',
      startDate: now,
      targetDate: now,
      creatorId: studentId,
      createdAt: now,
      updatedAt: now,
    });
    await membershipRepo.addMember({
      id: 'mem-1',
      projectId,
      userId: studentId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
      removedAt: null,
    });

    // Proyecto B
    await projectRepo.save({
      id: otherProjectId,
      title: 'Proyecto B de Prueba',
      courseCode: 'IS488',
      status: 'active',
      startDate: now,
      targetDate: now,
      creatorId: otherStudentId,
      createdAt: now,
      updatedAt: now,
    });
    await membershipRepo.addMember({
      id: 'mem-2',
      projectId: otherProjectId,
      userId: otherStudentId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
      removedAt: null,
    });

    app = createApp({
      nodeEnv: 'test',
      projectRepository: projectRepo,
      membershipRepository: membershipRepo,
      teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(teacherScopeMap),
      aiProvider: fakeAIProvider,
      aiQuota: inMemoryQuota,
    });
  });

  describe('200 OK — Generación exitosa de análisis', () => {
    it('genera análisis con cuerpo vacío (focus por defecto "full") e inyecta disclaimer del servidor', async () => {
      const response = await postAnalysis(projectId, {});
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');

      const data = await response.json();
      const parsed = AIAnalysisResponseSchema.parse(data);

      expect(parsed.projectId).toBe(projectId);
      expect(parsed.analysis.progressSummary).toBeDefined();
      expect(parsed.analysis.riskSignals).toBeInstanceOf(Array);
      expect(parsed.analysis.nextSteps).toBeInstanceOf(Array);
      expect(parsed.meta.disclaimer).toBe(AI_ASSISTANT_DISCLAIMER);
      expect(parsed.meta.model).toBe('fake-ai-model-v1');
    });

    it('genera análisis sin enviar cuerpo en la solicitud', async () => {
      const response = await postAnalysis(projectId, undefined);
      expect(response.status).toBe(200);

      const data = (await response.json()) as JsonBody;
      expect(data.projectId).toBe(projectId);
    });

    it('acepta enfoque específico "risks" y "progress"', async () => {
      const respRisks = await postAnalysis(projectId, { focus: 'risks' });
      expect(respRisks.status).toBe(200);

      const respProgress = await postAnalysis(projectId, { focus: 'progress' });
      expect(respProgress.status).toBe(200);
    });

    it('permite que un docente asignado al proyecto solicite el análisis', async () => {
      const response = await postAnalysis(projectId, {}, teacherId, 'teacher');
      expect(response.status).toBe(200);

      const data = (await response.json()) as JsonBody;
      expect(data.projectId).toBe(projectId);
    });
  });

  describe('400 Bad Request — Validación de entrada y prevención de suplantación', () => {
    it('rechaza projectId que no sea un UUID válido', async () => {
      const response = await postAnalysis('not-a-uuid', {});
      expect(response.status).toBe(400);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('UUID');
    });

    it('rechaza cuerpo que contenga un JSON malformado', async () => {
      const response = await app.request(`/api/projects/${projectId}/ai/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': studentId,
          'X-Dev-User-Role': 'student',
        },
        body: '{ malformed json ',
      });
      expect(response.status).toBe(400);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Bad Request');
    });

    it('rechaza cuerpo con valor de focus no permitido', async () => {
      const response = await postAnalysis(projectId, { focus: 'grading' });
      expect(response.status).toBe(400);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Bad Request');
    });

    it('rechaza intento de suplantación de identidad mediante inyección de userId en el cuerpo', async () => {
      const response = await postAnalysis(projectId, {
        userId: otherStudentId,
        focus: 'full',
      });
      expect(response.status).toBe(400);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('inválido');
    });
  });

  describe('401 Unauthorized — Autenticación requerida', () => {
    it('rechaza solicitudes sin identidad autenticada', async () => {
      const response = await postAnalysis(projectId, {}, null);
      expect(response.status).toBe(401);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('403 Forbidden — Autorización y Aislamiento Horizontal', () => {
    it('rechaza a un usuario no perteneciente al proyecto', async () => {
      const response = await postAnalysis(projectId, {}, unauthorizedUserId);
      expect(response.status).toBe(403);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Forbidden');
    });

    it('aislamiento horizontal: miembro del Proyecto B no puede solicitar análisis del Proyecto A', async () => {
      const response = await postAnalysis(projectId, {}, otherStudentId);
      expect(response.status).toBe(403);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Forbidden');
    });
  });

  describe('404 Not Found — Proyecto inexistente', () => {
    it('devuelve 404 si el proyecto no existe', async () => {
      const response = await postAnalysis(nonExistentProjectId, {});
      expect(response.status).toBe(404);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Not Found');
    });
  });

  describe('429 Too Many Requests — Control de cuotas y concurrencia', () => {
    it('devuelve 429 cuando se supera el límite de 5 análisis por proyecto en 10 minutos', async () => {
      // Consumir 5 análisis exitosos
      for (let i = 0; i < 5; i++) {
        const okResp = await postAnalysis(projectId, {});
        expect(okResp.status).toBe(200);
      }

      // El sexto análisis debe ser rechazado
      const rateLimitedResp = await postAnalysis(projectId, {});
      expect(rateLimitedResp.status).toBe(429);
      expect(rateLimitedResp.headers.get('Retry-After')).toBeDefined();

      const body = (await rateLimitedResp.json()) as JsonBody;
      expect(body.error).toBe('Too Many Requests');
      expect(body.reason).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('devuelve 429 con IN_FLIGHT_CONFLICT si el usuario tiene una solicitud activa', async () => {
      // Simular solicitud en vuelo en el adaptador de cuotas
      const fakeQuota = {
        async checkAndAcquire() {
          return { allowed: false, reason: 'IN_FLIGHT_CONFLICT', retryAfterSeconds: 30 };
        },
        async release() {},
      };

      const inFlightApp = createApp({
        nodeEnv: 'test',
        projectRepository: new InMemoryProjectRepository([
          {
            id: projectId,
            title: 'Test',
            courseCode: 'IS488',
            status: 'active',
            startDate: '2026-11-20T10:00:00.000Z',
            targetDate: '2026-11-20T10:00:00.000Z',
            creatorId: studentId,
            createdAt: '2026-11-20T10:00:00.000Z',
            updatedAt: '2026-11-20T10:00:00.000Z',
          },
        ]),
        membershipRepository: new InMemoryMembershipRepository(),
        teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(),
        aiProvider: fakeAIProvider,
        aiQuota: fakeQuota,
      });

      const response = await inFlightApp.request(`/api/projects/${projectId}/ai/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': studentId,
          'X-Dev-User-Role': 'student',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(429);
      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Too Many Requests');
      expect(body.reason).toBe('IN_FLIGHT_CONFLICT');
      expect(response.headers.get('Retry-After')).toBe('30');
    });
  });

  describe('502 Bad Gateway — Respuesta malformada del modelo', () => {
    it('devuelve 502 si el modelo devuelve JSON inválido o estructura no conforme', async () => {
      fakeAIProvider.setResponse('invalid non-json text');

      const response = await postAnalysis(projectId, {});
      expect(response.status).toBe(502);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Bad Gateway');
      expect(body.message).toContain('formato válido');
    });
  });

  describe('503 Service Unavailable — Proveedor no disponible o no configurado', () => {
    it('devuelve 503 si el proveedor lanza AIProviderUnavailableError', async () => {
      fakeAIProvider.setShouldFailUnavailable(true);

      const response = await postAnalysis(projectId, {});
      expect(response.status).toBe(503);

      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Service Unavailable');
    });

    it('devuelve 503 si las credenciales del proveedor de IA no están configuradas', async () => {
      const failingProvider = {
        async generateCompletion() {
          throw new AIAuthenticationError('Clave no configurada');
        },
      };

      const unconfiguredApp = createApp({
        nodeEnv: 'test',
        projectRepository: new InMemoryProjectRepository([
          {
            id: projectId,
            title: 'Test',
            courseCode: 'IS488',
            status: 'active',
            startDate: '2026-11-20T10:00:00.000Z',
            targetDate: '2026-11-20T10:00:00.000Z',
            creatorId: studentId,
            createdAt: '2026-11-20T10:00:00.000Z',
            updatedAt: '2026-11-20T10:00:00.000Z',
          },
        ]),
        membershipRepository: new InMemoryMembershipRepository(),
        teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(),
        aiProvider: failingProvider,
        aiQuota: inMemoryQuota,
      });

      const response = await unconfiguredApp.request(`/api/projects/${projectId}/ai/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': studentId,
          'X-Dev-User-Role': 'student',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(503);
      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Service Unavailable');
    });
  });

  describe('504 Gateway Timeout — Expiración de tiempo de respuesta', () => {
    it('devuelve 504 si el proveedor de IA lanza AITimeoutError (tiempo de espera agotado)', async () => {
      const timeoutProvider = {
        async generateCompletion() {
          throw new AITimeoutError('Timeout del proveedor de IA');
        },
      };

      const timeoutApp = createApp({
        nodeEnv: 'test',
        projectRepository: new InMemoryProjectRepository([
          {
            id: projectId,
            title: 'Test',
            courseCode: 'IS488',
            status: 'active',
            startDate: '2026-11-20T10:00:00.000Z',
            targetDate: '2026-11-20T10:00:00.000Z',
            creatorId: studentId,
            createdAt: '2026-11-20T10:00:00.000Z',
            updatedAt: '2026-11-20T10:00:00.000Z',
          },
        ]),
        membershipRepository: new InMemoryMembershipRepository(),
        teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(),
        aiProvider: timeoutProvider,
        aiQuota: inMemoryQuota,
      });

      const response = await timeoutApp.request(`/api/projects/${projectId}/ai/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': studentId,
          'X-Dev-User-Role': 'student',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(504);
      const body = (await response.json()) as JsonBody;
      expect(body.error).toBe('Gateway Timeout');
    });
  });

  describe('GET /api/projects/:projectId/ai/capabilities — Permiso efectivo y coherencia con POST', () => {
    const activeMemberId = '55555555-5555-4555-8555-555555555555';
    const removedMemberId = '66666666-6666-4666-8666-666666666666';
    const unassignedTeacherId = '77777777-7777-4777-8777-777777777777';
    const unassignedAdminId = '88888888-8888-4888-8888-888888888888';

    async function createCapabilitiesTestApp() {
      const now = '2026-11-20T10:00:00.000Z';
      const projectRepo = new InMemoryProjectRepository([
        {
          id: projectId,
          title: 'Sistema de Seguimiento IS488',
          courseCode: 'IS488',
          status: 'active',
          startDate: now,
          targetDate: now,
          creatorId: studentId,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const membershipRepo = new InMemoryMembershipRepository();
      await membershipRepo.addMember({
        id: 'mem-owner',
        projectId,
        userId: studentId,
        role: 'owner',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
        removedAt: null,
      });
      await membershipRepo.addMember({
        id: 'mem-active',
        projectId,
        userId: activeMemberId,
        role: 'collaborator',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
        removedAt: null,
      });
      await membershipRepo.addMember({
        id: 'mem-removed',
        projectId,
        userId: removedMemberId,
        role: 'collaborator',
        status: 'removed',
        joinedAt: now,
        updatedAt: now,
        removedAt: now,
      });

      return createApp({
        nodeEnv: 'test',
        projectRepository: projectRepo,
        membershipRepository: membershipRepo,
        teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(
          new Map([[teacherId, [projectId]]]),
        ),
        aiProvider: new FakeAIProvider(),
        aiQuota: new InMemoryAIQuotaAdapter(),
      });
    }

    it('rechaza 401 sin sesión y 400 con projectId inválido, y 404 si el proyecto no existe', async () => {
      const testApp = await createCapabilitiesTestApp();

      const unauth = await testApp.request(`/api/projects/${projectId}/ai/capabilities`, {
        method: 'GET',
      });
      expect(unauth.status).toBe(401);

      const badId = await testApp.request('/api/projects/not-a-uuid/ai/capabilities', {
        method: 'GET',
        headers: { 'X-Dev-User-Id': studentId, 'X-Dev-User-Role': 'student' },
      });
      expect(badId.status).toBe(400);

      const missing = await testApp.request(`/api/projects/${nonExistentProjectId}/ai/capabilities`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': studentId, 'X-Dev-User-Role': 'student' },
      });
      expect(missing.status).toBe(404);
    });

    it.each([
      { label: 'creador autorizado', userId: studentId, role: 'student' },
      { label: 'miembro activo autorizado', userId: activeMemberId, role: 'student' },
      { label: 'docente asignado autorizado', userId: teacherId, role: 'teacher' },
    ])('permite $label: capabilities=true y POST /analysis=200', async ({ userId, role }) => {
      const testApp = await createCapabilitiesTestApp();

      const capRes = await testApp.request(`/api/projects/${projectId}/ai/capabilities`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': userId, 'X-Dev-User-Role': role },
      });
      expect(capRes.status).toBe(200);
      expect(capRes.headers.get('Cache-Control')).toBe('no-store');
      expect(await capRes.json()).toEqual({ projectId, canUseAIAssistant: true });

      const postRes = await testApp.request(`/api/projects/${projectId}/ai/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': userId,
          'X-Dev-User-Role': role,
        },
        body: JSON.stringify({}),
      });
      expect(postRes.status).toBe(200);
    });

    it.each([
      { label: 'docente no asignado', userId: unassignedTeacherId, role: 'teacher' },
      { label: 'administrador sin asignación', userId: unassignedAdminId, role: 'admin' },
      { label: 'miembro retirado', userId: removedMemberId, role: 'student' },
      { label: 'usuario sin relación', userId: unauthorizedUserId, role: 'student' },
    ])('rechaza $label: capabilities=false y POST /analysis=403', async ({ userId, role }) => {
      const testApp = await createCapabilitiesTestApp();

      const capRes = await testApp.request(`/api/projects/${projectId}/ai/capabilities`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': userId, 'X-Dev-User-Role': role },
      });
      expect(capRes.status).toBe(200);
      expect(capRes.headers.get('Cache-Control')).toBe('no-store');
      expect(await capRes.json()).toEqual({ projectId, canUseAIAssistant: false });

      const postRes = await testApp.request(`/api/projects/${projectId}/ai/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': userId,
          'X-Dev-User-Role': role,
        },
        body: JSON.stringify({}),
      });
      expect(postRes.status).toBe(403);
    });
  });
});
