## Why

## Consolidacion documental del movimiento Kanban

El movimiento se consolida dentro de `kanban-boards-tasks`; `kanban-task-movement` no representa un incremento OpenSpec entregado independiente. Las precisiones incorporadas son:

- El cliente reutiliza `POST /api/projects/:projectId/tasks/:taskId/move` y envia exclusivamente `destinationColumnId` y `destinationIndex`; no envia identidad, proyecto, columna de origen ni campos de creacion/edicion.
- La actualizacion optimista conserva un snapshot por operacion, reindexa de forma contigua las columnas afectadas y revierte ese snapshot ante error HTTP, de red o respuesta invalida, sin reintento automatico.
- Mientras exista un movimiento pendiente se serializan las mutaciones del tablero: se bloquean movimientos, creacion y edicion mediante guardas de logica y controles deshabilitados. Las respuestas tardias de otra operacion, proyecto o componente desmontado no pueden alterar el tablero actual.
- El control de arrastre es independiente del boton Editar y cubre puntero, teclado, Escape, foco restaurado, anuncios `aria-live`, reordenamiento intra-columna, traslado entre columnas y destino vacio.
- La evidencia histórica reportada cubre servicio, componentes, teclado real, puntero real contra API local, rollback controlado, recarga y persistencia; no constituye una nueva ejecución sobre el estado actual. Las comprobaciones finales pendientes se distinguen en `tasks.md`.
- Por decisión humana del 25 de octubre de 2026, EPIC-003 mantiene servicios HTTP y estado local de React para consultas y mutaciones, incluido el movimiento optimista. TanStack Query queda fuera de este EPIC, sin instalación ni migración de código; esta decisión acota el stack de referencia de `docs/03-architecture.md` para este cambio.

El Sistema de Seguimiento de Proyectos Académicos (IS488) cuenta con la línea base de gestión de proyectos y membresías establecida en los EPICs previos. Sin embargo, para cumplir con los requisitos funcionales FR-007, FR-008 y FR-009 y los criterios de aceptación globales, es indispensable proveer a los equipos académicos (estudiantes y docentes de la UNSCH) la capacidad de descomponer el trabajo en tareas, organizarlas en tableros Kanban interactivos y configurables, asignar responsables verificados, controlar fechas límite y prioridades, y disponer de una vista de lista con ordenamiento y paginación en el servidor.

Adicionalmente, el seguimiento pedagógico y la integridad de los datos exigen garantías rigurosas de consistencia:

1. **Acceso contextual restringido:** los docentes únicamente pueden consultar y gestionar proyectos a los que estén formalmente asignados, manteniendo aislamiento horizontal defensivo (HTTP 404 ante proyectos no asignados).
2. **Atomicidad transaccional completa:** las transiciones de estado, movimientos entre columnas y reasignaciones por eliminación de columnas deben ejecutarse en transacciones atómicas con reversión íntegra ante fallos, registrando eventos de actividad inmutables para cada tarea afectada.
3. **Inicialización idempotente y segura ante concurrencia:** la creación perezosa del tablero y sus columnas canónicas debe ser estrictamente idempotente para evitar duplicados o fallos de carrera cuando múltiples solicitudes accedan en paralelo.
4. **Accesibilidad universal:** la interfaz de usuario debe garantizar cumplimiento WCAG 2.1 AA mediante navegación completa por teclado y anuncios auditivos en vivo sobre `@dnd-kit`.

## What Changes

### Historial real y responsables en creación (incremento autorizado)

GET /api/projects/:projectId/tasks/:taskId/activity reutiliza eventos internos, autenticación y acceso contextual existentes, con 404 uniforme ante proyecto/tarea inexistente, ajeno o acceso denegado. Contrato compartido de lista y OpenAPI; orden createdAt descendente e id ascendente como desempate. Sin eventos nuevos al leer. El detalle consume el historial real con carga, vacío, error/reintento y aislamiento de respuestas tardías. La creación reutiliza la selección de miembros y conserva validación, doble envío y bloqueo del selector.

Diagnóstico previo a contratos: dev-auth acepta X-Dev-User-Id como texto no vacío y CreateProjectUseCase lo copia sin conversión a creatorId y owner.userId; MembershipResponse admite ese texto, pero assigneeIds exige UUID. No hay mapeo canónico de identidad en ese flujo. Asignar dev-student-01 requiere ampliar identidad fuera de este alcance: no convertir IDs, relajar UUID ni omitir asignados existentes. La creación con miembros activos UUID sigue siendo viable.

