# Design: Kanban Boards & Task Management (`kanban-boards-tasks`)

## 1. Visión General y Objetivos Arquitectónicos

Este diseño técnico estructura la capacidad de gestión de tableros Kanban y ciclo de vida de tareas (`boards-tasks`) para el Sistema de Seguimiento de Proyectos Académicos IS488 (semestre 2026-II).

El diseño se fundamenta rigurosamente en:
- **Constitución del Proyecto (CONSTITUTION.md):** Arquitectura hexagonal / puertos y adaptadores (Art. IV.1), estatus tecnológico confirmado (Art. IV.2), graduación de pruebas y veracidad empírica (Art. V), seguridad defensiva y autorización del lado del servidor (Art. VI), y costo operativo US$0 (Art. VIII).
- **AGENTS.md:** Protocolo de fases, no desarrollo directo sobre main, tareas atómicas y compuertas estrictas (Stop Gates entre Fase 2/C y Fase 4/D).
- **Documentación de Soporte:** `docs/03-architecture.md`, `docs/04-data-model.md`, `docs/05-security-and-privacy.md`, `docs/06-test-strategy.md` y `docs/10-ui-ux-system.md`.

---

## 2. Límites y Capas de la Arquitectura Hexagonal

```
┌────────────────────────────────────────────────────────────────────────┐
│                        INFRAESTRUCTURA (ENTRADA)                       │
│   HTTP Router / Handlers (Hono sobre Cloudflare Workers)               │
│   Web Frontend (React + Vite + Tailwind + shadcn + @dnd-kit)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Invoca mediante DTOs
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        APLICACIÓN (CASOS DE USO)                       │
│   GetProjectBoardUseCase       CreateTaskUseCase                       │
│   CreateBoardColumnUseCase     UpdateTaskUseCase                       │
│   UpdateBoardColumnUseCase     MoveTaskUseCase                         │
│   DeleteBoardColumnUseCase     ListTasksUseCase                        │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │ Depende de                     │ Orquesta
┌───────────────────▼──────────────────┐ ┌───────────▼───────────────────┐
│           PUERTOS (INTERFACES)       │ │        DOMINIO PURO           │
│   BoardRepositoryPort
│   BoardColumnDeletionPort            │                │ │   Board (Agregado)            │
│   TaskRepositoryPort                 │ │   BoardColumn (Entidad)       │
│   TaskActivityRepositoryPort         │ │   Task (Agregado)             │
│   MembershipRepositoryPort (reusado) │ │   TaskPriority (Enum)         │
│   ProjectRepositoryPort (reusado)    │ │   ColumnCategory (Enum)       │
│   SystemClockPort (reusado)          │ │   TaskActivityEvent (Ent.)    │
└───────────────────▲──────────────────┘ │   Invariantes & Reglas        │
                    │ Implementa         └───────────────────────────────┘
┌───────────────────┴────────────────────────────────────────────────────┐
│                    INFRAESTRUCTURA (ADAPTADORES DE SALIDA)             │
│   InMemoryBoardRepository / InMemoryBoardColumnDeletionAdapter         │
│   InMemoryTaskRepository / InMemoryTaskActivityRepository (Tests/CI)   │          │
│   InMemoryTaskActivityRepository (Memoria Map compartida)              │
│   (Futuro Drizzle / PostgreSQL tras consolidación del spike)           │
└────────────────────────────────────────────────────────────────────────┘
```

### Invariantes y Reglas del Dominio

- **Aislamiento Horizontal y Acceso Contextual de Docentes:**
  - Las tareas y columnas están ligadas unívocamente a un `projectId`.
  - La autorización se comprueba siempre en el servidor. El acceso se restringe al creador del proyecto (`project.creatorId === userId`) y miembros activos (`MembershipRepositoryPort.findByProjectAndUser(projectId, userId)` con estado activo). Sin evidencia real comprobable de asignación docente institucional al proyecto (definida en el modelo canónico), el sistema aplica denegación por defecto (404 Not Found) a cualquier usuario o docente sin membresía activa.
  - Usuarios ajenos al proyecto y usuarios con rol docente que NO estén asignados a ese proyecto específico son rechazados con HTTP 404 Not Found (ocultamiento defensivo de existencia para protección de privacidad institucional).
