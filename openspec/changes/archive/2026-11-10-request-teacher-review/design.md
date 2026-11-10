# Design: Flujo de Revisión Docente a Nivel de Proyecto (Collaboration and Reviews)

## 1. Contexto y Límites de Alcance

Este diseño establece la solución técnica para el flujo de revisión docente en IS488:

- **Alcance acotado a nivel de proyecto:** La solicitud se formula directamente sobre el proyecto. Se compone de un título, una descripción del avance alcanzado por el equipo y un enlace opcional de evidencia (conforme a ADR-006).
- **Entregables formalmente diferidos:** El modelado y gestión formal de la entidad de entregables (`deliverables`, FR-011) queda diferido fuera de este incremento, simplificando la verificación y reduciendo la superficie de riesgo.
- **Arquitectura Hexagonal:** Dominio independiente en `@is488/shared`, puertos de persistencia y notificación desacoplados, y adaptadores de infraestructura para PostgreSQL, HTTP (Hono) y pruebas.

```
       [ HTTP Client (Web / Tests) ]
                     │
                     ▼
       ┌───────────────────────────┐
       │     HTTP Router (Hono)    │
       │   /api/projects/:id/...   │
       └─────────────┬─────────────┘
                     │ (Zod Schemas)
                     ▼
       ┌───────────────────────────┐
       │   Application Use Cases   │
       │ - RequestTeacherReview    │
       │ - RespondTeacherReview    │
       │ - ResubmitTeacherReview   │
       │ - GetTeacherReview        │
       └─────┬───────────────┬─────┘
             │               │
             ▼               ▼
      [ ReviewRepoPort ]  [ ReviewNotificationPort ]
             │                       │
      ┌──────┴──────┐                ▼
      ▼             ▼         [NotificationTestSpy]
[PostgresqlRepo] [InMemoryRepo] (EPIC-007 pendiente)
```

## 2. Dominio, Ciclo Iterativo y Máquina de Estados

### 2.1 Estados y Transiciones

- `ReviewStatus`: `'PENDING' | 'CHANGES_REQUESTED' | 'APPROVED'`
- `ReviewActionType`: `'TEACHER_RESPONSE' | 'STUDENT_RESUBMISSION'`

Transiciones permitidas:
1. `(Incepción)` ➔ `PENDING`: Solicitud inicial creada por estudiante con membresía activa en el proyecto (`teacher_review_requests`). Secuencia lógica 0.
2. `PENDING` ➔ `CHANGES_REQUESTED`: El docente asignado emite observaciones solicitando ajustes (`teacher_review_actions` con `actionType: 'TEACHER_RESPONSE'` y secuencia monotónica incremental).
3. `PENDING` ➔ `APPROVED`: El docente asignado emite dictamen aprobatorio (`teacher_review_actions` con `actionType: 'TEACHER_RESPONSE'` y secuencia monotónica incremental). Estado terminal para esa revisión.
4. `CHANGES_REQUESTED` ➔ `PENDING`: El estudiante re-solicita evaluación sobre la **misma revisión**, adjuntando la descripción de ajustes y nuevo enlace opcional (`teacher_review_actions` con `actionType: 'STUDENT_RESUBMISSION'` y secuencia monotónica incremental).

```
   ┌─────────────┐
   │ (Inception) │
   └──────┬──────┘
          │ POST /reviews (status: PENDING)
          ▼
   ┌─────────────┐   POST /response (status: CHANGES_REQUESTED)   ┌───────────────────┐
   │   PENDING   │ ─────────────────────────────────────────────► │ CHANGES_REQUESTED │
   └──────┬──────┘                                                └─────────┬─────────┘
          │                                                                 │
          │ POST /response (status: APPROVED)                               │ POST /re-submit
          ▼                                                                 ▼ (status: PENDING)
   ┌─────────────┐                                                ┌───────────────────┐
   │  APPROVED   │ ◄───────────────────────────────────────────── │      PENDING      │
   └─────────────┘                                                └───────────────────┘
```

### 2.2 Re-solicitud sobre la Misma Revisión y Concurrencia
- Al invocar `POST /api/projects/:projectId/reviews/:reviewId/re-submit`:
  - Se verifica que el solicitante sea el creador original y conserve membresía activa (`status: 'active'`).
  - Se abre una transacción en PostgreSQL y se adquiere un bloqueo pesimista de fila:
    `SELECT * FROM public.teacher_review_requests WHERE id = $1 FOR UPDATE;`
  - Se valida que `status === 'CHANGES_REQUESTED'`. Si otra petición concurrente ya cambió el estado a `PENDING`, la transacción actual aborta y responde con `409 Conflict`.
  - Se calcula atómicamente el siguiente número de secuencia:
    `SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM public.teacher_review_actions WHERE review_request_id = $1;`
  - Se actualiza `status` a `'PENDING'` y `updated_at` a la hora actual.
  - Se inserta una fila inmutable en `teacher_review_actions` con `sequence_number`, los detalles de los ajustes (`comment`) y enlace opcional.
  - Ambas escrituras se confirman en el mismo commit atómico.