### Incremento autorizado: responsables en detalle de tarea

Extender EditTaskModal con responsables actuales de TaskResponse y consulta de miembros mediante GET /api/projects/:projectId/members. Permitir asignar miembros activos compatibles con assigneeIds (UUID) y quitar asignaciones mediante PATCH existente, incluido assigneeIds vacío. Mostrar IDs reales: MembershipResponse no incluye nombres. Conservar campos, validación, doble envío, respuestas tardías y bloqueo del selector durante la mutación.

En el incremento previo faltaba la lectura HTTP de historial; la ruta autorizada en este incremento resuelve ese límite. Sigue sin existir GET individual de tarea: el detalle usa la TaskResponse cargada. Miembros con userId no UUID pueden existir según MembershipResponse, pero no son asignables conforme al contrato de tareas; se muestran con esa limitación sin conversión ni relajación de UUID.

### Incremento autorizado: filtros server-side de Lista

Añadir búsqueda en título o descripción (subcadena sin distinguir mayúsculas, máximo 100 caracteres), columna mediante getBoard, prioridad y etiqueta exacta (máximo 30 caracteres). Los filtros se combinan con AND en el servidor mediante getTasks y límite 20. Aplicar/Limpiar actualizan filtros y página 1 conjuntamente; navegación y reintento conservan filtros aplicados. Se omiten valores vacíos, se validan límites contractuales y se aíslan respuestas/rechazos obsoletos. Las columnas tienen carga/error/reintento independientes. Sin coincidencias no se muestra Página 1 de 0. No se añaden filtros de responsable/fechas, ordenación, mutaciones ni dependencias. Se conserva el bloqueo del selector durante mutaciones del tablero.

### Incremento autorizado: lista paginada de solo lectura

Nivel D autorizado para `TaskListView` mediante `getTasks` con `page` y límite 20, conservando el orden y los metadatos de paginación del servidor. No usa `getAllProjectTasks`. `ProjectDetail` ofrece selector Tablero/Lista; cada entrada en Lista consulta página 1. Al cambiar proyecto se reinicia la vista a Tablero y se descartan datos, errores y respuestas anteriores. Creación, edición y movimiento pendientes bloquean el selector para no desmontar el tablero. Incluye carga, vacío, error/reintento y aislamiento de respuestas tardías. No incluye filtros, nueva ordenación, mutaciones desde Lista ni dependencias adicionales.

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
  - Servicios HTTP tipados y estado local de React para consultas y mutaciones, con snapshot, actualización optimista, rollback ante fallos e invalidación de respuestas tardías. La integración futura de lista y filtros conservará la sincronización visible después de las mutaciones sin TanStack Query.

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

## Identidades UUID explícitas de desarrollo

El incremento autorizado el 2026-10-26 sustituye exclusivamente el valor predeterminado textual del frontend por un UUID fijo en configuración de desarrollo y alinea sus consumidores y fixtures. No requiere EPIC-002 ni modificar usuarios canónicos, contratos, middleware, permisos o persistencia. Sin dependencias ni costos adicionales. El diagnóstico previo describía un límite del incremento anterior; no implica que sea necesario cambiar el modelo canónico para nuevos datos de desarrollo.

## Incremento C: gestión de columnas

Gestión frontend de columnas autorizada el 2026-10-26: crear nombre/categoría, renombrar, ordenar con controles accesibles y eliminar con confirmación/destino explícito mediante endpoints actuales. Mantener las tres columnas iniciales; IN_REVIEW opcional. Reflejar estado confirmado en Tablero y consultar columnas actualizadas al entrar a Lista. Sin cambios backend/shared, dependencias, costos, EPIC-002, Git ni ZIP.

## Verificación final autorizada F (2026-10-26)

El usuario autoriza completar pendientes frontend ya especificados y verificación final, sin cerrar/archivar EPIC-003. Se implementa assigneeId UUID sobre el contrato existente, actualización contextual de la vista activa conservando filtros aplicados, y precisión de anuncios de movimiento (origen/destino/posición). No cambia arquitectura/backend/shared ni EPIC-002. Se revisan marcas históricas y se separa implementación/pruebas/manual. Una ronda final completa y repeticiones solo afectadas si hay correcciones, intento de navegador y un ZIP final de revisión con hashes y evidencia; sin operaciones Git de escritura ni dependencias.
