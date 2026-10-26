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

- [x] 3.1 Implementar adaptadores en memoria `InMemoryTaskRepository` e `InMemoryTaskActivityRepository` en `apps/api/src/infrastructure/adapters/repositories/`, con soporte para transacciones atómicas y algoritmo de desplazamiento contiguo de `orderIndex`.
- [x] 3.2 Implementar `CreateTaskUseCase` en `apps/api/src/application/use-cases/create-task.use-case.ts`, inyectando `MembershipRepositoryPort` para validar que todos los `assigneeIds` posean membresía activa en el proyecto, y registrando el evento de auditoría `CREATED`.
- [x] 3.3 Escribir pruebas unitarias para `CreateTaskUseCase` en `apps/api/src/application/use-cases/create-task.use-case.test.ts`, verificando asignación exitosa de miembros activos y rechazo estricto con 400 si se asigna a un usuario sin membresía activa en el proyecto.
- [x] 3.4 Implementar `MoveTaskUseCase` en `apps/api/src/application/use-cases/move-task.use-case.ts`, validando pertenencia contextual de la tarea al proyecto y que la columna destino pertenezca al mismo tablero, ejecutando reordenamiento contiguo y registro de evento `MOVED` dentro de una transacción atómica única con rollback ante fallos.
- [x] 3.5 Escribir pruebas unitarias para `MoveTaskUseCase` en `apps/api/src/application/use-cases/move-task.use-case.test.ts`, verificando persistencia atómica de nuevo orden, reversión completa ante fallos en auditoría, rechazo ante columna de otro proyecto (aislamiento horizontal incluyendo 404 a docentes no asignados) y emisión del evento de actividad.
- [x] 3.6 Implementar `UpdateTaskUseCase` en `apps/api/src/application/use-cases/update-task.use-case.ts`, con validación de asignados y registro de modificaciones.
- [x] 3.7 Implementar `ListTasksUseCase` en `apps/api/src/application/use-cases/list-tasks.use-case.ts`, proveyendo filtrado por columna, prioridad, responsable, etiquetas, paginación server-side y validación de acceso contextual (404 a no miembros y docentes no asignados).
- [x] 3.8 Escribir pruebas unitarias para `ListTasksUseCase` en `apps/api/src/application/use-cases/list-tasks.use-case.test.ts`, validando filtros combinados, límites de página y aislamiento contextual entre proyectos (incluyendo rechazo 404 a docentes no asignados).

## 4. Backend Infrastructure: HTTP Routes, Request Validation, and OpenAPI Contract (`apps/api`)

- [x] 4.1 Implementar enrutador de tablero y columnas en `apps/api/src/infrastructure/http/routes/board.route.ts`: `GET /api/projects/:projectId/board`, `POST /api/projects/:projectId/board/columns`, `PATCH /api/projects/:projectId/board/columns/:columnId` (edici?n y reordenamiento contiguo) y `DELETE /api/projects/:projectId/board/columns/:columnId` (eliminaci?n at?mica con targetColumnId opcional/requerido y rechazo de ?ltima columna), con `Cache-Control: no-store`, validaci?n estricta de UUIDs/payload, e identidad exclusiva del contexto.
- [x] 4.2 Implementar manejadores HTTP para `/api/projects/:projectId/tasks`, `/api/projects/:projectId/tasks/:taskId` y `/api/projects/:projectId/tasks/:taskId/move` en `apps/api/src/infrastructure/http/routes/tasks.route.ts`, con validación estricta de esquemas Zod, rechazo de campos protegidos (400 Bad Request), autorización contextual, métodos 405 y pruebas de integración exhaustivas en `tasks.route.test.ts`.
- [x] 4.3 Registrar rutas de tablero en `apps/api/src/infrastructure/http/app.ts` con una sola instancia compartida de `InMemoryKanbanProjectStorage` por aplicaci?n, asegurando aislamiento entre instancias de `createApp` y restricci?n de dev-auth a entornos expl?citos de desarrollo/pruebas.
- [x] 4.4 Actualizar especificaci?n OpenAPI en `apps/api/src/infrastructure/openapi/openapi.contract.ts` con los contratos y endpoints de tablero y columnas (4.A), documentando esquemas, par?metros, respuestas y c?digos de error (400, 401, 404, 409, 405, 500).
- [x] 4.5 Escribir pruebas de integraci?n HTTP en `apps/api/src/infrastructure/http/routes/board.route.test.ts` y pruebas de contrato en `openapi.contract.test.ts`, validando flujo completo de tablero y columnas, reordenamiento, aislamiento, l?mites, rechazo de identidades manipuladas y eliminaci?n at?mica con tareas preparadas mediante adaptadores.