- **Atomicidad Transaccional en Movimientos y Eliminación de Columnas:**
  - Toda mutación compuesta que afecte múltiples entidades (mover tarea con reindexación contigua de origen y destino, o eliminación de columna con reasignación en lote y recompactación de orden) debe ejecutarse dentro de un límite transaccional atómico (Unit of Work).
  - La emisión y persistencia de eventos inmutables en `TaskActivityRepositoryPort` forma parte obligatoria de la misma unidad de trabajo atómica. Si la persistencia del evento de actividad o la reindexación falla, la mutación completa se revierte sin dejar registros huérfanos ni estados parciales.
- **Inicialización Idempotente ante Concurrencia:**
  - La inicialización perezosa del tablero (`GetProjectBoardUseCase`) debe ser estrictamente idempotente y resistente a condiciones de carrera concurrentes.
  - El puerto `BoardRepositoryPort` implementa una estrategia segura (`findOrCreateDefaultBoard`) que previene duplicación de tableros o columnas cuando múltiples peticiones concurrentes acceden en paralelo a un proyecto recién creado, retornando la misma estructura a todas las llamadas.
- **Asignación Elegible de Tareas:**
  - Solo usuarios con membresía activa (`status === 'active'`, sea rol `owner` o `collaborator`) pueden ser asignados a una tarea. La asignación a usuarios sin membresía activa es rechazada con HTTP 400 Bad Request.
- **Límites de Configuración de Columnas:**
  - Mínimo 1 columna y máximo 10 columnas por tablero. Intentar crear una undécima columna produce HTTP 400 Bad Request. Intentar eliminar la última columna restante produce HTTP 400 Bad Request. Intentar eliminar una columna con tareas sin especificar destino produce HTTP 409 Conflict.
- **Consistencia de Transición y Orden Secuencial:**
  - El servidor es la única autoridad de ordenamiento mediante secuenciación de enteros contiguos (`orderIndex: 0, 1, 2, ...`).

---

## 3. Capa de Aplicación: Casos de Uso

1. **`GetProjectBoardUseCase`:**
   - Inyecta `BoardRepositoryPort`, `TaskRepositoryPort`, `ProjectRepositoryPort`, `MembershipRepositoryPort`, `SystemClockPort`.
   - Valida autorización contextual: el solicitante debe ser creador (`project.creatorId === userId`), miembro activo en `MembershipRepositoryPort`, o docente formalmente asignado al proyecto (`project.teacherId === userId`). Si no cumple (incluyendo docentes institucionales no asignados), retorna `null` (el router emite 404 Not Found).
   - Inicialización perezosa e idempotente ante concurrencia: si el proyecto no tiene tablero, invoca `findOrCreateDefaultBoard` garantizando que llamadas paralelas concurrentes no generen tableros duplicados ni colisiones de columnas, creando atómicamente las 3 columnas canónicas (`Por hacer` [TODO], `En progreso` [IN_PROGRESS], `Completado` [DONE]).
   - Retorna el tablero con sus columnas ordenadas y las tareas de cada columna ordenadas por `orderIndex`.

2. **`CreateBoardColumnUseCase`:**
   - Valida autorización contextual en el proyecto (404 a no miembros y docentes no asignados).
   - Consulta cantidad actual de columnas; si es >= 10, arroja `MaxColumnsReachedError` (router responde 400 Bad Request).
   - Asigna `orderIndex = totalColumnasActuales` y persiste la columna.

3. **`UpdateBoardColumnUseCase`:**
   - Valida autorización contextual y existencia de la columna en el tablero del proyecto.
   - Actualiza nombre, color o categoría semántica.

