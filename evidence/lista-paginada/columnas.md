# Gestión de columnas de EPIC-003

Autorización explícita de implementación del usuario del 2026-10-26, en el worktree y rama existentes. Se conservaron los cambios locales previos. No se modificaron backend/shared, contratos, permisos, EPIC-002, dependencias ni configuración de autenticación. Sin operaciones Git de escritura, suites globales, reinicios ni ZIP.

## Capacidades verificadas y comportamiento

- POST crea nombre (trim, 1–50 caracteres) y categoría TODO, IN_PROGRESS, IN_REVIEW o DONE. La inicialización existente sigue creando únicamente Por hacer, En progreso y Completado. En revisión es opcional.
- PATCH renombra o desplaza una columna con orderIndex; el backend recompone índices contiguos. Los controles Mover antes/después envían posiciones adyacentes; no se introduce un algoritmo alternativo de ordenación.
- DELETE exige confirmación. Si hay tareas, la interfaz exige seleccionar otra columna del tablero. El servidor vuelve a comprobar las restricciones: 409 sin destino, 400 con destino inválido/igual a origen, 400 al intentar eliminar la última columna. La interfaz también permite elegir destino cuando la última lectura mostraba la columna vacía, para contemplar tareas añadidas desde entonces. Sin destino, una columna que haya dejado de estar vacía será rechazada por el backend.
- La eliminación existente traslada tareas al final del destino, conserva el orden y registra COLUMN_DELETED_REALLOCATION. El frontend no mueve ni borra tareas localmente: consulta nuevamente tablero y tareas después de la respuesta válida.
- Creación/actualización validan esquemas compartidos y pertenencia boardId/id. DELETE valida exactamente los campos exigidos por el OpenAPI actual: success true, deletedColumnId coincidente y UUID, migratedTasksCount entero no negativo. GET de tablero comprueba projectId y pertenencia de sus columnas.
- Las mutaciones no son optimistas. La referencia de exclusión impide doble envío; mientras se gestiona columnas se bloquean las interacciones de tareas y durante la escritura/lecturas posteriores también se bloquea el selector Tablero/Lista. El gestor no se abre durante creación/edición/movimiento de tareas.
- Un error conserva los campos y muestra la causa; no anuncia éxito. Un error de escritura o de la lectura posterior exige Actualizar tablero antes de volver a escribir. Este botón realiza solo lecturas, sin reenviar la mutación. También conserva el bloqueo si esa recuperación falla. No se infiere rollback ante una respuesta perdida.
- Guardas de montaje, proyecto y operación descartan resoluciones y rechazos tardíos. Se conserva el comportamiento previo de descarte al cambiar de tarea.
- Al entrar a Lista se vuelve a consultar el tablero mediante el montaje existente; las opciones del filtro reciben nombres, IDs y orden recientes. No se añade gestión de columnas dentro de Lista ni persistencia de filtros entre montajes.

## Archivos del incremento

- Servicios: apps/web/src/services/board.service.ts y board-columns.service.test.ts.
- UI: apps/web/src/components/BoardColumnManager.tsx, BoardColumnManager.test.tsx, KanbanBoard.tsx y mensaje de espera de ProjectDetail.tsx.
- Flujo real aislado: columns.flow.test.ts y columns.workspace.ts en este directorio.
- OpenSpec activo: proposal.md, design.md, tasks.md y specs/boards-tasks/spec.md de kanban-boards-tasks.

## Evidencia ejecutada

Selección frontend (11 archivos, 92 pruebas aprobadas, cero fallos; reporte columns-test-results.json):

```powershell
npm run test -w @is488/web -- src/services/board-columns.service.test.ts src/services/board.service.test.ts src/components/BoardColumnManager.test.tsx src/components/KanbanBoard.test.tsx src/components/KanbanBoard.move.test.tsx src/components/ProjectDetail.views.test.tsx src/components/ProjectDetail.assignees.test.tsx src/components/KanbanColumn.test.tsx src/components/KanbanBoard.pointer.test.tsx src/components/KanbanBoard.collision.test.ts src/components/TaskListView.filters.test.tsx --reporter=json --outputFile=../../evidence/lista-paginada/columns-test-results.json
```

