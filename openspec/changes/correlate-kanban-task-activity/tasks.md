# Tareas: correlación de actividad Kanban

Nivel C aprobado y Nivel D autorizado el 2026-11-14 para 2.1–2.3, exclusivamente crear, editar y mover tareas. Base revisada: `8dbf8b4e495d5e9d16789ce2e03842b53bd41e5d`. Tras la entrega local, el usuario autorizó guardar 2.1–2.3 en el commit `2d2042fcdc7e6bc898b15c76a03c5b109519bde3`. El avance posterior de 2.4 se registra a continuación; SQL y HTTP quedan pendientes. Las marcas de planificación solo acreditan lectura y validación documental; ninguna acredita implementación ni pruebas de aplicación. Diagnóstico y límites: [design.md](design.md).

El 2026-11-15 el usuario autorizó Nivel D exclusivamente para 2.4 desde `2d2042fcdc7e6bc898b15c76a03c5b109519bde3`, commit local posterior que guarda 2.1–2.3. La entrega de 2.4 queda sin staging ni commit para revisión local; SQL y HTTP siguen fuera de este bloque.

## 1. Planificación y revisión

- [x] 1.1 Ejecutar fetch, confirmar que `origin/main` contiene el SHA solicitado y avanzar la rama EPIC-007 solo con `git merge --ff-only origin/main`; comprobar conservación de ambos stashes y evidencia local.
- [x] 1.2 Contrastar el requisito canónico con código/pruebas de crear, editar, mover y eliminar; distinguir borrado de tarea, reasignación de columna, correlación ausente y cobertura no ejecutada.
- [x] 1.3 Preparar proposal, design, tasks y delta únicamente para correlación opcional de las operaciones existentes.
- [x] 1.4 Validar el cambio y todas las specs en modo estricto, comprobar Markdown/enlaces y `git diff --check`; registrar salidas reales.
- [x] 1.5 Obtener revisión humana C y autorización D explícita para bloques concretos antes de modificar código: el usuario aprobó C y autorizó 2.1–2.3 para crear/editar/mover el 2026-11-14, junto con un commit previo de los cuatro artefactos. Operaciones SQL, commit de código y publicación conservan compuertas independientes.

## 2. Contratos y propagación

- [x] 2.1 Añadir contexto/UUID opcional al evento, contratos y puertos atómicos de crear/editar/mover. Pruebas de contrato: campo válido, normalización de mayúsculas a minúsculas, ausente y valor inválido; preservar formatos de actor, tarea/proyecto, acción y fecha, incluyendo eventos históricos.
- [x] 2.2 Pasar el contexto por crear, editar y mover sin cambiar actor, reloj ni autorización. Unitarias con y sin correlación para las tres operaciones, entrada inválida en el puerto y comprobación explícita de actor/acción/taskId/projectId/createdAt.
- [x] 2.3 Conservar el campo en eventos/copias de los adaptadores en memoria de esas tres operaciones. Unitarias de no-op sin evento adicional, rechazo sin efectos, fallo antes de publicación sin correlación huérfana, eventos históricos y correlación repetida sin deduplicar cambios reales.
- [x] 2.4 Con autorización D posterior, extender contexto al caso de uso/puerto/adaptador de eliminación de columna. Probar varios eventos con UUID de evento distintos y correlación común, actor/recurso/fecha por tarea, ausencia/entrada inválida, rechazo y fallo atómico sin efectos parciales.

## 3. Persistencia PostgreSQL

