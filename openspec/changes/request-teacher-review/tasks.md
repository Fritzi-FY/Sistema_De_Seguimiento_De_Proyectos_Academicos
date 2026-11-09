# Tasks: Implementación del Flujo de Revisión Docente a Nivel de Proyecto

> Estado de Implementación: Nivel D autorizado para los bloques 1 (dominio/contratos), 2 (casos de uso, adaptador en memoria y pruebas en `apps/api`), 3 (persistencia y configuración de suites PostgreSQL) y 4 (API HTTP, OpenAPI y verificación integral de reinicio). El cierre final permanece pendiente.

## 1. Compuertas de Autorización y Modelado de Dominio (`@is488/shared`)

- [x] 1.1 Obtener de forma explícita la Autorización Nivel D exclusivamente para el incremento de dominio, contratos y sus pruebas (las autorizaciones para casos de uso, persistencia/migraciones, HTTP y verificación final permanecen pendientes).
- [x] 1.2 Definir los tipos de dominio, enumeraciones `ReviewStatus` (`PENDING`, `CHANGES_REQUESTED`, `APPROVED`), `ReviewActionType` (`TEACHER_RESPONSE`, `STUDENT_RESUBMISSION`) y esquemas Zod en `packages/shared/src/contracts/review.contract.ts` (`CreateReviewRequestSchema`, `RespondReviewRequestSchema`, `ResubmitReviewRequestSchema`, `ReviewDetailResponseSchema`), incluyendo el campo `sequenceNumber` para orden determinista de acciones.
- [x] 1.3 Implementar pruebas unitarias para los esquemas Zod de contratos en `packages/shared/src/contracts/review.contract.test.ts` (validación de campos obligatorios, longitud de comentarios/ajustes 5-2000 chars, formato URL opcional, `sequenceNumber >= 1`, y rechazo de estados no permitidos).
- [x] 1.4 Definir los puertos de dominio en `packages/shared/src/ports/review-repository.port.ts` (`ReviewRepositoryPort`) y `packages/shared/src/ports/review-notification.port.ts` (`ReviewNotificationPort`), exportándolos desde el índice de paquetes compartidos.

## 2. Casos de Uso de Aplicación y Pruebas Unitarias (`apps/api`)

- [x] 2.1 Implementar el adaptador en memoria `InMemoryReviewRepository` en `apps/api/src/infrastructure/adapters/repositories/in-memory-review.repository.ts` implementando la tabla unificada de acciones, asignación monotónica de `sequenceNumber` y derivación determinista del historial.
- [x] 2.2 Crear el doble de prueba `NotificationTestSpy` para `ReviewNotificationPort` permitiendo verificar en pruebas unitarias e integración la emisión verificable del evento con los destinatarios y parámetros exactos, documentando la dependencia de entrega efectiva hacia EPIC-007.
- [x] 2.3 Implementar `RequestTeacherReviewUseCase` en `apps/api/src/application/use-cases/request-teacher-review.use-case.ts` validando membresía activa del solicitante en el proyecto y estado inicial `PENDING`.
- [x] 2.4 Escribir pruebas unitarias para `RequestTeacherReviewUseCase` en `apps/api/src/application/use-cases/request-teacher-review.use-case.test.ts` (éxito para owner y colaborador activo, rechazo 404 para estudiante con membresía retirada, rechazo 404 para proyectos inexistentes).
- [x] 2.5 Implementar `RespondTeacherReviewUseCase` en `apps/api/src/application/use-cases/respond-teacher-review.use-case.ts` validando verificación explícita de rol docente (403 para no docentes), asignación del docente con `TeacherProjectScopePort` (404 si no está asignado), actualización atómica de estado con inserción en `teacher_review_actions` con `sequenceNumber` incremental y manejo protegido de notificación post-guardado (capturando fallos de consulta de destinatario y despacho sin afectar el resultado guardado).
- [x] 2.6 Escribir pruebas unitarias para `RespondTeacherReviewUseCase` en `apps/api/src/application/use-cases/respond-teacher-review.use-case.test.ts` (rechazo 403 para rol estudiante, rechazo 404 para docentes no asignados o desasignados, éxito para docente asignado con APPROVED y CHANGES_REQUESTED, propagación de fallos de persistencia sin notificar, y resiliencia ante fallos en consulta de membresía o despacho de notificación post-guardado conservando la revisión).
- [x] 2.7 Implementar `ResubmitTeacherReviewUseCase` en `apps/api/src/application/use-cases/resubmit-teacher-review.use-case.ts` permitiendo al solicitante activo re-solicitar evaluación tras `CHANGES_REQUESTED` sobre la misma revisión, transicionando el estado a `PENDING`, insertando la acción inmutable con `sequenceNumber` incremental y serializando concurrencia con rechazo 409 Conflict.
- [x] 2.8 Escribir pruebas unitarias para `ResubmitTeacherReviewUseCase` en `apps/api/src/application/use-cases/resubmit-teacher-review.use-case.test.ts` (éxito desde CHANGES_REQUESTED, rechazo 409 si el estado ya no es CHANGES_REQUESTED, rechazo 404 si no es el solicitante original con membresía activa).
- [x] 2.9 Implementar `GetTeacherReviewUseCase` en `apps/api/src/application/use-cases/get-teacher-review.use-case.ts` restringiendo la consulta exclusivamente al solicitante con membresía activa y al docente actualmente asignado, derivando el historial cronológico determinista ordenado por `sequenceNumber ASC`.
- [x] 2.10 Escribir pruebas unitarias para `GetTeacherReviewUseCase` en `apps/api/src/application/use-cases/get-teacher-review.use-case.test.ts` (consulta permitida a solicitante activo y docente asignado, reasignación atendida por nuevo docente con autores originales intactos, rechazo 404 para otros miembros del proyecto, rechazo 404 para docente desasignado y rechazo 404 para estudiante retirado).

