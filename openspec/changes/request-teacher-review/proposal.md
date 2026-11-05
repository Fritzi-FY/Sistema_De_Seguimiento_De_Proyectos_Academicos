## Why

El Sistema de Seguimiento de Proyectos Académicos (IS488) de la UNSCH cuenta con la infraestructura base de proyectos y membresías (`projects-teams`, EPIC-004) y tableros Kanban (`boards-tasks`, EPIC-005), así como la regla estricta de alcance docente (`Teacher scope`), que restringe el acceso de un docente exclusivamente a los proyectos que tiene formalmente asignados en `teacher_project_assignments`.

Sin embargo, el ciclo de retroalimentación pedagógica y evaluación formativa entre estudiantes y docentes aún no está implementado:
1. **Falta de canal formal de solicitud:** Los estudiantes no disponen de un mecanismo para solicitar la revisión y orientación formativa de su avance al docente responsable.
2. **Falta de dictamen y observaciones estructuradas:** El docente asignado no dispone de una vía para consignar observaciones pedagógicas, dictamen de revisión (`APPROVED` o `CHANGES_REQUESTED`) y orientaciones cualitativas (FR-012).
3. **Ausencia de trazabilidad cronológica:** No existe un registro inmutable que permita a las partes auditar el historial de revisiones, observaciones y evolución del proyecto.

### Alcance acotado de este incremento (Scope)

- **Solicitud a nivel de proyecto:** La revisión se formula directamente a nivel de proyecto e incluye:
  - `title`: Título o asunto sintético de la solicitud de revisión (3 a 120 caracteres).
  - `description`: Descripción detallada del avance inicial realizado por el equipo (10 a 2000 caracteres).
  - `evidenceUrl`: Enlace opcional a repositorio externo, documento o evidencia (máx. 500 caracteres, conforme a ADR-006 que pospone la subida de binarios).
- **Entregables formalmente fuera de este incremento:** El registro formal y gestión de la entidad de entregables (`deliverables` con fechas límite y metadatos específicos según FR-011 y la spec canónica) **queda explícitamente fuera de este incremento**, permitiendo validar el flujo de evaluación pedagógica de forma liviana e inmediata sin esperar a dicha entidad.

### Cierre del hueco del historial: Ciclo iterativo, tabla de acciones y secuencia monotónica

Para modelar de forma rigurosa los ciclos iterativos de corrección sin duplicar tablas ni perder trazabilidad:
1. **Mantenimiento de la misma revisión:** Al re-solicitar evaluación tras `CHANGES_REQUESTED`, el estudiante conserva el mismo identificador de revisión (`reviewId`). No se crean entidades huérfanas ni solicitudes desconectadas.
2. **Tabla de acciones unificada (`teacher_review_actions`) y secuencia monotónica:** Para mantener un esquema magro de exactamente dos tablas (`teacher_review_requests` y `teacher_review_actions`):
   - Cada respuesta docente se guarda como una acción inmutable (`action_type: 'TEACHER_RESPONSE'`, con actor docente, fecha, estado resultante y observaciones).
   - Cada re-solicitud del estudiante se guarda como una acción inmutable (`action_type: 'STUDENT_RESUBMISSION'`, con actor estudiante, fecha, descripción de los ajustes realizados y nuevo enlace opcional de evidencia).
   - **Orden determinista por secuencia:** Se asigna un número de secuencia estrictamente creciente (`sequence_number integer NOT NULL CHECK (sequence_number >= 1)`) asignado de forma atómica dentro de la misma transacción para cada revisión (`review_request_id`). Esto garantiza que el orden de las transiciones se conserve con absoluta fidelidad incluso si las marcas de tiempo de base de datos coinciden.
3. **Atomicidad estricta:** El cambio de estado en `teacher_review_requests` y el registro de la acción en `teacher_review_actions` con su número de secuencia se ejecutan **siempre dentro de la misma transacción de base de datos**. Si la inserción de la acción o la actualización de estado falla, se produce un rollback absoluto sin estados parciales.
4. **Control de concurrencia:** Se aplica bloqueo pesimista a nivel de fila (`SELECT ... FOR UPDATE`) sobre la solicitud para serializar transiciones concurrentes. Si dos re-solicitudes llegan en paralelo sobre el estado `CHANGES_REQUESTED`, la primera transacción procede exitosamente a `PENDING`, mientras que la segunda detecta que el estado ya cambió y es rechazada con HTTP 409 Conflict sin registrar acciones duplicadas.
5. **Historial cronológico determinista y reinicio real:** El historial completo se deriva directamente sin tablas de auditoría intermedias:
   - Evento 0 (Incepción): Creado a partir de `teacher_review_requests` (`INITIAL_REQUEST`, secuencia 0).
   - Eventos 1..N: Registros de `teacher_review_actions` ordenados estrictamente por `sequence_number ASC`.
   - Soporta íntegramente múltiples ciclos de corrección (p. ej., Solicitud ➔ Observación 1 ➔ Ajuste 1 ➔ Observación 2 ➔ Ajuste 2 ➔ Aprobación), sobreviviendo a reinicios reales de los procesos de API y de PostgreSQL en el entorno de pruebas sin pérdida de contexto ni divergencia.

### Política estricta de permisos, reasignación y pérdida de acceso