- [ ] 3.1 Añadir migración 0008 nullable/manifiesto sin editar 0001–0007, y mapear inserción/lectura. Pruebas de migrador desde vacío y 0007 con eventos previos: hashes anteriores, IDs/fechas/metadatos intactos, NULL sin backfill y privilegios append-only.
- [ ] 3.2 Con autorización SQL específica y configuración explícita del clúster de pruebas, ejecutar integración de las cuatro operaciones: UUID exacto, los otros cuatro campos y lectura desde nueva instancia; registros previos sin campo, correlación ausente/inválida y lote con correlación compartida.
- [ ] 3.3 Ejecutar regresiones SQL de no-op, aislamiento, rollback tras estado/evento y denegación runtime de UPDATE/DELETE. Comprobar que correlaciones repetidas no deduplican cambios reales. Conservar evidencia saneada y limpiar solo recursos propios tras revalidar destino autorizado.

## 4. HTTP y OpenAPI

- [ ] 4.1 Extraer solo `X-Correlation-ID` UUID opcional en las cuatro mutaciones afectadas. Pruebas HTTP de valor válido, ausente, vacío, largo, múltiples valores e inválido: se omite lo inválido y no cambia la semántica actual de la mutación; no se copian headers/cookies/tokens a auditoría ni al error.
- [ ] 4.2 Documentar cabecera opcional y campo de respuesta en OpenAPI; probar historial con/sin campo y compatibilidad de esquemas, `no-store`, 401/404, IDs de otro proyecto y bodies que intentan fijar actor/correlación. Una correlación coincidente no concede acceso ni altera la identidad de sesión.
- [ ] 4.3 Verificar HTTP con PostgreSQL real en el destino autorizado: crear/editar/mover/reasignar y consultar historial, comparación exacta de los cinco campos, no-op/rechazos sin eventos y rollback conjunto. Registrar resultado sin presentarlo como E2E de navegador.

## 5. Controles y revisión de implementación futura

- [ ] 5.1 Ejecutar `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run format:check`, `npm.cmd test`, `npm.cmd run build`, pruebas afectadas de migrador/preparación y contrato OpenAPI. Registrar aprobadas, fallidas y omitidas por suite, sin contar SQL omitido como aprobado.
- [ ] 5.2 Ejecutar validación OpenSpec estricta del cambio/global y `git diff --check`; revisar alcance, ausencia de secretos, hashes 0006/0007, ambos stashes y evidencia preexistente intactos. No marcar eliminación de tareas como verificada ni archivar/publicar sin autorización.

## Evidencia de Nivel C — 2026-11-14

- `git fetch origin`: aprobado; `origin/main` pasó de `92e1ee7` a `8dbf8b4`.
- `git merge-base --is-ancestor 8dbf8b4e495d5e9d16789ce2e03842b53bd41e5d origin/main`: exit 0.
- `git merge --ff-only origin/main`: aprobado; la rama pasó de `34f17f2021e6238448e0a615939038287845fecc` a `8dbf8b4e495d5e9d16789ce2e03842b53bd41e5d`, sin commit de merge.
- Stashes conservados: `stash@{0}` = `54fc9332067969efdb9dd2684becb77131db372e`; `stash@{1}` = `794dd6cfb08221fee13c2420fd7455c621d7d9cd`.
- `evidence/review-notification-inbox/` sigue local y fuera del staging. No se ejecutan SQL, E2E ni suites de aplicación en esta revisión documental; las pruebas citadas en el diagnóstico son cobertura inspeccionada, no nuevas aprobaciones.
- OpenSpec instalado: `1.7.0`. `openspec validate correlate-kanban-task-activity --strict`: cambio válido, exit 0. `openspec validate --all --strict`: 13 aprobadas, 0 fallidas, exit 0.
- `node node_modules/prettier/bin/prettier.cjs --check --ignore-path .git/info/exclude` con los cuatro archivos explícitos: aprobado. Comprobador Node de enlaces relativos en stdin: 38 enlaces existentes en 4 archivos, sin espacios finales ni falta de newline.
- `git diff --check`: aprobado. Los archivos nuevos, aún sin staging, también se comprobaron individualmente con `git -c core.autocrlf=false diff --no-index --check -- NUL <archivo>`: sin diagnósticos de espacios; exit 1 corresponde a la diferencia frente al archivo vacío, no a un fallo de formato.
- Integridad: los 12 archivos de evidencia conservan su SHA-256 respecto al inventario previo local. Hash 0006 = `8fcc1d9fce4289b72f21bb8fcfdd40548f3ca71530a5ab93ca66b0b1a26cb77f`; hash 0007 = `9961626c0b38c2c4c270848130e2c12eab083ca74271cce43fdf16ad744cd7e3`, sin cambios. No se añadieron archivos al índice.