## 3. Persistencia Relacional y Migración PostgreSQL (`apps/api`)

- [x] 3.1 Redactar el script SQL de migración aditiva `apps/api/migrations/sql/0006_collaboration_reviews.sql` creando las dos tablas relacionales `teacher_review_requests` y `teacher_review_actions` (con `sequence_number integer NOT NULL` y restricción `UNIQUE (review_request_id, sequence_number)`), con claves foráneas referenciando `public.projects(id)` y `teacher_review_requests(id)` con `ON DELETE RESTRICT` e índices de optimización temporal.
- [x] 3.2 Actualizar el catálogo de migraciones en `apps/api/migrations/manifest.json` y los privilegios de runtime en `apps/api/migrations/runtime-privileges.ts` con permisos estrictos de DML (`SELECT`, `INSERT`, `UPDATE`).
- [x] 3.3 Implementar el adaptador PostgreSQL `PostgresqlReviewRepository` en `apps/api/src/infrastructure/postgresql/review.repository.ts` utilizando transacciones atómicas `SqlSession.transaction` con bloqueo de fila `FOR UPDATE` para garantizar consistencia, asignación de secuencia monotónica y reversión total ante fallos.
- [x] 3.4 Escribir pruebas de integración con PostgreSQL en `apps/api/src/infrastructure/postgresql/review.sql.test.ts` verificando:
  - Flujo de dos ciclos de corrección completos (Solicitud ➔ Observación 1 ➔ Ajuste 1 ➔ Observación 2 ➔ Ajuste 2 ➔ Aprobación) y comprobación del orden exacto por `sequence_number ASC` incluso ante timestamps coincidentes.
  - Ejecutar un **reinicio real de los procesos de la API y de PostgreSQL en el entorno de pruebas** (detención y levantamiento efectivo de instancias/servicios, no solo reinicios simulados en memoria) comprobando la supervivencia fidedigna del estado y del historial. Verificado localmente por HTTP: dos ciclos de corrección, aprobación, seis eventos, salida final exitosa de `pg_ctl`, nuevo proceso API y comparación completa del detalle antes/después. Evidencia en `apps/api/.local-dev/review-http-<id>/{before,after}.json`.
  - Dos re-solicitudes concurrentes sobre el estado `CHANGES_REQUESTED`, verificando que una triunfa y la otra falla con 409 sin registrar acciones duplicadas.
  - Rollback estricto ante fallo intencionado en la inserción de la acción, verificando que el estado de la solicitud no cambia y no quedan filas huérfanas.

## 4. Adaptador HTTP, Rutas y Contrato OpenAPI (`apps/api`)

- [x] 4.1 Implementar el enrutador HTTP Hono en `apps/api/src/infrastructure/http/routes/reviews.route.ts` exponiendo `POST /`, `POST /:reviewId/response`, `POST /:reviewId/re-submit` y `GET /:reviewId` con cabeceras `Cache-Control: no-store` y middleware de autenticación.
- [x] 4.2 Integrar el enrutador de revisiones en `apps/api/src/infrastructure/http/app.ts` montado bajo la ruta `/api/projects/:projectId/reviews`.
- [x] 4.3 Actualizar la especificación y contratos OpenAPI en `apps/api/src/infrastructure/openapi/openapi.contract.ts` documentando endpoints, esquemas de entrada/salida y códigos de estado HTTP (200, 201, 400, 401, 403, 404, 409, 500).
- [x] 4.4 Escribir pruebas de integración HTTP en `apps/api/src/infrastructure/http/routes/reviews.route.test.ts` cubriendo el ciclo completo: solicitud, respuesta docente, re-solicitud tras CHANGES_REQUESTED, aprobación, pérdida de acceso tras desasignación/retiro, y rechazo 404 ante otros miembros del equipo.

## 5. Verificación Empírica y Cierre de Implementación

- [ ] 5.1 Ejecutar linter y formateo (`npm run lint`), comprobando que no existan advertencias ni errores de estilo.
- [ ] 5.2 Ejecutar verificación de tipos (`npm run typecheck` y `typecheck:preparation`), asegurando cero errores de compilación TypeScript.
- [ ] 5.3 Ejecutar la suite completa de pruebas unitarias y de integración (`npm test`), verificando que todas las aserciones pasen de forma exitosa tras el reinicio real de servicios.
- [ ] 5.4 Comprobar la salida limpia de `git status` y presentar evidencia empírica real de ejecución antes de solicitar la compuerta de revisión final.
