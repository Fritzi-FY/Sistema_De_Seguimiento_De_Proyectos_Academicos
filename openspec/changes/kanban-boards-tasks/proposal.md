## Why

El Sistema de Seguimiento de Proyectos Académicos (IS488) cuenta con la línea base de gestión de proyectos y membresías establecida en los EPICs previos. Sin embargo, para cumplir con los requisitos funcionales FR-007, FR-008 y FR-009 y los criterios de aceptación globales, es indispensable proveer a los equipos académicos (estudiantes y docentes de la UNSCH) la capacidad de descomponer el trabajo en tareas, organizarlas en tableros Kanban interactivos y configurables, asignar responsables verificados, controlar fechas límite y prioridades, y disponer de una vista de lista con ordenamiento y paginación en el servidor.

Adicionalmente, el seguimiento pedagógico y la integridad de los datos exigen garantías rigurosas de consistencia:
1. **Acceso contextual restringido:** los docentes únicamente pueden consultar y gestionar proyectos a los que estén formalmente asignados, manteniendo aislamiento horizontal defensivo (HTTP 404 ante proyectos no asignados).
2. **Atomicidad transaccional completa:** las transiciones de estado, movimientos entre columnas y reasignaciones por eliminación de columnas deben ejecutarse en transacciones atómicas con reversión íntegra ante fallos, registrando eventos de actividad inmutables para cada tarea afectada.
3. **Inicialización idempotente y segura ante concurrencia:** la creación perezosa del tablero y sus columnas canónicas debe ser estrictamente idempotente para evitar duplicados o fallos de carrera cuando múltiples solicitudes accedan en paralelo.
4. **Accesibilidad universal:** la interfaz de usuario debe garantizar cumplimiento WCAG 2.1 AA mediante navegación completa por teclado y anuncios auditivos en vivo sobre `@dnd-kit`.

## What Changes