## 3. Control de Acceso Estricto y Escenarios de Pérdida de Acceso

### 3.1 Consulta Restringida
La consulta de la revisión (`GET /api/projects/:projectId/reviews/:reviewId`) exige que el usuario sea:
1. El **estudiante solicitante original** (`review.requesterId === userId`) Y tenga membresía activa en el proyecto (`status: 'active'`).
2. El **docente actualmente asignado** (`TeacherProjectScopePort.isAssigned(userId, projectId) === true`).

Cualquier otro usuario (incluyendo colaboradores del mismo proyecto que no formularon la solicitud o docentes no asignados) recibe `404 Not Found`.

### 3.2 Reasignación Docente y Pérdida de Acceso
- **Reasignación:** Si el proyecto se reasigna a un nuevo docente `T2` en `teacher_project_assignments`:
  - `T2` puede consultar el historial completo y responder solicitudes `PENDING`.
  - La autoría original de `T1` en sus respuestas previas queda inmutable (`actorId: 'T1'`).
- **Docente saliente desasignado:** `T1` ya no figura en `teacher_project_assignments` para ese proyecto; por tanto, cualquier consulta o intento de respuesta de `T1` falla de inmediato con `404 Not Found`.
- **Estudiante con membresía retirada:** Si el estudiante pasa a `status: 'removed'` en `project_memberships`, pierde de inmediato el acceso a consultar y a re-solicitar evaluación (`404 Not Found`).

## 4. Esquema Relacional de 2 Tablas (Historial Derivado sin Duplicación)

El modelo de datos utiliza exactamente **dos tablas relacionales**:

```sql
-- 1. Solicitudes de revisión a nivel de proyecto
CREATE TABLE public.teacher_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  requester_id text NOT NULL CHECK (length(btrim(requester_id)) > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  evidence_url text CHECK (char_length(evidence_url) <= 500),
  status text NOT NULL CHECK (status IN ('PENDING', 'CHANGES_REQUESTED', 'APPROVED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 2. Acciones inmutables de revisión (respuestas docentes y re-solicitudes estudiantiles)
CREATE TABLE public.teacher_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_request_id uuid NOT NULL REFERENCES public.teacher_review_requests(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  actor_role text NOT NULL CHECK (actor_role IN ('student', 'teacher')),
  action_type text NOT NULL CHECK (action_type IN ('TEACHER_RESPONSE', 'STUDENT_RESUBMISSION')),
  status text NOT NULL CHECK (status IN ('PENDING', 'CHANGES_REQUESTED', 'APPROVED')),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 5 AND 2000),
  evidence_url text CHECK (char_length(evidence_url) <= 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (review_request_id, sequence_number)
);

CREATE INDEX teacher_review_requests_project_idx ON public.teacher_review_requests(project_id, created_at DESC);
CREATE INDEX teacher_review_actions_request_idx ON public.teacher_review_actions(review_request_id, sequence_number ASC);
```

### 4.1 Derivación Determinista del Historial Completo por Secuencia
Al consultar el detalle de la revisión:
1. **Evento 0 (Incepción):**
   - `sequenceNumber`: `0`
   - `actionType`: `'INITIAL_REQUEST'`
   - `actorId`: `teacher_review_requests.requester_id`
   - `actorRole`: `'student'`
   - `status`: `'PENDING'`
   - `comment`: `teacher_review_requests.description`
   - `evidenceUrl`: `teacher_review_requests.evidence_url`
   - `createdAt`: `teacher_review_requests.created_at`
2. **Eventos 1..N (Acciones subsecuentes):**
   - Filas de `teacher_review_actions` ordenadas estrictamente por `sequence_number ASC`.
   - Cada fila proyecta de forma fidedigna el número de secuencia (`sequence_number`), actor (`actor_id`), rol (`actor_role`), tipo (`TEACHER_RESPONSE` o `STUDENT_RESUBMISSION`), estado (`status`), observaciones/ajustes (`comment`), evidencia opcional y fecha inmutable (`created_at`).

La ordenación por `sequence_number ASC` garantiza el orden determinista exacto de las transiciones incluso en caso de marcas de tiempo idénticas por granularidad de reloj o ejecuciones secuenciales rápidas.

### 4.2 Atomicidad y Rollback
Cualquier mutación (respuesta docente o re-solicitud estudiantil) se ejecuta dentro de `SqlSession.transaction(...)`. Si la inserción en `teacher_review_actions` o la actualización en `teacher_review_requests` arroja error:
- Se ejecuta `ROLLBACK` en PostgreSQL.
- El estado y la tabla de acciones quedan intactos.
- La API responde con `HTTP 500 Internal Server Error` sin exponer trazas internas.