Después del último ajuste de foco y mensajes de validación se repitió BoardColumnManager.test.tsx: 11/11 aprobadas (incluidas en las 92, no adicionales). Cubre crear/renombrar/mover antes y después, cancelar, validación, confirmación, eliminación vacía/con tareas, última columna, bloqueo de tareas/vistas, doble envío, errores, recuperación fallida, respuestas y rechazos tras cambio de proyecto y desmontaje. La prueba de vistas verifica opciones de Lista después de crear, renombrar y ordenar.

Flujo local real (1 prueba aprobada):

```powershell
node node_modules/vitest/vitest.mjs run --workspace evidence/lista-paginada/columns.workspace.ts
```

Utiliza los servicios frontend reales, app.request de Hono y los repositorios reales en memoria de una app aislada. No hay respuestas JSON prefabricadas. Comprueba columnas iniciales, IN_REVIEW opcional, renombrado, índices contiguos, tareas preexistentes en destino, traslado ordenado, historial real, eliminación vacía, última columna y aislamiento de usuario ajeno. Es integración HTTP en proceso, no un servidor de red, navegador, Worker remoto ni PostgreSQL.

Otras verificaciones: `npm.cmd run typecheck -w @is488/web` aprobado; ESLint de los ocho archivos TypeScript del incremento aprobado; Prettier acotado al incremento y cuatro artefactos OpenSpec aprobado. `npm run build -w @is488/web` aprobado (1710 módulos); avisos de anotaciones PURE de Zod/Rollup, sin fallo. El CLI OpenSpec 1.7.0 ya instalado validó estrictamente el alcance antes de implementar y al finalizar: `C:/Users/fritz/AppData/Roaming/npm/openspec.cmd validate kanban-boards-tasks --strict`, resultado `Change 'kanban-boards-tasks' is valid`. Tras endurecer la guarda de exclusión se repitieron gestor y movimiento: 16/16 aprobadas, incluidas en las 92. `git diff --check` aprobado, con avisos habituales LF/CRLF, sin errores de whitespace.

La primera selección encontró mocks nuevos que reutilizaban Response consumidas y alteraban orderIndex al simular renombrado. También detectó una regresión de bloqueo que impedía probar el cambio de tarea durante una respuesta tardía y el cambio de texto del mensaje existente de espera. Se corrigieron los mocks y se conservó el comportamiento de aislamiento existente, sin eliminar ni debilitar aserciones.

## Revisión de interfaz acotada

Dirección: continuar el sistema de docs/10-ui-ux-system.md y los controles de filtros existentes. ENERGY 1 / RHYTHM 1 / MOTION 1: gestor utilitario sin animaciones nuevas. Filas repetidas porque todas las columnas ofrecen las mismas operaciones; énfasis en nombres, confirmación y estados. Sin iconos, imágenes, fuentes, colores de marca ni activos nuevos.

- PASS, controles y feedback: pruebas automatizadas recorren las acciones nuevas; no hay controles sin acción. Errores con role alert y confirmación con role status, sin éxito anticipado.
- PASS, teclado/foco en el código y pruebas: botones/select/input nativos, etiquetas y nombres de acción por columna, foco inicial en nombre, foco prudente en cancelar eliminación, Escape y retorno al control de apertura tras confirmar. Foco visible y objetivos min-h-11 en los controles nuevos.
- PASS, composición y contenido: panel desplegable, filas con flex-wrap y campos w-full; reutiliza el sistema existente, sin activos ni afirmaciones inventadas. Texto nuevo slate-700/800/900 sobre fondos claros.
- PASS, calidad técnica: pruebas afectadas, tipo, lint y build comprobados. Sin cambios backend/shared ni ampliación de dependencias.

Esta revisión no acredita una inspección visual en navegador a tamaños móvil/escritorio ni una auditoría completa WCAG. Esa comprobación manual queda pendiente, junto con E2E de navegador y CI del EPIC. No se declara terminado el EPIC ni se archiva/sincroniza el cambio completo.