- **Diseño del Dominio y Reglas Invariantes (`Boards & Tasks`):**
  - Entidad `Board`: asociado unívocamente a un `Project`, contiene columnas ordenadas y configuraciones visuales. Un proyecto nuevo inicializa perezosamente 3 columnas canónicas (`Por hacer`, `En progreso`, `Completado`) de forma estrictamente idempotente y resistente a condiciones de carrera concurrentes.
  - Entidad `BoardColumn`: pertenece a un tablero, con `id`, `name` (1-50 caracteres), `orderIndex` (entero secuencial contiguo), `color` hex opcional, `category` semántica (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`). Límites invariantes: mínimo 1 columna y máximo 10 columnas por tablero.
  - Entidad `Task`: pertenece a un `Project` y a una `BoardColumn` válida de ese mismo proyecto. Campos: `title` (3-140 caracteres), `description` (opcional, hasta 2000 caracteres), `priority` (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), `orderIndex` (secuenciación en columna), `dueDate` (ISO-8601 UTC opcional), `labels` (array de strings, máx. 5 etiquetas de hasta 30 caracteres cada una), `creatorId` y `assigneeIds`.
  - Invariante de Acceso y Aislamiento Horizontal Contextual: el acceso a tableros y tareas se concede exclusivamente al creador del proyecto, miembros activos (`owner` o `collaborator`) y al docente formalmente asignado al proyecto. Docentes no asignados y usuarios no pertenecientes al proyecto son rechazados con HTTP 404 Not Found (ocultamiento defensivo de existencia).
  - Invariante de Asignación de Tareas: un usuario asignado DEBE poseer una membresía activa en el proyecto respectivo (`owner` o `collaborator`). Asignaciones a no miembros o miembros retirados son rechazadas con error 400 Bad Request.
  - Invariante de Eliminación de Columnas y Atomicidad: prohibido eliminar la última columna restante (400 Bad Request); prohibido eliminar columnas con tareas sin especificar una columna destino válida en el mismo tablero hacia la cual reasignarlas en una transacción atómica que emita eventos de auditoría para cada tarea migrada y recompacte el orden de las columnas restantes (409 Conflict si no se especifica columna destino).
  - Entidad `TaskActivityEvent`: registro inmutable de movimientos de columna, cambios de estado y modificaciones de la tarea (autor, acción, columna origen, columna destino, timestamp UTC). Forma parte de la misma unidad de trabajo transaccional en movimientos y eliminaciones de columnas.

- **Puertos de Persistencia y Casos de Uso (Arquitectura Hexagonal):**
  - Nuevos puertos en `@shared/ports`: `board-repository.port.ts`, `task-repository.port.ts`, `task-activity-repository.port.ts` (exportando entidades, errores tipados y contratos de puertos en consonancia con la convención del proyecto).
  - Reutilización de `MembershipRepositoryPort`, `ProjectRepositoryPort` y `SystemClockPort`.
  - Casos de uso en `apps/api/src/application/use-cases`:
    - `GetProjectBoardUseCase`: obtiene el tablero con validación de acceso contextual (404 a no miembros y docentes no asignados) e inicialización perezosa e idempotente ante accesos concurrentes.
    - `CreateBoardColumnUseCase`: agrega una columna garantizando orden correlativo y límite de 10 columnas, con validación de acceso contextual.
    - `UpdateBoardColumnUseCase`: actualiza nombre, color o categoría de una columna existente.
    - `DeleteBoardColumnUseCase`: elimina una columna con validación de mínimo 1 columna, reasignación atómica transaccional de tareas con eventos de auditoría y recompactación de índices de columnas.
    - `CreateTaskUseCase`: crea una tarea validando membresía activa de todos los asignados y emite evento `CREATED`.
    - `UpdateTaskUseCase`: modifica campos y asignados, emitiendo evento `UPDATED`.
    - `MoveTaskUseCase`: traslada o reordena una tarea dentro de una transacción atómica con algoritmo de desplazamiento contiguo y registro inmutable del evento `MOVED`.
    - `ListTasksUseCase`: consulta tabular paginada en servidor con filtros combinables, ordenamiento seguro y validación de acceso contextual (404 a no miembros y docentes no asignados).

- **Contratos Zod y Especificación OpenAPI:**
  - Nuevos contratos en `packages/shared/src/contracts`: `board.contract.ts` y `task.contract.ts`.
  - Rutas REST versionadas bajo `/api/projects`:
    - `GET /api/projects/:projectId/board`
    - `POST /api/projects/:projectId/board/columns`
    - `PATCH /api/projects/:projectId/board/columns/:columnId`
    - `DELETE /api/projects/:projectId/board/columns/:columnId`
    - `GET /api/projects/:projectId/tasks` (con filtros y paginación)
    - `POST /api/projects/:projectId/tasks`
    - `GET /api/projects/:projectId/tasks/:taskId`
    - `PATCH /api/projects/:projectId/tasks/:taskId`
    - `POST /api/projects/:projectId/tasks/:taskId/move`

- **Interfaz de Usuario Moderna, Accesible y Reactiva (Web UI):**
  - Componentes en `apps/web/src/components`: `KanbanBoard`, `KanbanColumn`, `TaskCard`, `CreateTaskModal`, `TaskDetailModal`, `TaskListView`, `TaskFiltersBar`.
  - Accesibilidad integral: soporte completo de teclado (`KeyboardSensor` con `sortableKeyboardCoordinates`), anuncios auditivos ARIA en vivo (`aria-live`), foco visible y contrastes WCAG 2.1 AA.
  - Integración con TanStack Query para mutaciones optimistas con reversión (rollback) automática ante fallos de red.

## Capabilities

### Modified Capabilities

- `boards-tasks`: amplía la especificación canónica con los requisitos formales de validación de asignación de miembros activos, acceso contextual de docentes asignados con aislamiento horizontal (404 a docentes no asignados), inicialización idempotente de tableros ante concurrencia, límites de configuración de columnas (1 a 10), eliminación segura y atómica de columnas con eventos de auditoría y recompactación, transacciones atómicas de movimiento de tareas con eventos de actividad, paginación y filtrado server-side, y accesibilidad por teclado WCAG AA sobre el Kanban.

## Impact

- **Código y Dependencias:**
  - Se introducen contratos Zod en `packages/shared`, puertos en `@shared/ports`, casos de uso en `apps/api` y componentes web en `apps/web`.
  - Dependencias frontend a solicitar en Nivel D: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` conforme a `docs/10-ui-ux-system.md` y Constitución (Art. IV.2).
  - Persistencia inicial mediante adaptadores en memoria con Maps compartidos (Patrón B.1) para pruebas deterministas, rápidas y seguras ante concurrencia.
- **Seguridad y Aislamiento:**
  - Control de acceso horizontal y contextual estricto: denegación por defecto y retorno de 404 ante solicitudes sobre proyectos no pertenecientes al usuario o proyectos donde el docente solicitante no esté formalmente asignado.
  - Validación en servidor: el cliente no es autoridad en las transiciones ni en el orden de las tareas.
  - Atomicidad transaccional: toda mutación compuesta garantiza integridad referencial y auditoría inmutable o rollback completo.
- **Costos:**
  - Presupuesto adicional: US$0. No requiere servicios externos adicionales.
- **Gobernanza y Compuertas:**
  - Esta propuesta corresponde estrictamente a la **Fase 2: Planificación (Nivel de Autorización C)**.
  - No se modifica código productivo, no se instalan dependencias, no se ejecutan commits ni migraciones.
  - Se requiere autorización explícita **Nivel D** antes de proceder con la implementación.