4. **`DeleteBoardColumnUseCase` y Transaccionalidad Atómica (`BoardColumnDeletionPort`):**
   - Valida autorización contextual en el proyecto (404 a no miembros y denegación por defecto a docentes no asignados).
   - Delega la validación de invariantes del tablero y la ejecución atómica al puerto `BoardColumnDeletionPort` (`InMemoryBoardColumnDeletionAdapter` en memoria / futura transacción SQL `PostgresBoardColumnDeletionAdapter`).
   - **Garantías de Consistencia y Concurrencia (Patrón Copy-On-Write + Publicación Única):**
     1. **Frontera de Exclusión Mutua (`ProjectLockManager`):** Serializa todas las escrituras concurrentes que puedan interferir en el mismo proyecto (`saveBoard`, `addColumn`, `updateColumn`, `deleteColumn`, `executeAtomicColumnDeletion`).
     2. **Prevención de TOCTOU:** Todas las precondiciones susceptibles de cambiar (`LastColumnDeletionError`, `BoardColumnNotFoundError`, `ColumnNotEmptyError`, `InvalidDestinationColumnError`) se revalidan dentro del mutex antes de cualquier mutación.
     3. **Preparación de Estado Aislado:** Todas las transformaciones (reubicación contigua de tareas, eventos de auditoría inmutables en lote, eliminación de columna y recompactación de índices) se preparan en estructuras locales aisladas. Si cualquier validación o fallo ocurre antes de publicar, ningún repositorio es tocado.
     4. **Publicación Única y Atómica:** El nuevo tablero, las tareas actualizadas y los eventos inmutables se persisten de forma indivisible dentro del lock. Se elimina completamente cualquier saga o compensación manual (`deleteEvent` fue removido del puerto para garantizar auditoría estrictamente inmutable).
     5. **Control de Concurrencia en `saveBoard`:** Validación de `expectedRevision` contra `boardRevision` y rechazo estricto de dos estados diferentes que colisionen con la misma marca temporal.
     6. **Integridad Referencial en Tareas (`InMemoryTaskRepository`):** Dentro del lock del proyecto, `create`, `update`, `moveTask` y `migrateTasksBetweenColumns` comprueban que las columnas referenciadas existan y pertenezcan al tablero del proyecto. Se impide además modificar los identificadores inmutables (`id`, `projectId`) mediante `update`. La concurrencia entre eliminación de columna y creación/movimiento garantiza que ninguna tarea queda apuntando a una columna eliminada.
     7. **Validación de Lotes de Auditoría (`InMemoryTaskActivityRepository`):** `recordEventsBatch` rechaza lotes heterogéneos con `projectId`s mezclados antes de persistir, preservando la atomicidad y el aislamiento por proyecto.
     8. **Semántica de Reordenamiento en `updateColumn`:** Implementación de reposicionamiento mediante desplazamiento/splice para garantizar reordenamientos exactos (como mover la primera columna a la última posición y viceversa) con índices contiguos 0..n-1.

5. **`CreateTaskUseCase`:**
   - Valida pertenencia contextual al proyecto y existencia de la columna destino en el mismo proyecto.
   - Valida elegibilidad de asignados: para cada `assigneeId`, verifica que exista en `MembershipRepositoryPort.findByProject(projectId)` con `status === 'active'`. Si alguno no es miembro activo, arroja `IneligibleAssigneeError` (router responde 400 Bad Request).
   - Determina el siguiente `orderIndex` en la columna.
   - Persiste la tarea y registra automáticamente el evento `CREATED` en `TaskActivityRepositoryPort`.