## 5. Frontend UI/UX: Accessible `@dnd-kit` Kanban Board, Column & Task Components (`apps/web`)

- [x] 5.1 Instalar las dependencias aprobadas `@dnd-kit/core`, `@dnd-kit/sortable` y `@dnd-kit/utilities` en `apps/web`; no se añadieron dependencias adicionales.
- [x] 5.2 Implementar `TaskCard` en `apps/web/src/components/TaskCard.tsx` utilizando `useSortable`, con control dedicado de arrastre separado de Editar, metadatos accesibles y foco visible.
- [x] 5.3 Implementar `KanbanColumn` en `apps/web/src/components/KanbanColumn.tsx` con zona droppable/sortable, contador accesible, estado vacío y botón de adición rápida.
- [x] 5.4 Implementar `KanbanBoard` en `apps/web/src/components/KanbanBoard.tsx` con `DndContext`, sensores de puntero/teclado, anuncios `aria-live`, actualización optimista, reindexación contigua, serialización, rollback e invalidación de respuestas tardías.
- [x] 5.5 Escribir pruebas de componentes e integración en `KanbanBoard.test.tsx`, `KanbanBoard.move.test.tsx`, `KanbanColumn.test.tsx` y `TaskCard.test.tsx` para renderizado, reindexación, no-op, cancelación, foco, bloqueo, confirmación, rollback y cambio de proyecto.

## 6. Frontend UI/UX: Modals, Filters, List View, HTTP Services and Local React State (`apps/web`)

Decisión humana del 25 de octubre de 2026: consultas y mutaciones mediante servicios HTTP y estado local de React. TanStack Query queda fuera de EPIC-003, sin instalación ni migración. Las tareas 6.4 y 6.7 conservan los objetivos de sincronización y verificación; no exigen hooks ni caché de esa biblioteca.

- [x] 6.1 Implementar `CreateTaskModal` y `TaskDetailModal` en `apps/web/src/components/`, consumiendo miembros activos del proyecto para selección de responsables y mostrando historial de actividad de la tarea.
- [x] 6.2 Implementar `TaskFiltersBar` y `TaskListView` en `apps/web/src/components/`, con tabla accesible, paginación server-side y filtros por estado/prioridad/responsable.
- [x] 6.3 Implementar servicios API `board.service.ts` y `task.service.ts` en `apps/web/src/services/` tipados con `@is488/shared`, incluido el payload exclusivo de `/move` y validación de identidad.
- [x] 6.4 Integrar las mutaciones mediante servicios HTTP y estado local de React en las futuras vistas de lista y tablero, manteniendo actualización optimista, rollback exacto y sincronización tras confirmación. El movimiento del tablero ya está cubierto por 5.4 y 5.5; resta verificar la integración con la vista de lista.
- [x] 6.5 Integrar el tablero Kanban y la vista de lista dentro de `ProjectDetail.tsx` con selector de vista (Tablero / Lista) y barra de herramientas contextual.
- [x] 6.6 Escribir pruebas de componentes en `apps/web/src/components/TaskListView.test.tsx` y `CreateTaskModal.test.tsx` validando interacción de filtros, envío del formulario y rollback visual en mutación fallida. La lista paginada y las pruebas de filtros están verificadas en la ronda F.

- [x] 6.7 Verificar la coherencia entre tablero y lista tras consultas y mutaciones mediante servicios HTTP y estado local: filtros/paginación server-side, carga/error, confirmación/rollback y aislamiento de respuestas tardías al cambiar proyecto o consulta. Cubrir esos casos con pruebas de integración de componentes, sin TanStack Query.

## 7. Verification, Quality Gates & OpenSpec Conformance

### Incremento autorizado: historial HTTP y responsables en creación