## Evidencia de Nivel D — bloque 2.1–2.3 — 2026-11-14

- Commit documental autorizado: `70adc5f7029358ae1c6860865167cf9024e3ff04`, `docs(openspec): approve Kanban activity correlation`; contiene exclusivamente los cuatro artefactos, después de `git diff --cached --check` aprobado. El diff de código y este registro posterior se entregan sin staging ni commit.
- Implementación: validador compartido de UUID de 36 caracteres normalizado a minúsculas; contexto opcional en evento, DTO, comandos y puertos de crear/editar/mover. Los casos de uso y adaptadores atómicos omiten metadatos inválidos, sin generar IDs ni cambiar identidad/permisos. La publicación única sigue guardando tarea y evento juntos. El repositorio de actividad en memoria conserva el campo validado al registrar y devuelve copias; los eventos históricos permanecen sin el campo.
- `npm.cmd run test -w @is488/shared -- src/contracts/task-activity-correlation.test.ts src/contracts/task-activity.contract.test.ts`: 26 aprobadas, 0 fallidas, 0 omitidas; incluye 21 nuevas de correlación/contrato histórico.
- `npm.cmd run test -w @is488/api -- src/application/use-cases/task-activity-correlation.use-cases.test.ts`: 33 aprobadas, 0 fallidas, 0 omitidas. Integración local en memoria de casos de uso/puertos/adaptadores: campos de auditoría exactos, contexto ausente/inválido, validación en llamada directa al puerto, fallo antes de publicación con snapshot intacto, acceso ajeno denegado aun compartiendo correlación, IDs de evento distintos en cambios efectivos repetidos, lectura/copia, no-op y reordenamiento dentro de columna. No acredita PostgreSQL ni navegador.
- `npm.cmd run lint`, `npm.cmd run typecheck` y `npm.cmd run format:check`: aprobados, exit 0.
- Primer `npm.cmd test` en sandbox: shared 215 y API 604 aprobadas, 88 SQL omitidas; web no arrancó por `Acceso denegado` de esbuild al leer configuración. Primer `npm.cmd run build` en sandbox: exit 1 por la misma restricción y `EPERM` al crear logs de Wrangler. No hubo aserciones fallidas ni cambios de pruebas para resolverlo.
- Reejecución de `npm.cmd test` con permisos ampliados: exit 0; shared 215 + API 604 + web 250 = **1069 aprobadas, 0 fallidas y 88 SQL omitidas**. Incluye la regresión existente de permisos, Kanban, historial y contrato OpenAPI. Las 54 pruebas nuevas ya están incluidas en ese total; las ejecuciones focalizadas no se suman otra vez.
- Reejecución de `npm.cmd run build` con permisos ampliados: exit 0; shared, Worker en dry-run y frontend compilados. Rollup emitió avisos sobre anotaciones de comentarios de Zod. Sin publicación ni despliegue.
- `openspec validate correlate-kanban-task-activity --strict`: válido; `openspec validate --all --strict`: 13 aprobadas, 0 fallidas, exit 0. Formato de los cuatro artefactos y `git diff --check`: aprobados. Diff local completo, incluidos los tres archivos TypeScript nuevos: `.local-dev/correlate-kanban-task-activity/block-2.patch`, generado contra el SHA documental y fuera del staging.
- SQL real, migraciones/preparación y E2E: no ejecutados en este bloque; no se activaron sus variables de pruebas. Permanecen pendientes 2.4 y los bloques 3–5 del cambio completo. HTTP aún no extrae la cabecera y PostgreSQL aún no persiste el nuevo campo.
- Se vuelven a comprobar ambos stashes, los 12 hashes de evidencia y hashes 0006/0007: intactos. No se cambia el manifiesto, SQL ni código de eliminación de columnas/tareas.