1. **Consulta restringida:**
   - La consulta del detalle de una revisión (`GET /api/projects/:projectId/reviews/:reviewId`) se restringe estrictamente a:
     a) El **estudiante solicitante original** (`requesterId === currentUserId`), siempre que conserve membresía activa en el proyecto (`status: "active"`).
     b) El **docente actualmente asignado** al proyecto en `teacher_project_assignments` (`TeacherProjectScopePort.isAssigned`).
   - Terceros (incluidos colaboradores del mismo proyecto que no fueron el solicitante original) o usuarios ajenos reciben `404 Not Found` uniforme para evitar divulgar observaciones pedagógicas individuales o confirmar la existencia del recurso.
2. **Reasignación docente:**
   - Si se reasigna el proyecto a un nuevo docente `T2` en `teacher_project_assignments`, `T2` puede consultar el historial completo de la revisión y atender solicitudes abiertas en estado `PENDING`.
   - La autoría original es inmutable: `requesterId` del estudiante y el `actorId` del docente original (`T1`) en sus respuestas previas se conservan sin alteración.
3. **Escenarios de pérdida de acceso:**
   - **Docente saliente desasignado:** En cuanto un docente deja de estar en `teacher_project_assignments` para ese proyecto, cualquier intento de consulta o respuesta retorna de inmediato `404 Not Found`.
   - **Estudiante con membresía retirada:** Si el estudiante solicitante pasa a `status: "removed"` en `project_memberships`, pierde de inmediato el acceso de consulta y re-solicitud (`404 Not Found`).

### Clarificación de Notificaciones y Dependencia de EPIC-007

- **Preservación del requisito canónico:** Se preserva íntegramente la exigencia de la especificación canónica:
  *"WHEN the assigned teacher submits a review THEN the system SHALL persist the review and notify relevant project members according to notification settings"*.
- **Distinción entre emisión verificable (EPIC-006) y entrega efectiva (EPIC-007):**
  - En **EPIC-006**, la emisión del evento de notificación se verifica contractualmente y de forma empírica en la frontera del puerto de dominio `ReviewNotificationPort` mediante un **NotificationTestSpy** en pruebas unitarias e integración (afirmando que el evento contiene `reviewId`, `reviewerId`, `status` y los `recipientUserIds` de los miembros activos del proyecto).
  - La **entrega efectiva según configuración y preferencias de los usuarios** depende estrictamente de **EPIC-007 (`audit-reports-notifications`)**, que introducirá el modelo de datos de preferencias de notificación por usuario y el motor de despacho persistente.

## What Changes

1. **Contratos y Dominio (`@is488/shared`):**
   - Esquemas Zod: `CreateReviewRequestSchema`, `RespondReviewRequestSchema`, `ResubmitReviewRequestSchema`, `ReviewDetailResponseSchema`.
   - Enumeración estricta de estados: `ReviewStatus` (`PENDING`, `CHANGES_REQUESTED`, `APPROVED`).
   - Tipos de acción: `ReviewActionType` (`TEACHER_RESPONSE`, `STUDENT_RESUBMISSION`), con `sequenceNumber`.
   - Puertos: `ReviewRepositoryPort` y `ReviewNotificationPort`.
2. **Casos de Uso (`apps/api/src/application/use-cases`):**
   - `RequestTeacherReviewUseCase`: Creación de la solicitud inicial en `teacher_review_requests`.
   - `RespondTeacherReviewUseCase`: Transición atómica de estado a `CHANGES_REQUESTED` o `APPROVED` e inserción en `teacher_review_actions` con asignación de secuencia monotónica, disparando `ReviewNotificationPort`.
   - `ResubmitTeacherReviewUseCase`: Transición atómica de `CHANGES_REQUESTED` a `PENDING` e inserción inmutable en `teacher_review_actions` con asignación de secuencia monotónica. Maneja rechazo 409 ante concurrencia.
   - `GetTeacherReviewUseCase`: Consulta restringida con reconstrucción determinista del historial completo ordenado por `sequenceNumber ASC`.
3. **Persistencia e Infraestructura (`apps/api`):**
   - Migración PostgreSQL `0006_collaboration_reviews.sql` con 2 tablas (`teacher_review_requests`, `teacher_review_actions`) y restricción `UNIQUE (review_request_id, sequence_number)`.
   - Transacciones con control de concurrencia (`FOR UPDATE`) en `SqlSession`.
   - Rutas HTTP Hono bajo `/api/projects/:projectId/reviews`.
   - Pruebas con `NotificationTestSpy` validando emisión con miembros relevantes.

## Capabilities

### Modified Capabilities

- `collaboration-reviews`: Formaliza el ciclo completo de revisión docente a nivel de proyecto, soporte de múltiples ciclos de corrección en la misma revisión, tabla unificada de acciones con secuencia monotónica per-revisión, serialización ante concurrencia, consulta restringida y derivación determinista del historial.

## Impact

- **Costo económico:** US\$ 0.00 recurrente. Persistencia sobre PostgreSQL local existente.
- **Riesgo:** Bajo. Migración aditiva sin modificar tablas previas ni alterar el núcleo de Kanban.
- **Gobernanza:** Fase 2 (Planificación - Nivel C). Requiere compuerta de aprobación antes de implementar.