- [x] H.1 Rastrear identidad de dev-auth a membresía y documentar bloqueo no UUID antes de cambiar contratos; conservar UUID y responsables existentes.
- [x] H.2 Añadir contrato de lista, caso de uso por puertos, ruta autenticada, composición y OpenAPI; probar orden, existencia, permisos/404, aislamiento y lectura sin efectos.
- [x] H.3 Integrar servicio/historial real; probar esquema/identidad/error/reintento y resoluciones/rechazos tras tarea/proyecto/desmontaje.
- [x] H.4 Reutilizar selección en creación, conservar validación/selección ante error, doble envío y bloqueo; probar elegibilidad, payload y regresiones de edición.
- [x] H.5 Ejecutar pruebas afectadas shared/API/web, typecheck, lint y formato pertinentes, sin suites globales.

6.1 no se declara completa mientras persista el bloqueo de asignaciones no UUID u otros requisitos pendientes. H.2 habilita la lectura que antes bloqueaba R.5; registros previos son históricos.

Verificación H: shared 28 pruebas/2 archivos, API 87/5 y web 75/11, todas aprobadas (190 pruebas afectadas, sin suite global). Typecheck shared/API/web, ESLint acotado y formato de los 19 archivos TS/TSX y cuatro artefactos aprobados. Builds shared, API (wrangler build dry-run, sin despliegue) y web aprobados. Se corrigieron anotaciones de tipos de respuestas unknown en pruebas API y un import type exigido por lint, sin debilitar aserciones. Avisos: React act en pruebas previas del tablero que ahora montan picker/historial y dos anotaciones Zod/Rollup en build web. OpenSpec CLI no disponible en PATH ni node_modules/.bin; validación formal bloqueada sin instalaciones. Sin navegador ni ejecución remota. Detalles y archivos: evidence/lista-paginada/historial-creacion.md desde raíz.

### Incremento autorizado: detalle y responsables

- [x] R.1 Verificar endpoints y contratos reales; documentar ausencia de historial HTTP y límite UUID de responsables.
- [x] R.2 Añadir miembros activos, responsables actuales, selección/remoción, validación, carga/vacío/error/reintento y aislamiento de respuestas tardías al modal existente.
- [x] R.3 Probar asignación, remoción total, patch sin cambios de responsables, IDs incompatibles, miembros ajenos/inactivos, fallos/reintento, doble envío, respuestas tardías y bloqueo del selector mediante la mutación existente.
- [x] R.4 Ejecutar pruebas proporcionales, typecheck frontend, lint y formato acotados, registrando resultados reales.
- [x] R.5 Historial real con carga/vacío/error/reintento: el bloqueo del incremento anterior queda resuelto y verificado por H.2 y H.3 con la autorización posterior de backend mínimo.

6.1 permanece abierta por la incompatibilidad de identidad no UUID y las capacidades amplias todavía pendientes. El historial anteriormente bloqueado se implementa en H.2/H.3 con la autorización posterior.

Resultados del incremento de responsables: 75 pruebas afectadas aprobadas en 9 archivos, incluido EditTaskModal.assignees.test.tsx (10 pruebas) y ProjectDetail.assignees.test.tsx (1 prueba de integración de PATCH con rechazo/éxito y selector). Typecheck frontend, ESLint de los cinco archivos TS/TSX modificados y Prettier de esos archivos y los cuatro artefactos finalizaron con código 0. Hay avisos React act en casos anteriores de respuestas tardías de KanbanBoard, incluyendo actualizaciones del modal al consultar miembros. No se ejecutaron suites globales, build, navegador ni comprobaciones remotas. OpenSpec formal continúa pendiente por ausencia del CLI registrada previamente. No se instalaron dependencias, modificaron backend/shared ni generó ZIP.

### Incremento autorizado: filtros server-side de Lista

- [x] F.1 Implementar TaskFiltersBar con borrador, Aplicar/Limpiar, omisión de vacíos y validación contractual; probar límites, combinación y accesibilidad.
- [x] F.2 Integrar consulta aplicada y página atómicas, conservar filtros en navegación/reintento, vacío accesible y orden recibido; probar consultas exactas y no filtrado local.
- [x] F.3 Obtener columnas mediante getBoard con carga/error/reintento independientes; probar resoluciones/rechazos tardíos de tareas y columnas tras filtros/proyecto/desmontaje.
- [x] F.4 Ejecutar pruebas afectadas, typecheck frontend, lint/formato acotados y comprobar disponibilidad de OpenSpec sin instalaciones. Registrar resultados reales; no ejecutar suites globales ni generar ZIP.

