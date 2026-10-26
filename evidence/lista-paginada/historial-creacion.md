# Historial real y responsables en creación

## Alcance entregado

Mismo worktree IS488-epic-003-kanban, rama feature/epic-003-kanban-boards-tasks y HEAD b4814659eb760500f15ec8c70154c7c03f55b090. Se preservan cambios locales de los incrementos anteriores. Sin dependencias nuevas, cambios en EPIC-002, operaciones Git de escritura ni ZIP.

GET /api/projects/:projectId/tasks/:taskId/activity lee eventos internos existentes. GetTaskActivityUseCase depende de puertos, verifica existencia de proyecto, acceso contextual y pertenencia de tarea antes de consultar eventos. El adaptador HTTP valida UUIDs y respuesta, ofrece 404 uniforme sin revelar proyectos/tareas ajenos y no-store. La lista usa el esquema compartido de eventos y orden createdAt descendente, id ascendente para empates. Leer no genera actividad ni modifica el storage. La composición por aplicación comparte el storage Kanban existente y admite repositorios inyectados.

El detalle muestra el historial real con carga, vacío auténtico, error/reintento y descarte de respuestas y rechazos obsoletos. El servicio valida esquema e identidad de cada evento; el componente conserva el orden, muestra acción/actor/fecha UTC y no vuelca detalles arbitrarios. TaskAssigneePicker se comparte entre creación y edición, conserva la selección ante error y muestra miembros incompatibles sin convertirlos. Creación previene doble envío y respuestas tardías; mantiene bloqueo del selector durante el envío.

## Causa y bloqueo de identidad

Antes de modificar contratos se rastreó el flujo: createDevAuthMiddleware admite cualquier X-Dev-User-Id no vacío. CreateProjectUseCase copia ese texto a creatorId y a ownerMembership.userId. MembershipResponseSchema permite texto no vacío; CreateTaskSchema y UpdateTaskSchema requieren UUID en assigneeIds. No existe un mapeo canónico de usuarios en ese flujo de desarrollo.

No se modificaron esos esquemas, no se convierten IDs, no se eliminan asignados existentes ni se relaja UUID. Un miembro activo con UUID puede asignarse en creación/edición. La asignación de dev-student-01 u otra identidad textual sigue bloqueada: resolverla requiere decidir y ampliar la identidad canónica y su relación con membresías, fuera de este incremento. La autenticación sigue siendo el andamiaje development/test existente; no se habilita autenticación de producción.

## Verificaciones ejecutadas

| Alcance afectado                                                                                  | Resultado                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Shared: task-activity.contract y task.contract                                                    | 28 pruebas aprobadas en 2 archivos                           |
| API: get-task-activity.use-case, task-activity.route, tasks.route, board.route y openapi.contract | 87 pruebas aprobadas en 5 archivos                           |
| Web: historial/servicio, creación/edición con responsables, selector y regresiones de movimiento  | 75 pruebas aprobadas en 11 archivos                          |
| Typecheck de shared, API y web                                                                    | Código 0                                                     |
| ESLint de los 19 archivos TS/TSX modificados                                                      | Código 0                                                     |
| Prettier de esos archivos y los cuatro artefactos                                                 | Código 0                                                     |
| Builds de shared, API y web                                                                       | Código 0; wrangler build terminó como dry-run sin despliegue |

190 pruebas afectadas distintas en total, sin sumar las repeticiones de validación. No se ejecutó suite global. API usa Hono y adaptadores reales en memoria, incluyendo eventos emitidos por creación/edición; no acredita persistencia PostgreSQL ni despliegue remoto. Los tests de frontend usan respuestas controladas para ejercitar errores y carreras; la aplicación consulta el endpoint real, sin datos simulados en producción.

Cobertura: autenticación ausente y deshabilitada en producción, UUIDs inválidos, métodos no soportados, creador/miembro activo, miembro retirado, docente no asignado, tarea/proyecto inexistentes y tarea de otro proyecto, exclusión de eventos contaminados, orden determinista y lectura sin efectos. Frontend cubre HTTP/red/esquema/identidad, carga/vacío/error/reintento, resoluciones/rechazos tras cambio de tarea/proyecto o desmontaje, responsables UUID exactos, IDs incompatibles visibles, doble envío, selección conservada tras error y bloqueo del selector durante creación/edición.

Las primeras comprobaciones de tipos señalaron accesos a JSON unknown en las pruebas API; se sustituyeron por parseo con contratos existentes. Lint señaló un import que debía ser import type y se corrigió. No se modificaron aserciones válidas para eludir fallos.

Avisos pendientes: React act en pruebas anteriores del tablero que montan ahora TaskAssigneePicker/History; dos avisos de anotaciones Zod/Rollup en build web. La validación formal OpenSpec sigue bloqueada: no hay CLI en PATH ni node_modules/.bin; no se instaló ni descargó nada. No se ejecutó navegador ni comprobación remota en este incremento.

## Archivos de este incremento

Shared:

- packages/shared/src/contracts/task.contract.ts
- packages/shared/src/contracts/task-activity.contract.test.ts

API:

- apps/api/src/application/use-cases/get-task-activity.use-case.ts
- apps/api/src/application/use-cases/get-task-activity.use-case.test.ts
- apps/api/src/infrastructure/http/routes/task-activity.route.ts
- apps/api/src/infrastructure/http/routes/task-activity.route.test.ts
- apps/api/src/infrastructure/http/app.ts
- apps/api/src/infrastructure/openapi/openapi.contract.ts

Web:

- apps/web/src/services/task.service.ts
- apps/web/src/services/task-activity.service.test.ts
- apps/web/src/components/TaskActivityHistory.tsx
- apps/web/src/components/TaskActivityHistory.test.tsx
- apps/web/src/components/TaskAssigneePicker.tsx
- apps/web/src/components/CreateTaskModal.tsx
- apps/web/src/components/CreateTaskModal.assignees.test.tsx
- apps/web/src/components/EditTaskModal.tsx
- apps/web/src/components/EditTaskModal.assignees.test.tsx
- apps/web/src/components/KanbanBoard.tsx
- apps/web/src/components/ProjectDetail.assignees.test.tsx

Documentación: proposal.md, design.md, tasks.md y specs/boards-tasks/spec.md dentro del cambio activo openspec/changes/kanban-boards-tasks, más este informe. No se creó otro cambio OpenSpec ni se archivó el activo.

## Pendientes concretos

6.1 permanece abierta por la incompatibilidad de identidad y la comprobación manual pendiente de este incremento. El historial y la selección UUID ya están implementados y probados. Sigue pendiente el filtro por responsable de la tarea amplia 6.2, otras integraciones/barra contextual previstas en tasks.md, validación formal OpenSpec y verificación final completa del EPIC. Las confirmaciones manuales anteriores del usuario no se extienden a estas funciones nuevas.

## Resolución acotada de identidad de desarrollo (2026-10-26)

Este resultado sustituye el bloqueo descrito arriba para proyectos nuevos de desarrollo: no fue necesario ampliar EPIC-002 ni cambiar el modelo canónico. La autorización del usuario permite configuración, fixtures y sus consumidores en este worktree. Se centraliza el UUID fijo del estudiante en apps/web/src/services/dev-identity.ts y se reutiliza en proyectos, miembros, tablero, tareas/historial, AppShell y el valor predeterminado de ProjectDetail. Las identidades de segundo estudiante y docente usan UUIDs distintos. No se convierten cadenas, generan UUIDs de usuario por petición, cambian contratos/permisos ni implementa autenticación de producción. Las pruebas negativas del selector siguen cubriendo IDs textuales incompatibles.

### Evidencia ejecutada

- Frontend: `npm run test -w @is488/web -- src/services/board.service.test.ts src/services/membership.service.test.ts src/services/project.service.test.ts src/services/task.service.test.ts src/services/task-activity.service.test.ts src/components/AppShell.test.tsx src/components/ProjectDetail.test.tsx src/components/CreateTaskModal.assignees.test.tsx src/components/EditTaskModal.assignees.test.tsx src/components/ProjectDetail.assignees.test.tsx`: 10 archivos, 73 pruebas aprobadas.
- Flujo: `node node_modules/vitest/vitest.mjs run --workspace evidence/lista-paginada/dev-identity.workspace.ts`: 1 prueba aprobada. Usa servicios frontend reales, rutas Hono y repositorios en memoria de una app aislada; fetch se conecta a app.request, sin respuestas JSON prefabricadas. Crea proyecto, comprueba owner activo, agrega segundo miembro, asigna owner al crear y segundo miembro al editar. Lee eventos CREATED/UPDATED reales y comprueba actor y detalles assigneeIds from/to, además de lectura sin eventos adicionales.
- Negativos del mismo flujo: estudiante ajeno sin acceso, colaborador sin permiso para agregar miembros, docente ajeno sin acceso/asignación, IDs textuales rechazados en assigneeIds, miembro retirado sin acceso ni reasignación, dev-auth rechazado en producción. Un proyecto creado con identidad textual conserva exactamente esa identidad y queda separado del UUID nuevo.
- `npm.cmd run typecheck -w @is488/web`: aprobado.
- ESLint sobre los 16 archivos TypeScript afectados de este incremento: aprobado.
- `npm run build -w @is488/web`: aprobado; avisos de anotaciones PURE de Zod/Rollup, sin fallo.
- `openspec --version`: 1.7.0; `openspec validate kanban-boards-tasks --strict`: válido.
- La primera ejecución de Vitest no arrancó por acceso de esbuild restringido por sandbox; se repitió con ejecución autorizada. npm.ps1 fue bloqueado por la política de PowerShell y se usó npm.cmd sin cambiar políticas. El CLI OpenSpec se localizó en el entorno ampliado, sin instalar paquetes.

La evidencia es integración local real en memoria aislada, más pruebas de componentes; no constituye E2E manual de navegador, validación en Worker remoto, PostgreSQL ni CI. No se ejecutaron suites globales, operaciones Git de escritura ni se generaron ZIP. Los cambios locales anteriores se conservaron.

### Datos volátiles y reinicio

No se reinició ningún proceso ni se borraron/migraron datos. Recargar el frontend aplica la identidad nueva; crear un proyecto nuevo permite obtener el owner UUID compatible. No hace falta reiniciar el backend. Los proyectos existentes de dev-student-01 conservan su propietario textual y no aparecen para el nuevo UUID salvo que las reglas actuales le concedan acceso; sus miembros textuales siguen sin ser asignables. Si se elige reiniciar el Worker, se perderán todos sus datos volátiles: eso requiere una decisión consciente y no migra identidades.

Se completan I.1/I.2 del cambio activo. El bloqueo de identidad queda resuelto para datos nuevos de desarrollo; 6.1 y el EPIC completo permanecen abiertos por su alcance restante y verificación manual pendiente. No se archiva ni sincroniza el cambio completo como terminado.

## Incremento posterior: gestión de columnas

La gestión de columnas autorizada posteriormente se implementó y verificó sin ampliar backend/shared. Resultados, comandos, restricciones reales y pendientes en [Gestión de columnas de EPIC-003](columnas.md). Este incremento no cambia las conclusiones de identidad e historial anteriores.
