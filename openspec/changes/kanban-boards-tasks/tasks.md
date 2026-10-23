## 1. Shared Package: Domain Models, Ports, and Schemas (`packages/shared`)

- [x] 1.1 Definir entidades de dominio `Board`, `BoardColumn`, `ColumnCategory`, errores de dominio (`BoardNotFoundError`, `MaxColumnsReachedError`, `LastColumnDeletionError`, `ColumnNotEmptyError`) y la interfaz `BoardRepositoryPort` (con soporte para `findOrCreateDefaultBoard` seguro ante concurrencia) en `packages/shared/src/ports/board-repository.port.ts`.
- [x] 1.2 Definir entidades `Task`, `TaskPriority`, errores de dominio (`TaskNotFoundError`, `InvalidDestinationColumnError`, `IneligibleAssigneeError`) y la interfaz `TaskRepositoryPort` en `packages/shared/src/ports/task-repository.port.ts`.
- [x] 1.3 Definir la entidad `TaskActivityEvent`, `TaskActivityAction` y la interfaz `TaskActivityRepositoryPort` en `packages/shared/src/ports/task-activity-repository.port.ts`.
- [x] 1.4 Definir contratos Zod para tablero y columnas en `packages/shared/src/contracts/board.contract.ts`: `CreateBoardColumnSchema`, `UpdateBoardColumnSchema`, `DeleteBoardColumnQuerySchema`, `BoardResponseSchema`, `BoardColumnResponseSchema`.
- [x] 1.5 Definir contratos Zod para tareas en `packages/shared/src/contracts/task.contract.ts`: `CreateTaskSchema`, `UpdateTaskSchema`, `MoveTaskSchema`, `ListTasksQuerySchema`, `TaskResponseSchema`, `PaginatedTasksResponseSchema`.
- [x] 1.6 Exportar los nuevos puertos, errores, tipos y contratos en `packages/shared/src/index.ts`.
- [x] 1.7 Escribir pruebas unitarias de contratos en `packages/shared/src/contracts/board.contract.test.ts` y `task.contract.test.ts`, validando aceptación de datos conformes y rechazo estricto de títulos inválidos, prioridades desconocidas, límites de columnas y cronología de fechas.

## 2. Backend Application: Board & Column Use Cases and In-Memory Persistence (`apps/api`)

- [x] 2.1 Implementar adaptador en memoria `InMemoryBoardRepository` en `apps/api/src/infrastructure/adapters/repositories/in-memory-board.repository.ts` con soporte para creación, actualización, eliminación segura, transacciones y el método concurrente-seguro `findOrCreateDefaultBoard`.
- [x] 2.2 Implementar `GetProjectBoardUseCase` en `apps/api/src/application/use-cases/get-project-board.use-case.ts`, con inicialización perezosa e idempotente ante concurrencia de 3 columnas canónicas (`Por hacer`, `En progreso`, `Completado`) si el proyecto es nuevo, y validación estricta de autorización contextual (404 a no miembros y docentes no asignados).
- [x] 2.3 Escribir pruebas unitarias para `GetProjectBoardUseCase` en `apps/api/src/application/use-cases/get-project-board.use-case.test.ts` validando aislamiento horizontal contextual (rechazo con 404 a docentes no asignados), generación de columnas iniciales e invocaciones concurrentes simultáneas garantizando idempotencia.
- [x] 2.4 Implementar `CreateBoardColumnUseCase` y `UpdateBoardColumnUseCase` en `apps/api/src/application/use-cases/`, validando autorización contextual, límite de 10 columnas y secuencia de orden correlativa.
- [x] 2.5 Escribir pruebas unitarias para creación y actualización de columnas en `apps/api/src/application/use-cases/create-board-column.use-case.test.ts`, verificando el rechazo con 400 Bad Request al intentar crear una undécima columna y 404 ante docentes no asignados.
- [x] 2.6 Implementar puerto `BoardColumnDeletionPort`, su adaptador en memoria `InMemoryBoardColumnDeletionAdapter` con preparación de estado aislado y publicación atómica única coordinada por `ProjectLockManager` (sin saga ni compensación manual), y el caso de uso `DeleteBoardColumnUseCase` en `apps/api/src/application/use-cases/delete-board-column.use-case.ts`, revalidando dentro de la frontera transaccional para eliminar TOCTOU y garantizando denegación por defecto a docentes no asignados.
- [x] 2.7 Escribir pruebas unitarias y adversariales en `apps/api/src/application/use-cases/delete-board-column.use-case.test.ts`, `in-memory-board-column-deletion.adapter.test.ts`, `in-memory-board.repository.test.ts`, `in-memory-task.repository.test.ts` e `in-memory-task-activity.repository.test.ts`, verificando: fallo previo a publicación sin alteración de estado compartido, lecturas durante preparación observando estado íntegro sin fases intermedias, escrituras concurrentes serializadas mediante mutex compartido capturando y esperando ambas promesas con barreras explícitas, eliminación concurrente con creación/movimiento garantizando que ninguna tarea queda apuntando a una columna eliminada, inmutabilidad de id/projectId en tareas, conservación de auditoría inmutable, rechazo de lotes con proyectos mezclados, validación de revisión esperada y estados conflictivos con igual timestamp en saveBoard, índices contiguos e inversión de orden (primera a última y viceversa) en updateColumn.