6. **`UpdateTaskUseCase` y `TaskUpdatePort`:**
   - Entrada: `{ projectId: string, taskId: string, requesterId: string, title?: string, description?: string, columnId?: string, priority?: TaskPriority, dueDate?: string | null, labels?: string[], assigneeIds?: string[] }`.
   - Valida pertenencia contextual en el proyecto (404 a no miembros y docentes no asignados; 404 si la tarea pertenece a otro proyecto o no existe).
   - Valida esquema Zod (`UpdateTaskSchema`). Impide modificar campos protegidos de identidad (`id`), proyecto (`projectId`), creador (`creatorId`) y movimiento (`columnId`, `orderIndex`), arrojando 400 Bad Request si se intenta cambiar la columna o identificadores.
   - Valida elegibilidad de asignados: si `assigneeIds` está presente, comprueba que cada uno sea miembro activo en el proyecto (`MembershipRepositoryPort.findByProjectAndUser(projectId, id)` con `status === 'active'`), arrojando `IneligibleAssigneeError` (400 Bad Request) ante asignados inactivos o ajenos.
   - Delegación atómica única a `TaskUpdatePort` (`executeAtomicTaskUpdate`) bajo mutex compartido (`ProjectLockManager`):
     1. Re-lee la tarea desde el snapshot Copy-On-Write dentro de la sección crítica para evitar condiciones de carrera (TOCTOU) con movimientos o ediciones concurrentes.
     2. Semántica de actualización parcial y vaciado:
        - Campos omitidos (`undefined`) conservan su valor actual del snapshot.
        - `description: ""` (cadena vacía/espacios) vacía el campo (`undefined`).
        - `dueDate: null` vacía la fecha límite (`undefined`).
        - `labels: []` vacía las etiquetas; `assigneeIds: []` desasigna a todos los responsables.
        - `title` y `priority` se actualizan a los nuevos valores validados.
     3. Detección de no-op (sin cambios reales): si todos los campos resultantes son idénticos a los actuales en el snapshot, la operación es idempotente: no actualiza `updatedAt`, no genera evento `UPDATED` y no publica el snapshot.
     4. Si hay cambio real: actualiza `updatedAt` con el timestamp del reloj (`SystemClockPort`), genera evento inmutable `UPDATED` con `{ actorId, timestamp, details }`, y publica snapshot de forma atómica única (`commitSnapshot`).
     5. Soporta inyección de fallos (`before_publish`) tras preparar tarea y auditoría para verificar reversión completa de estado y preservación de auditoría previa.

7. **`MoveTaskUseCase` y `TaskMovePort`:**
   - Entrada: `{ projectId: string, taskId: string, destinationColumnId: string, destinationIndex: number, requestingUserId: string }`.
   - Valida autorización contextual (404 a no miembros y docentes no asignados) y que `destinationColumnId` pertenezca al mismo tablero (400 si pertenece a otro proyecto o no existe).
   - Delegación atómica única a `TaskMovePort` (`executeAtomicTaskMove`) bajo mutex compartido (`ProjectLockManager`):
     1. Captura de `sourceColumnId` y `sourceIndex` antes de cualquier modificación.
     2. Cálculo de posición destino efectiva con clamp al final si `destinationIndex` supera la longitud de la lista destino excluyendo la tarea movida.
     3. Detección de idempotencia: si `sourceColumnId === destinationColumnId` y el índice efectivo es igual al índice original, operación no-op sin modificar `updatedAt`, sin evento `MOVED` y sin publicación.
     4. Si hay cambio real de posición (intra-columna o inter-columna):
        - Actualiza `orderIndex` y `updatedAt` (con timestamp del reloj).
        - Reordena de forma contigua las columnas origen y destino (0..N-1 sin duplicados ni huecos).
        - Prepara evento inmutable `MOVED` con `{ fromColumnId, toColumnId, actorId, timestamp, details: { fromIndex, toIndex } }`.
     5. Publicación atómica única (`commitSnapshot`) de tareas y evento juntos tras verificar que no existan fallos. Si ocurre un fallo antes de publicar, el estado previo completo (incluyendo auditoría previa) se preserva intacto sin modificaciones.

8. **`ListTasksUseCase`:**
   - Valida autorización contextual en el proyecto (404 a no miembros y docentes no asignados).
   - Aplica filtros opcionales (`columnId`, `priority`, `assigneeId`, `label`, `search`).
   - Aplica paginación server-side (`page`, `limit`) retornando estructura `{ items, totalItems, page, limit, totalPages }`.

---

## 4. Contratos Zod y OpenAPI

Ubicados en `packages/shared/src/contracts/`:

### 4.1 Contratos de Tablero (`board.contract.ts`)
- `ColumnCategorySchema`: `z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])`
- `CreateBoardColumnSchema`:
  ```typescript
  z.object({
    name: z.string().trim().min(1).max(50),
    color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    category: ColumnCategorySchema.default('TODO'),
  })
  ```
- `UpdateBoardColumnSchema`: `CreateBoardColumnSchema.partial()`
- `DeleteBoardColumnQuerySchema`:
  ```typescript
  z.object({
    targetColumnId: z.string().uuid().optional(),
  })
  ```