## Evidencia de Nivel D — tarea 2.4 — 2026-11-15

- Autorización del usuario limitada a 2.4, desde `2d2042fcdc7e6bc898b15c76a03c5b109519bde3`. Se modifica únicamente el puerto, caso de uso y adaptador en memoria de eliminación de columna, sus dos suites existentes y este checklist. Sin staging, commit ni publicación.
- `correlationId` opcional se valida/normaliza con el helper compartido en el caso de uso y en el adaptador para llamadas directas. Los eventos `COLUMN_DELETED_REALLOCATION` tienen UUID de evento distintos, la misma correlación aceptada y actor de sesión/caso de uso, `taskId`, `projectId` y fecha exactos. Se conservan los históricos; UUID ausente o inválido se omite. Columna vacía no fabrica eventos.
- Pruebas de rechazo: usuario no autorizado (404), columna con tareas sin destino (409), destino igual al origen o inexistente (400). En todos se compara el snapshot completo y se comprueba que no se publica estado.
- Fallos atómicos: antes de publicar y durante el registro real en memoria al serializar el segundo evento. Se inyecta el error en `JSON.stringify` usado por `cloneEvent` durante `commitSnapshot`, tras serializar el primer evento nuevo. La copia completa falla antes de sustituir la referencia compartida: columna, tareas de origen/destino, índices, revisión y eventos históricos permanecen exactamente iguales; no hay eventos parciales. No se simula un escritor independiente ni se acredita PostgreSQL.
- `npm.cmd run test -w @is488/api -- src/application/use-cases/delete-board-column.use-case.test.ts src/infrastructure/adapters/repositories/in-memory-board-column-deletion.adapter.test.ts src/application/use-cases/task-activity-correlation.use-cases.test.ts src/infrastructure/http/routes/board.route.test.ts src/infrastructure/http/routes/task-activity.route.test.ts`: **106 aprobadas, 0 fallidas, 0 omitidas**, incluidas 13 nuevas (10 del caso de uso y 3 del adaptador).
- `npm.cmd run test -w @is488/shared -- src/contracts/task-activity-correlation.test.ts src/contracts/task-activity.contract.test.ts`: **26 aprobadas, 0 fallidas, 0 omitidas**. Las dos ejecuciones afectadas suman 132 aprobadas.
- `npm.cmd test`, con permisos ampliados por la restricción de esbuild ya comprobada en el bloque anterior: exit 0; shared 215 + API 617 + web 250 = **1082 aprobadas, 0 fallidas y 88 SQL omitidas**. Los perfiles SQL se verificaron desactivados. Las 13 nuevas y las ejecuciones focalizadas ya están incluidas en el total, sin sumarlas dos veces.
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run format:check`: aprobados, exit 0. `npm.cmd run build` con permisos ampliados: exit 0, shared/Worker dry-run/web compilados; avisos de Rollup sobre anotaciones de Zod, sin publicación/despliegue.
- `openspec validate correlate-kanban-task-activity --strict`: válido, exit 0; `openspec validate --all --strict`: **13 aprobadas, 0 fallidas**, exit 0. Formato Markdown y `git diff --check`: aprobados. Diff completo contra la base: `.local-dev/correlate-kanban-task-activity/block-2.4.patch`, fuera del staging.
- Integridad: HEAD y rama se conservan, índice vacío, ambos stashes y los 12 SHA-256 de evidencia intactos, hashes 0006/0007 sin cambios. No se ejecutan SQL real ni E2E y no se modifican migraciones, manifiesto, HTTP/OpenAPI o frontend. Los bloques 3–5 siguen pendientes.
