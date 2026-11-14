# Tareas: correlación de actividad Kanban

Nivel C aprobado y Nivel D autorizado el 2026-11-14 para 2.1–2.3, exclusivamente crear, editar y mover tareas. Base revisada: `8dbf8b4e495d5e9d16789ce2e03842b53bd41e5d`. Commit documental separado autorizado; el código se entrega después sin commit para revisión local. Reasignación de columnas (2.4), SQL y HTTP quedan pendientes. Las marcas de planificación solo acreditan lectura y validación documental; ninguna acredita implementación ni pruebas de aplicación. Diagnóstico y límites: [design.md](design.md).

## 1. Planificación y revisión

- [x] 1.1 Ejecutar fetch, confirmar que `origin/main` contiene el SHA solicitado y avanzar la rama EPIC-007 solo con `git merge --ff-only origin/main`; comprobar conservación de ambos stashes y evidencia local.
- [x] 1.2 Contrastar el requisito canónico con código/pruebas de crear, editar, mover y eliminar; distinguir borrado de tarea, reasignación de columna, correlación ausente y cobertura no ejecutada.
- [x] 1.3 Preparar proposal, design, tasks y delta únicamente para correlación opcional de las operaciones existentes.
- [x] 1.4 Validar el cambio y todas las specs en modo estricto, comprobar Markdown/enlaces y `git diff --check`; registrar salidas reales.
- [x] 1.5 Obtener revisión humana C y autorización D explícita para bloques concretos antes de modificar código: el usuario aprobó C y autorizó 2.1–2.3 para crear/editar/mover el 2026-11-14, junto con un commit previo de los cuatro artefactos. Operaciones SQL, commit de código y publicación conservan compuertas independientes.

## 2. Contratos y propagación

- [ ] 2.1 Añadir contexto/UUID opcional al evento, contratos y puertos atómicos de crear/editar/mover. Pruebas de contrato: campo válido, normalización de mayúsculas a minúsculas, ausente y valor inválido; preservar formatos de actor, tarea/proyecto, acción y fecha, incluyendo eventos históricos.
- [ ] 2.2 Pasar el contexto por crear, editar y mover sin cambiar actor, reloj ni autorización. Unitarias con y sin correlación para las tres operaciones, entrada inválida en el puerto y comprobación explícita de actor/acción/taskId/projectId/createdAt.
- [ ] 2.3 Conservar el campo en eventos/copias de los adaptadores en memoria de esas tres operaciones. Unitarias de no-op sin evento adicional, rechazo sin efectos, fallo antes de publicación sin correlación huérfana, eventos históricos y correlación repetida sin deduplicar cambios reales.
- [ ] 2.4 Con autorización D posterior, extender contexto al caso de uso/puerto/adaptador de eliminación de columna. Probar varios eventos con UUID de evento distintos y correlación común, actor/recurso/fecha por tarea, ausencia/entrada inválida, rechazo y fallo atómico sin efectos parciales.

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