Evidencia de este incremento: 50 pruebas afectadas aprobadas en 7 archivos (incluidas pruebas anteriores de selector y servicios), typecheck frontend, ESLint de los 7 archivos TS/TSX modificados y Prettier de esos archivos y los cuatro artefactos aprobados con código 0. Se corrigió un hook de preparación de pruebas que devolvía un mock como función de limpieza; no se debilitaron aserciones. La disponibilidad de OpenSpec se comprobó en PATH y node_modules/.bin: CLI ausente; validación formal bloqueada, sin instalación ni descarga. F.4 acredita las comprobaciones acotadas y el registro del bloqueo, no una validación OpenSpec aprobada. No se ejecutaron suites globales, build ni navegador en este incremento; la comprobación manual de filtros queda pendiente. No se generó ZIP.

Este incremento no completa por sí solo las tareas amplias que incluyan responsables, historial, otras integraciones o verificación final del EPIC.

### Incremento: lista paginada de solo lectura y selector (Nivel D autorizado)

- [x] L.1 Implementar TaskListView mediante getTasks, limit 20 y metadatos del servidor; probar orden, navegación, límites, carga, vacío y reintento.
- [x] L.2 Integrar selector Tablero/Lista; probar consulta nueva de página 1 al entrar, reinicio por proyecto y descarte de resoluciones/rechazos tardíos.
- [x] L.3 Propagar operaciones pendientes del tablero y bloquear el selector sin desmontar; probar creación, edición y movimiento, éxito y rechazo, conservando las pruebas existentes.
- [ ] L.4 Ejecutar pruebas afectadas, typecheck, lint, formato de archivos modificados y build frontend; comprobar vistas y paginación en navegador local, conservar evidencia visual y ZIP verificado contra el worktree.

Las tareas 6.2, 6.4, 6.5, 6.6 y 6.7 permanecen abiertas mientras incluyan filtros, barra contextual u otras integraciones no cubiertas por este incremento. OpenSpec formal sigue pendiente por ausencia de CLI; no instalar ni descargar herramientas.

Verificación local de este incremento: 42 pruebas afectadas aprobadas en 7 archivos, typecheck del monorepo y lint con código 0, formato de los 9 archivos modificados aprobado y build frontend con código 0. La suite emitió un aviso de React act en un caso de respuesta tardía del tablero; Rollup emitió dos avisos de anotaciones de Zod. L.4 permanece pendiente: Computer Use se detuvo al no poder determinar la URL del navegador con suficiente confianza para aplicar su política; no se completó la comprobación de navegador ni se obtuvieron capturas. Detalles y manifiesto del ZIP en `evidence/lista-paginada/` desde la raíz del repositorio.

- [x] 7.1 Ejecutar suite completa de pruebas del monorepo (`npm test`) verificando que todas las pruebas unitarias y de integración pasan con código 0.
- [x] 7.2 Ejecutar compuertas de análisis estático: `npm run lint`, `npm run typecheck` y `npm run format:check`, garantizando 0 errores y 0 advertencias.
- [x] 7.3 Ejecutar compilación de producción (`npm run build`) verificando que no existan errores de empaquetado en ningún workspace.
- [x] 7.4 Validar formalmente las especificaciones con el CLI instalado: `openspec validate kanban-boards-tasks --strict` y `openspec validate --all --strict`.
- [ ] 7.5 Verificar el estado de Git con `git status` y `git diff` para asegurar limpieza y preparar evidencia previa a solicitud de revisión humana.

### Antecedentes históricos de 7.1 y 7.4 (no acreditan la ronda F)