### 4.2 Contratos de Tareas (`task.contract.ts`)
- `TaskPrioritySchema`: `z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])`
- `CreateTaskSchema`:
  ```typescript
  z.object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().max(2000).optional(),
    columnId: z.string().uuid(),
    priority: TaskPrioritySchema.default('MEDIUM'),
    dueDate: z.string().datetime().optional(),
    labels: z.array(z.string().trim().min(1).max(30)).max(5).default([]),
    assigneeIds: z.array(z.string().uuid()).default([]),
  })
  ```
- `UpdateTaskSchema`:
  ```typescript
  z.object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().max(2000).optional(),
    priority: TaskPrioritySchema.optional(),
    dueDate: z.string().datetime().nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(30)).max(5).optional(),
    assigneeIds: z.array(z.string().uuid()).optional(),
  }).refine((data) => Object.keys(data).length > 0, {
    message: 'Debe especificar al menos un campo para actualizar',
  })
  ```
  > [!IMPORTANT]
  > `columnId` y `orderIndex` están excluidos deliberadamente de este esquema. Mover tareas entre columnas o alterar su posición dentro de una columna es una operación estructural exclusiva gestionada atómicamente por `MoveTaskUseCase` (`MoveTaskSchema`).
  > **Detección y rechazo de campos protegidos:** Para evitar que el motor de Zod descarte silenciosamente campos no permitidos, el manejador HTTP verifica explícitamente si el cuerpo crudo de la petición contiene campos de identidad o movimiento (`id`, `projectId`, `creatorId`, `columnId`, `orderIndex`, `createdAt`, `updatedAt`). Si alguno está presente, rechaza la solicitud de inmediato con **HTTP 400 Bad Request**, indicando que dichos campos no pueden modificarse mediante actualización de tarea.

- `MoveTaskSchema`:
  ```typescript
  z.object({
    destinationColumnId: z.string().uuid({ message: 'El identificador de columna destino debe ser un UUID válido' }),
    destinationIndex: z.number().int().min(0),
  })
  ```

- `ListTasksQuerySchema`:
  ```typescript
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    columnId: z.string().uuid().optional(),
    priority: TaskPrioritySchema.optional(),
    assigneeId: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(30).optional(),
    search: z.string().trim().max(100).optional(),
  })
  ```

### 4.3 Arquitectura HTTP, Enrutamiento e Inyección de Dependencias (Bloque 4)

#### 4.3.1 Rutas y Endpoints
Se estructuran en dos enrutadores desacoplados montados bajo `/api/projects`:

1. **`board.route.ts` (`/api/projects/:projectId/board`):**
   - `GET /api/projects/:projectId/board`: Obtiene el tablero del proyecto con sus columnas contiguas ordenadas por `orderIndex`. Si no existe, lo inicializa de forma at?mica y segura ante concurrencia con las columnas predeterminadas (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`). Cabecera: `Cache-Control: no-store`. Respuestas: `200`, `400`, `401`, `404`, `405`, `500`.
   - `POST /api/projects/:projectId/board/columns`: Crea una nueva columna en el tablero validando l?mite m?ximo (`maxColumns = 10`), nombre v?lido y categor?a v?lida (`CreateBoardColumnSchema`). Cabecera: `Cache-Control: no-store`. Respuestas: `201`, `400`, `401`, `404`, `405`, `500`.
   - `PATCH /api/projects/:projectId/board/columns/:columnId`: Actualiza metadatos (`name`, `category`, `color`) y/o reordena contiguamente (`orderIndex`) una columna existente (`UpdateBoardColumnUseCase`, al menos un campo requerido). Cabecera: `Cache-Control: no-store`. Respuestas: `200`, `400`, `401`, `404`, `405`, `500`.
   - `DELETE /api/projects/:projectId/board/columns/:columnId`: Elimina una columna de forma at?mica. Si contiene tareas, exige el query param `targetColumnId` perteneciente al mismo tablero para reasignaci?n at?mica (`409 Conflict` si contiene tareas y no se especifica destino); rechaza eliminaci?n si es la ?ltima columna restante (`400 Bad Request`) o si el destino es inv?lido/igual al origen (`400 Bad Request`). Cabecera: `Cache-Control: no-store`. Respuestas: `200`, `400`, `401`, `404`, `409`, `405`, `500`.
   - Métodos no soportados devuelven `405 Method Not Allowed` con cabecera `Allow`.

2. **`tasks.route.ts` (`/api/projects/:projectId/tasks`):**
   - `GET /api/projects/:projectId/tasks`: Listado paginado y filtrado de tareas del proyecto (`ListTasksUseCase`). Parámetros de consulta validados con `ListTasksQuerySchema`. Respuestas: `200`, `400`, `401`, `404`.
   - `POST /api/projects/:projectId/tasks`: Crea una nueva tarea en una columna (`CreateTaskUseCase`). Valida cuerpo con `CreateTaskSchema` y elegibilidad activa de `assigneeIds`. Emite auditoría `CREATED`. Respuestas: `201`, `400`, `401`, `404`.
   - `PATCH /api/projects/:projectId/tasks/:taskId`: Actualización parcial de metadatos (`UpdateTaskUseCase`). Verifica que no contenga campos protegidos (rechazo `400`), valida con `UpdateTaskSchema`, detecta no-op idempotente y emite auditoría `UPDATED`. Respuestas: `200`, `400`, `401`, `404`.
   - `POST /api/projects/:projectId/tasks/:taskId/move`: Traslado de posición o columna (`MoveTaskUseCase`). Valida cuerpo con `MoveTaskSchema`, aplica clamp en destino, detecta no-op idempotente y emite auditoría `MOVED`. Respuestas: `200`, `400`, `401`, `404`.
   - Métodos no soportados devuelven `405 Method Not Allowed` con cabecera `Allow`.

#### 4.3.2 Composición e Inyección de Dependencias: Patrón B.2 (Storage Kanban Único)
Siguiendo el **Patrón B.1** establecido en `createApp()` para `projectMap` y `membershipMap`, se define el **Patrón B.2** para el dominio Kanban:
- En `createApp(options: AppOptions)`:
  ```typescript
  const kanbanStorage = options.kanbanStorage ?? new InMemoryKanbanProjectStorage();
  const boardRepository = options.boardRepository ?? new InMemoryBoardRepository(kanbanStorage);
  const boardColumnDeletionPort = options.boardColumnDeletionPort ?? new InMemoryBoardColumnDeletionAdapter(kanbanStorage);
  const taskCreationPort = options.taskCreationPort ?? new InMemoryTaskCreationAdapter(kanbanStorage, clock);
  const taskMovePort = options.taskMovePort ?? new InMemoryTaskMoveAdapter(kanbanStorage, clock);
  const taskUpdatePort = options.taskUpdatePort ?? new InMemoryTaskUpdateAdapter(kanbanStorage, clock);
  const taskListPort = options.taskListPort ?? new InMemoryTaskListAdapter(kanbanStorage);
  const taskActivityRepository = options.taskActivityRepository ?? new InMemoryTaskActivityRepository(kanbanStorage);
  ```
- **Garantía arquitectónica:** La compartición de la misma referencia de `InMemoryKanbanProjectStorage` asegura que los snapshots Copy-On-Write y los bloqueos por mutex en memoria (`ProjectLockManager`) coordinen atómicamente tableros, columnas, tareas y auditoría sin estados disjuntos ni carreras de concurrencia.

#### 4.3.3 Procedencia Estricta de la Identidad y Aislamiento de Contexto
- **Procedencia:** La identidad del solicitante proviene única y exclusivamente del contexto Hono:
  `const requesterId = c.get('user').userId;`
  establecido por el middleware `createDevAuthMiddleware` mediante la cabecera `X-Dev-User-Id`.
- **Límites de la autenticación actual:**
  - Es un andamiaje provisional para desarrollo local y pruebas (ADR-004).
  - Rechaza con `401 Unauthorized` si falta la cabecera.
  - Rechaza con `401 Unauthorized` incondicionalmente si `NODE_ENV === 'production'`.
  - No valida firmas criptográficas ni sesiones reales (pendientes de spike de Better Auth/Google OAuth).
- **Prohibición de Parameter Pollution:** Jamás se utiliza object spread que permita al cliente inyectar o sobrescribir variables de contexto:
  ```typescript
  // PROHIBIDO:
  // await useCase.execute({ ...body, projectId, requesterId });
  // await useCase.execute({ projectId, requesterId, ...body });

  // CORRECTO Y OBLIGATORIO: Construcción explícita campo a campo
  const command: CreateTaskCommand = {
    projectId,
    requesterId,
    title: parsed.title,
    description: parsed.description,
    columnId: parsed.columnId,
    priority: parsed.priority,
    dueDate: parsed.dueDate,
    labels: parsed.labels,
    assigneeIds: parsed.assigneeIds,
  };
  ```

#### 4.3.4 Manejo Uniforme de Errores y Códigos HTTP
Se adopta el patrón centralizado de mapeo de errores de casos de uso (`handleUseCaseError`):
- `ZodError` o errores de validación de campos protegidos $\rightarrow$ `400 Bad Request` con `{ error: 'Bad Request', message, details }`.
- `IneligibleAssigneeError` $\rightarrow$ `400 Bad Request`.
- Falta de autenticación en middleware $\rightarrow$ `401 Unauthorized`.
- `ProjectNotFoundError` o no-miembro $\rightarrow$ `404 Not Found` (`{ error: 'Not Found', message: 'Proyecto no encontrado' }` para preservar aislamiento horizontal sin revelar existencia).
- `TaskNotFoundError` $\rightarrow$ `404 Not Found`.
- Métodos no implementados $\rightarrow$ `405 Method Not Allowed` con cabecera `Allow`.
- `MaxColumnsReachedError` / conflicto de revisión $\rightarrow$ `409 Conflict`.
- `LastColumnDeletionError` $\rightarrow$ `422 Unprocessable Entity`.
- Errores no controlados $\rightarrow$ capturados por `app.onError` devolviendo `500 Internal Server Error` sin stack traces ni variables de entorno.

---

## 5. Diseño del Frontend (Web UI / UX)

### 5.1 Dependencias Previstas para Autorización Nivel D
Para implementar la interfaz Kanban accesible, se prevé la instalación de las dependencias oficiales aprobadas en la Constitución (Art. IV.2) y `docs/10-ui-ux-system.md`:
- `@dnd-kit/core`: motor central de drag and drop accesible.
- `@dnd-kit/sortable`: utilidades de ordenamiento para listas y columnas.
- `@dnd-kit/utilities`: transformaciones CSS y funciones auxiliares.

> [!NOTE]
> La instalación de estos paquetes en `apps/web` está estrictamente reservada para la **Fase 4 (Nivel de Autorización D)** y no se ejecuta durante esta fase de planificación.

### 5.2 Accesibilidad Universal (WCAG 2.1 AA)
- **Navegación por Teclado:**
  - `TaskCard`: Foco visible mediante anillo accesible (`focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none`).
  - Activación de arrastre con `Space` o `Enter`.
  - Desplazamiento entre posiciones con flechas arriba/abajo y entre columnas con flechas izquierda/derecha (`sortableKeyboardCoordinates`).
  - Confirmación con `Space`/`Enter` y cancelación con `Escape`.
- **Anuncios para Lectores de Pantalla:**
  - Región ARIA en vivo (`aria-live="assertive"`, `aria-atomic="true"`) configurada en `DndContext` con anuncios en español para inicio, sobreposición, soltado y cancelación del movimiento de tareas.
- **Contraste y Semántica:**
  - Badges de prioridad con contraste >= 4.5:1.
  - Columnas identificadas con `role="region"` y `aria-label="Columna [Nombre], [N] tareas"`.

### 5.3 Actualizaciones Optimistas y Reversión (TanStack Query)
- Al soltar una tarjeta (`onDragEnd`), se realiza una actualización optimista local en el cache de TanStack Query.
- Si la petición HTTP a `/api/projects/:projectId/tasks/:taskId/move` falla (ej. error 400/404/500 o desconexión), se restaura el snapshot previo del tablero y se muestra un toast de error.

---

## 6. Frugalidad Operativa y Costos

- **Presupuesto:** US$0.
- No se utilizan APIs externas de pago ni almacenamiento binario.
- Persistencia de desarrollo en adaptadores en memoria con Maps compartidos (Patrón B.1), deterministas, desacoplados y con soporte de transacciones y concurrencia segura.