## 3. Backend Application: Task Lifecycle, Move, Assignment & List Use Cases (`apps/api`)

- [ ] 3.1 Implementar adaptadores en memoria `InMemoryTaskRepository` e `InMemoryTaskActivityRepository` en `apps/api/src/infrastructure/adapters/repositories/`, con soporte para transacciones atómicas y algoritmo de desplazamiento contiguo de `orderIndex`.
- [x] 3.2 Implementar `CreateTaskUseCase` en `apps/api/src/application/use-cases/create-task.use-case.ts`, inyectando `MembershipRepositoryPort` para validar que todos los `assigneeIds` posean membresía activa en el proyecto, y registrando el evento de auditoría `CREATED`.
- [x] 3.3 Escribir pruebas unitarias para `CreateTaskUseCase` en `apps/api/src/application/use-cases/create-task.use-case.test.ts`, verificando asignación exitosa de miembros activos y rechazo estricto con 400 si se asigna a un usuario sin membresía activa en el proyecto.
- [ ] 3.4 Implementar `MoveTaskUseCase` en `apps/api/src/application/use-cases/move-task.use-case.ts`, validando pertenencia contextual de la tarea al proyecto y que la columna destino pertenezca al mismo tablero, ejecutando reordenamiento contiguo y registro de evento `MOVED` dentro de una transacción atómica única con rollback ante fallos.
- [ ] 3.5 Escribir pruebas unitarias para `MoveTaskUseCase` en `apps/api/src/application/use-cases/move-task.use-case.test.ts`, verificando persistencia atómica de nuevo orden, reversión completa ante fallos en auditoría, rechazo ante columna de otro proyecto (aislamiento horizontal incluyendo 404 a docentes no asignados) y emisión del evento de actividad.
- [ ] 3.6 Implementar `UpdateTaskUseCase` en `apps/api/src/application/use-cases/update-task.use-case.ts`, con validación de asignados y registro de modificaciones.
- [ ] 3.7 Implementar `ListTasksUseCase` en `apps/api/src/application/use-cases/list-tasks.use-case.ts`, proveyendo filtrado por columna, prioridad, responsable, etiquetas, paginación server-side y validación de acceso contextual (404 a no miembros y docentes no asignados).
- [ ] 3.8 Escribir pruebas unitarias para `ListTasksUseCase` en `apps/api/src/application/use-cases/list-tasks.use-case.test.ts`, validando filtros combinados, límites de página y aislamiento contextual entre proyectos (incluyendo rechazo 404 a docentes no asignados).

## 4. Backend Infrastructure: HTTP Routes, Request Validation, and OpenAPI Contract (`apps/api`)