- **7.1 conserva su marca histórica:** `cierre_4a_verificado.md` reporta `npm test` con código 0 y 417 pruebas (74 shared, 289 API y 54 web) para aquel incremento. La última suite web de 112 pruebas fue reportada por el usuario para un estado posterior; no equivale a una nueva suite completa del monorepo. No se ejecutan suites durante esta corrección documental ni se afirma que esos conteos acrediten el estado final de EPIC-003.
- **7.4 conserva su marca histórica:** los informes locales reportan validación estricta global con 8 artefactos aprobados. La validación de la consolidación actual se registra por separado, con los comandos y resultados realmente obtenidos; la marca previa no demuestra por sí sola la vigencia del diff documental.
- **Revisión documental del 25 de octubre de 2026:** se intentaron `openspec validate kanban-boards-tasks --strict` y `openspec validate --all --strict`; ambos quedaron bloqueados porque PowerShell no reconoce `openspec`. Tampoco se encontró el ejecutable en `node_modules/.bin`; no se instalaron herramientas. La validación formal de esta corrección queda pendiente. `git diff --check -- openspec/changes/kanban-boards-tasks` terminó con código 0; no sustituye OpenSpec ni una comprobación completa de formato Markdown.
- [x] 7.6 Al completar los incrementos funcionales restantes y contar con autorización, ejecutar y registrar la suite completa del monorepo y ambas validaciones estrictas de OpenSpec sobre el estado final. Esta comprobación de cierre es distinta de los antecedentes de 7.1 y 7.4.

## Pendientes registrados antes de I/C/F (consultar el resultado actual de F)

- [ ] 6.1 Resolver identidad de miembros no UUID antes de garantizar su asignación. Historial real y responsables UUID en creación/edición están implementados; falta comprobación manual de este incremento y la tarea amplia no se cierra.
- [ ] 6.2 Completar el filtro por responsable previsto por la tarea amplia; texto, columna, prioridad y etiqueta server-side ya están implementados y probados, al igual que la lista paginada.
- [ ] 6.4 Completar la integración de sincronización con los filtros futuros; la lista actual vuelve a consultar al entrar.
- [ ] 6.5 Completar barra contextual; el selector Tablero/Lista ya está implementado.
- [ ] 6.6 Pruebas de responsable y rollback visual de la integración restante; las pruebas de los cuatro filtros de este incremento están aprobadas.
- [ ] 6.7 Verificación de coherencia, carga/error y respuestas tardías de consultas y mutaciones al integrar lista y tablero, sin TanStack Query.
- [ ] 7.2 Compuertas finales de lint, typecheck y formato; lint/typecheck pasaron en este incremento y su formato acotado pasó, pero el formato global tiene fallos preexistentes reportados fuera del alcance y no se repitió.
- [ ] 7.3 Build de producción de todos los workspaces; solo está acreditado el build frontend.
- [ ] 7.5 Estado final limpio y preparación de revisión humana; el worktree conserva cambios preexistentes y no se autorizaron operaciones Git de publicación.
- [ ] 7.6 Suite completa y validaciones OpenSpec del estado final, diferenciadas de las ejecuciones históricas.

## Incremento I: identidad de desarrollo UUID

Autorización D explícita del usuario el 2026-10-26, limitada a configuración/fixtures y consumidores del worktree; sin operaciones Git, dependencias, suites globales ni ZIP.

- [x] I.1 Centralizar UUIDs fijos distintos y alinear cabeceras, AppShell, ProjectDetail y fixtures; verificar servicios y consumidores afectados.
- [x] I.2 Ejecutar flujo integrado de creación de proyecto, membresía activa, asignación al crear/editar e historial persistido en memoria, con aislamiento, rechazo de asignados incompatibles/inactivos y conservación de identidad textual; validar lint, tipos, build frontend y OpenSpec afectados.

La tarea amplia 6.1 y el cierre del EPIC permanecen abiertos; este incremento no acredita todas sus capacidades ni un E2E de navegador.

## Incremento C: gestión de columnas

Autorización D explícita del usuario para gestión de columnas en el worktree/rama actuales.

- [x] C.1 Servicios create/update/delete de columnas con validación contractual e identidad; pruebas positivas/negativas.
- [x] C.2 Controles accesibles de creación, nombre, orden y eliminación confirmada con destino; bloqueo mutuo, doble envío, errores y respuestas tardías; pruebas de componentes.
- [x] C.3 Verificar Tablero y opciones Lista actualizados, flujo HTTP real de columnas y restricciones existentes; pruebas afectadas, typecheck/lint/formato acotados y OpenSpec estricto.

