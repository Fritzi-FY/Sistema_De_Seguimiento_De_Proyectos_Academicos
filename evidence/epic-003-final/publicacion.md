# Preparación de publicación de EPIC-003

Autorización del usuario para commits, push exclusivo de feature/epic-003-kanban-boards-tasks sin force-push y PR en borrador hacia main. La autorización no incluye merge, rebase, reset, amend, despliegue ni archivo OpenSpec. El EPIC sigue abierto.

## Comparación previa

main y origin/main coinciden en 9ce870e527a0c9d3699076271d73d7023c4803c9, tras consultar origin. Ese commit es ancestro de HEAD b4814659eb760500f15ec8c70154c7c03f55b090. La rama ya contiene cinco commits propios, que se conservan. No se detectó divergencia con main ni fue necesario resolver conflictos. El índice estaba vacío antes de seleccionar los cambios. La rama remota de EPIC-003 no existía en la consulta previa.

La configuración .github/workflows/ci.yml existe y se activa para PR hacia main: validación OpenSpec y quality gates (formato, lint, tipos, pruebas, build). La rama predeterminada del repositorio es histórica, por lo que se especifica main explícitamente como base; no se cambia la configuración del repositorio. No se presupone CI verde antes de consultar la ejecución del PR.

## Revisión y evidencia reutilizada

Los 39 archivos nuevos de código/pruebas revisados coinciden por SHA-256 con el snapshot verificado del ZIP final. Se revisaron contratos, permisos del historial, aislamiento, validación HTTP, cabeceras dev, modales, bloqueo de mutaciones, reconsulta y pruebas. No se repiten suites aprobadas al no existir cambios de código respecto a esa evidencia. Resultados vigentes: 613 pruebas en 65 archivos y dos flujos HTTP reales aislados aprobados; tipos, lint, builds y validación estricta OpenSpec aprobados; formato corregido/verificado de forma acotada. Avisos PURE de Zod/Rollup sin fallo de build. La validación de los documentos añadidos para publicar se hace por separado.

Se incluyen exclusivamente las dependencias dnd-kit ya autorizadas en el EPIC: core ^6.3.1, sortable ^8.0.0 y utilities ^3.2.2 según package.json/lockfile actuales, sin instalar ni incorporar paquetes nuevos durante la publicación. Sin costos/proveedores nuevos. El almacenamiento es en memoria volátil y dev-auth solo admite desarrollo/pruebas: no se presenta como autenticación o persistencia de producción. Conformidad visual general en conformidad-visual.md; no acredita escenarios manuales específicos. Quedan pendientes comprobaciones manuales/E2E y revisión humana; CI se informa según el estado real del PR.

## Selección explícita por commit

### API e historial

Mensaje previsto: `feat(api): expose scoped task history and list validation`.

```text
packages/shared/src/contracts/task.contract.ts
packages/shared/src/contracts/task-activity.contract.test.ts
apps/api/src/application/use-cases/get-task-activity.use-case.ts
apps/api/src/application/use-cases/get-task-activity.use-case.test.ts
apps/api/src/infrastructure/http/routes/task-activity.route.ts
apps/api/src/infrastructure/http/routes/task-activity.route.test.ts
apps/api/src/infrastructure/http/app.ts
apps/api/src/infrastructure/http/routes/tasks.route.ts
apps/api/src/infrastructure/http/routes/tasks.route.test.ts
apps/api/src/infrastructure/openapi/openapi.contract.ts
```

### Frontend y dependencias aprobadas

Mensaje previsto: `feat(web): complete kanban task and column workflows`.