- [ ] 4.1 Implementar manejadores HTTP para `/api/projects/:projectId/board` y `/api/projects/:projectId/board/columns` en `apps/api/src/infrastructure/http/routes/board.route.ts`.
- [ ] 4.2 Implementar manejadores HTTP para `/api/projects/:projectId/tasks` y `/api/projects/:projectId/tasks/:taskId/move` en `apps/api/src/infrastructure/http/routes/tasks.route.ts`.
- [ ] 4.3 Registrar las nuevas rutas en `apps/api/src/infrastructure/http/app.ts` bajo middleware de autenticación de desarrollo y validación Zod.
- [ ] 4.4 Actualizar la especificación OpenAPI en `apps/api/src/infrastructure/openapi/openapi.contract.ts` incluyendo todos los endpoints de tableros, columnas, tareas y movimientos con esquemas y respuestas de error (400, 401, 404, 409).
- [ ] 4.5 Escribir pruebas de integración HTTP con Vitest en `apps/api/src/infrastructure/http/routes/board.route.test.ts` y `tasks.route.test.ts`, comprobando ciclo completo de creación de columna, tarea, movimiento y validación contra esquema OpenAPI.

## 5. Frontend UI/UX: Accessible `@dnd-kit` Kanban Board, Column & Task Components (`apps/web`)

- [ ] 5.1 (Requiere autorización de dependencias Nivel D) Instalar `@dnd-kit/core`, `@dnd-kit/sortable` y `@dnd-kit/utilities` en `apps/web`.
- [ ] 5.2 Implementar `TaskCard` en `apps/web/src/components/TaskCard.tsx` utilizando `useSortable` de `@dnd-kit/sortable`, con badges de prioridad accesibles, fecha límite con alertas de vencimiento, etiquetas y foco visible por teclado.
- [ ] 5.3 Implementar `KanbanColumn` en `apps/web/src/components/KanbanColumn.tsx` con `SortableContext` vertical, contador accesible de tarjetas, indicador de categoría y botón de adición rápida.
- [ ] 5.4 Implementar `KanbanBoard` en `apps/web/src/components/KanbanBoard.tsx` con `DndContext`, sensores `PointerSensor` y `KeyboardSensor` (`sortableKeyboardCoordinates`), y anuncios auditivos ARIA en vivo (`aria-live`) para drag & drop accesible conforme a WCAG 2.1 AA.
- [ ] 5.5 Escribir pruebas de componentes en `apps/web/src/components/KanbanBoard.test.tsx` y `TaskCard.test.tsx` verificando renderizado inicial de columnas, tarjetas, accesibilidad por teclado y foco visible.

## 6. Frontend UI/UX: Modals, Filters, List View, and TanStack Query Integration (`apps/web`)

- [ ] 6.1 Implementar `CreateTaskModal` y `TaskDetailModal` en `apps/web/src/components/`, consumiendo miembros activos del proyecto para selección de responsables y mostrando historial de actividad de la tarea.
- [ ] 6.2 Implementar `TaskFiltersBar` y `TaskListView` en `apps/web/src/components/`, con tabla accesible, paginación server-side y filtros por estado/prioridad/responsable.
- [ ] 6.3 Implementar servicios API `board.service.ts` y `task.service.ts` en `apps/web/src/services/` tipados con `@is488/shared`.
- [ ] 6.4 Configurar hooks de mutación en TanStack Query para movimientos de tarjetas con actualización optimista de UI y reversión (rollback) automática ante error HTTP o de red.
- [ ] 6.5 Integrar el tablero Kanban y la vista de lista dentro de `ProjectDetail.tsx` con selector de vista (Tablero / Lista) y barra de herramientas contextual.
- [ ] 6.6 Escribir pruebas de componentes en `apps/web/src/components/TaskListView.test.tsx` y `CreateTaskModal.test.tsx` validando interacción de filtros, envío del formulario y rollback visual en mutación fallida.

## 7. Verification, Quality Gates & OpenSpec Conformance

- [ ] 7.1 Ejecutar suite completa de pruebas del monorepo (`npm test`) verificando que todas las pruebas unitarias y de integración pasan con código 0.
- [ ] 7.2 Ejecutar compuertas de análisis estático: `npm run lint`, `npm run typecheck` y `npm run format:check`, garantizando 0 errores y 0 advertencias.
- [ ] 7.3 Ejecutar compilación de producción (`npm run build`) verificando que no existan errores de empaquetado en ningún workspace.
- [ ] 7.4 Validar formalmente las especificaciones con `npx openspec validate kanban-boards-tasks --strict` y `npx openspec validate --all --strict`.
- [ ] 7.5 Verificar el estado de Git con `git status` y `git diff` para asegurar limpieza y preparar evidencia previa a solicitud de revisión humana.