## 5. Estrategia de Notificaciones y Dependencia de EPIC-007

### 5.1 Preservación del Requisito Canónico
La especificación canónica establece:
*"WHEN the assigned teacher submits a review THEN the system SHALL persist the review and notify relevant project members according to notification settings"*.

### 5.2 Puerto de Dominio y Dobles de Prueba
- Se define el puerto formal en el dominio:
  ```typescript
  export interface ReviewNotificationPayload {
    projectId: string;
    reviewId: string;
    reviewerId: string;
    status: 'APPROVED' | 'CHANGES_REQUESTED';
    recipientUserIds: readonly string[];
  }

  export interface ReviewNotificationPort {
    notifyReviewCompleted(payload: ReviewNotificationPayload): Promise<void>;
  }
  ```
- **Distinción entre emisión (EPIC-006) y entrega efectiva (EPIC-007):**
  - En **EPIC-006**, se valida empíricamente en la suite de pruebas que el caso de uso `RespondTeacherReviewUseCase` invoca `ReviewNotificationPort` con la carga esperada (`NotificationTestSpy`).
  - La **entrega efectiva según configuración y preferencias de los usuarios** depende de **EPIC-007 (`audit-reports-notifications`)**, que proporcionará el esquema de preferencias de notificación por usuario y el subsistema de despacho de notificaciones persistidas.

### 5.3 Política ante Fallo del Puerto de Notificaciones Post-Escritura
- **Persistencia prioritaria y atómica:** La actualización del estado y el registro de la acción en la base de datos se ejecutan y confirman atómicamente antes de intentar emitir cualquier notificación. Si la persistencia falla, el error se propaga de inmediato al llamador (HTTP 500) y **no se intenta notificar**.
- **Resiliencia ante fallo de notificación:** Si la respuesta docente ya quedó guardada correctamente, el caso de uso devuelve el resultado exitoso (HTTP 200).
- **Diagnóstico estructurado sin datos sensibles:** Los fallos arrojados por el puerto de notificaciones se capturan específicamente y se registran mediante el mecanismo de diagnóstico existente (`console.error` con JSON estructurado indicando `stage: 'review-notification'`, `outcome: 'failed'`, `projectId`, `reviewId` y tipo de error), **sin incluir observaciones, enlaces, comentarios ni datos sensibles**.
- **Alcance acotado:** Este bloque **no garantiza entrega ni reintentos de notificaciones**, responsabilidades que quedan diferidas formalmente a **EPIC-007**.

### 5.4 Destinatarios Autorizados y Permisos de Consulta
- La notificación se restringe estrictamente a los usuarios con permiso de consulta activo sobre la revisión evaluada.
- El único estudiante con permiso de consulta es el **solicitante original**, y únicamente si mantiene **membresía activa (`status: 'active'`)** en el proyecto en el momento de la respuesta.
- Si la membresía del solicitante fue retirada (`status: 'removed'`) antes de la respuesta docente, `recipientUserIds` queda vacío y no se le despacha notificación, preservando el principio de menor privilegio.

## 6. Puertos y Casos de Uso

### 6.1 `ReviewRepositoryPort`
```typescript
export interface ReviewRepositoryPort {
  createRequest(
    data: Omit<TeacherReviewRequest, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TeacherReviewRequest>;

  findById(
    projectId: string,
    reviewId: string,
  ): Promise<(TeacherReviewRequest & { actions: TeacherReviewAction[] }) | null>;

  resubmitRequest(
    projectId: string,
    reviewId: string,
    action: Omit<TeacherReviewAction, 'id' | 'createdAt' | 'sequenceNumber'>,
  ): Promise<TeacherReviewRequest>;

  recordTeacherResponse(
    projectId: string,
    reviewId: string,
    action: Omit<TeacherReviewAction, 'id' | 'createdAt' | 'sequenceNumber'>,
    newStatus: 'APPROVED' | 'CHANGES_REQUESTED',
  ): Promise<TeacherReviewRequest>;
}
```

## 7. Trade-offs y Decisiones de Diseño

1. **Tabla de Acciones Unificada con Secuencia Monotónica:** Consolida el diálogo iterativo en una sola tabla normalizada con ordenamiento temporal garantizado por `sequence_number`, resolviendo colisiones de reloj y evitando joins complejos.
2. **Entregables pospuestos:** Al posponer `deliverables` (FR-011) a su propio incremento, se entrega valor pedagógico inmediato sin bloquearse por la complejidad de hitos, fechas límite ni enlaces masivos.
3. **Consulta restringida a solicitante y docente:** Se descarta la visibilidad pública o a todo el equipo de las revisiones individuales, protegiendo la privacidad pedagógica y evitando fuga de datos entre estudiantes.