```text
apps/web/package.json
apps/web/src/components/AppShell.test.tsx
apps/web/src/components/AppShell.tsx
apps/web/src/components/BoardColumnManager.test.tsx
apps/web/src/components/BoardColumnManager.tsx
apps/web/src/components/CreateTaskModal.assignees.test.tsx
apps/web/src/components/CreateTaskModal.test.tsx
apps/web/src/components/CreateTaskModal.tsx
apps/web/src/components/EditTaskModal.assignees.test.tsx
apps/web/src/components/EditTaskModal.test.tsx
apps/web/src/components/EditTaskModal.tsx
apps/web/src/components/KanbanBoard.collision.test.ts
apps/web/src/components/KanbanBoard.move.test.tsx
apps/web/src/components/KanbanBoard.pointer.test.tsx
apps/web/src/components/KanbanBoard.test.tsx
apps/web/src/components/KanbanBoard.tsx
apps/web/src/components/KanbanColumn.test.tsx
apps/web/src/components/KanbanColumn.tsx
apps/web/src/components/ProjectDetail.assignees.test.tsx
apps/web/src/components/ProjectDetail.test.tsx
apps/web/src/components/ProjectDetail.tsx
apps/web/src/components/ProjectDetail.views.test.tsx
apps/web/src/components/TaskActivityHistory.test.tsx
apps/web/src/components/TaskActivityHistory.tsx
apps/web/src/components/TaskAssigneePicker.tsx
apps/web/src/components/TaskCard.test.tsx
apps/web/src/components/TaskCard.tsx
apps/web/src/components/TaskFiltersBar.test.tsx
apps/web/src/components/TaskFiltersBar.tsx
apps/web/src/components/TaskListView.filters.test.tsx
apps/web/src/components/TaskListView.test.tsx
apps/web/src/components/TaskListView.tsx
apps/web/src/index.ts
apps/web/src/services/board.service.test.ts
apps/web/src/services/board.service.ts
apps/web/src/services/board-columns.service.test.ts
apps/web/src/services/dev-identity.ts
apps/web/src/services/membership.service.test.ts
apps/web/src/services/membership.service.ts
apps/web/src/services/project.service.test.ts
apps/web/src/services/project.service.ts
apps/web/src/services/task.service.test.ts
apps/web/src/services/task.service.ts
apps/web/src/services/task-activity.service.test.ts
package-lock.json
```

### OpenSpec y evidencia pertinente

Mensaje previsto: `docs(epic-003): record verification and draft publication scope`.

```text
openspec/changes/kanban-boards-tasks/proposal.md
openspec/changes/kanban-boards-tasks/design.md
openspec/changes/kanban-boards-tasks/tasks.md
openspec/changes/kanban-boards-tasks/specs/boards-tasks/spec.md
evidence/epic-003-final/auditoria.md
evidence/epic-003-final/informe.md
evidence/epic-003-final/conformidad-visual.md
evidence/epic-003-final/publicacion.md
evidence/lista-paginada/columnas.md
evidence/lista-paginada/historial-creacion.md
evidence/lista-paginada/confirmacion-usuario-lista.md
evidence/lista-paginada/columns.flow.test.ts
evidence/lista-paginada/columns.workspace.ts
evidence/lista-paginada/dev-identity.flow.test.ts
evidence/lista-paginada/dev-identity.workspace.ts
```

## Exclusiones preservadas localmente

No se agregan archivos de entorno o secretos, dependencias instaladas, builds, cachés ni temporales. Los archivos locales siguientes quedan fuera de los nuevos commits, sin borrarlos:

```text
archivos_actuales_incremento_3a.md
auditoria_estado_4a.md
cierre_4a_verificado.md
EPIC-003-revision-final.zip
EPIC-003-revision-final.zip.sha256
evidence/epic-003-final/branch-vs-main.diff
evidence/epic-003-final/git-head.txt
evidence/epic-003-final/git-status.txt
evidence/epic-003-final/package-review.ps1
evidence/epic-003-final/rama-vs-main-inicial.txt
evidence/epic-003-final/SHA256SUMS.txt
evidence/epic-003-final/status-inicial.txt
evidence/epic-003-final/tracked.diff
evidence/lista-paginada/cierre-lista-destinos-vacios.md
evidence/lista-paginada/columns-test-results.json
evidence/lista-paginada/manifest.json
evidence/lista-paginada/manifest-cierre.json
evidence/lista-paginada/revision.md
lista-paginada-destinos-vacios-cierre.zip
lista-paginada-revision.zip
movimiento-kanban-revision.zip
movimiento-kanban-revision-actualizado.zip
openspec/superseded/kanban-task-movement/design.md
openspec/superseded/kanban-task-movement/proposal.md
openspec/superseded/kanban-task-movement/specs/boards-tasks/spec.md
openspec/superseded/kanban-task-movement/tasks.md
revision_3d.md
revision_4a.md
revision_4b.md
```

También se conservan localmente los logs ignorados de evidence/epic-003-final, los outputs dist/.wrangler y tsbuildinfo, así como node_modules. Los dos archivos del repositorio de columnas que solo tenían cambios de formato/estado de filesystem no tienen diff de contenido y no se agregan. No se usa git add indiscriminado ni se fuerza la inclusión de logs ignorados. Las notas superseded y los informes antiguos no se publican como evidencia nueva. El ZIP y sus hashes siguen siendo el snapshot anterior a estos commits/documentos; no se regeneran ni se presentan como snapshot del PR.