Resultado C: 92 pruebas frontend en 11 archivos y 1 flujo HTTP real aislado aprobados; repetición final de 16 pruebas de gestor/movimiento aprobada. Typecheck web, lint/formato acotados, build web y OpenSpec 1.7.0 estricto aprobados. Evidencia: `evidence/lista-paginada/columnas.md`. Sin ampliaciones backend/shared ni reinicios. Revisión visual manual/E2E/CI y cierre global del EPIC pendientes; las tareas amplias anteriores no se declaran completas por este incremento.

## Verificación final autorizada F (2026-10-26)

Autorización explícita del usuario para completar frontend ya especificado, una ronda global final, intento de navegador y un único ZIP, preservando cambios locales y sin Git de escritura ni archivo OpenSpec.

- [x] F.1 Contrastar especificación/tareas con código y separar implementación, pruebas actuales, evidencia histórica y manual.
- [x] F.2 Completar filtro assigneeId y barra contextual; verificar paginación, filtros aplicados, aislamiento y anuncios accesibles.
- [x] F.3 Corregir avisos act del EPIC con esperas de efectos y promesas controladas, sin silenciar ni debilitar pruebas.
- [x] F.4 Ejecutar una ronda final completa (suite, tipos, lint, formato, builds, OpenSpec estricto), corrigiendo solo fallos del EPIC y repitiendo solo comprobaciones afectadas.
- [x] F.5 Intentar navegador; si está bloqueado, registrar una sola lista manual, sin atribuciones sin evidencia.
- [x] F.6 Generar un ZIP de revisión con snapshot de archivos del EPIC, SHA-256, estado Git, diff rastreado e informe, excluyendo secretos/dependencias/builds. No cerrar el EPIC.

### Resultado actual de F y alcance de las marcas

6.1 usa el detalle existente EditTaskModal; 6.2 incluye ahora assigneeId; 6.4/6.7 se verifican con mutaciones del Tablero y reconsulta de Lista (solo lectura conforme a la especificación aprobada); 6.5 incluye actualización contextual que conserva query aplicada; 6.6 dispone de pruebas actuales de filtros y rollback. Sus marcas acreditan implementación y pruebas automatizadas de la ronda F, no comprobación manual.

7.1/7.4 ya no dependen de las marcas históricas: se ejecutaron de nuevo en F. Resultado actual: 613 pruebas/65 archivos, tipos y lint globales aprobados, formato global inicialmente fallido en 12 archivos del EPIC y corrección/check acotado de esos 12 aprobados; builds shared/API dry-run/web aprobados; OpenSpec activo y global estricto (8 artefactos) aprobados. Tras corrección de formato API se repitieron 15 pruebas afectadas; los dos flujos HTTP reales aislados aprobaron 1 prueba cada uno. No se repitió la suite global. No hubo avisos act en la ronda final. Dos avisos PURE de Zod/Rollup son ajenos a la implementación y no impiden build.

L.4 y revisión manual siguen pendientes: Computer Use detectó Brave pero cua.getApp terminó en timeout de aprobación, sin ejecución del flujo. 7.5 sigue abierta por su condición de árbol limpio: el estado/diff se inspeccionan y entregan, conservando todos los cambios locales. E2E de navegador, CI, revisión humana y cierre/archivo del EPIC no se declaran realizados. Matriz, única lista manual y resultados: evidence/epic-003-final/auditoria.md e informe.md. El ZIP es revisión, no cierre ni nivel E.

## Publicación en borrador autorizada (posterior a F)

El usuario autoriza preparar commits coherentes conservando los existentes, publicar únicamente feature/epic-003-kanban-boards-tasks sin force-push y abrir un PR en borrador hacia main. Se revisan expresamente archivos nuevos y se excluyen ZIP, builds, secretos y artefactos temporales. La conformidad visual general se registra sin atribuir pruebas específicas no comunicadas (evidence/epic-003-final/conformidad-visual.md). No se reejecutan suites mientras el código permanezca idéntico al snapshot aprobado. L.4, E2E/CI según su resultado real y cierre del EPIC mantienen sus límites; publicar no autoriza merge, rebase, reset, amend, despliegue ni archivado OpenSpec. El estado final de commits/PR/CI se comunicará con sus identificadores reales, sin marcar el EPIC cerrado.
