## Context

Base consultada: specs canónicas boards-tasks, cambio activo kanban-boards-tasks, persistencia de proyectos/membresías, ADR-003/007, docs de arquitectura/modelo/seguridad/pruebas y puertos existentes. Se conservan las reglas detalladas del Kanban: inicialización perezosa de tres columnas, máximo diez y mínimo una, índices contiguos, clamping, no-op, reasignación al eliminar columnas, filtros y permisos por endpoint.

El runner corregido ofrece migraciones versionadas y diagnósticos separados de transacción/transporte/cierre. SqlSession ya proporciona transacciones y contexto por request. Se reutilizan sin introducir SQL en el dominio ni en los controladores.

## Goals / Non-Goals

Durabilidad SQL completa y paridad con Maps. Sin nuevos endpoints, reglas de acceso, proveedor, dependencias, importación de memoria, ni ejecución de migraciones sobre la base de desarrollo durante esta fase. Drizzle, Better Auth y Neon conservan su carácter provisional; se reutiliza el adaptador pg ya implementado.

## Decisions

Decisiones implementadas y verificadas bajo el alcance local autorizado:

1. **Migración 0003 aditiva.** Tablas boards, board_columns, tasks, task_assignees y task_activity; nombres finales sujetos a revisión del SQL. Un tablero por proyecto, FK de proyecto/columna con aislamiento, checks de campos/orden y unicidad de posiciones por contenedor compatible con reordenamiento transaccional. Índices por proyecto/columna/posición, responsables e historial. Labels como arreglo acotado; detalles de actividad como JSONB validado por los contratos actuales. Se conservan IDs, fechas y campos públicos.
2. **Historial durable e inmutable.** Runtime solo SELECT/INSERT sobre actividad, sin UPDATE/DELETE. Eliminar una columna no elimina sus eventos ni obliga a borrar las referencias históricas de origen/destino; no aplicar cascadas destructivas al historial. El orden continúa siendo createdAt descendente e id ascendente, según el caso de uso actual.
3. **Transacción por operación.** Reutilizar SqlSession. Serializar escrituras de un proyecto con lock SQL de su fila; ordenar locks de membresías de forma determinista y revalidar actor/responsables dentro de la transacción. Los locks sobre membresías deben entrar en conflicto con el UPDATE de retiro existente, para evitar validar responsables con estado obsoleto. No basta un mutex de proceso ni una comprobación anterior al BEGIN. Mantener límites temporales existentes y medir consultas; no elevar timeouts como solución inicial.
4. **Publicación atómica.** Crear tarea + posición + CREATED; editar campos/asignados + UPDATED; mover y compactar origen/destino + MOVED; eliminar columna y reasignar tareas + eventos, todo en una transacción. No-op no cambia updatedAt ni emite evento. Índices efectivos se calculan bajo lock. Un fallo confirmado revierte todo; COMMIT incierto detiene sin reintento ni afirmación de rollback, y el cierre permanece separado.
5. **Lecturas consistentes.** Adaptar BoardRepositoryPort, TaskRepositoryPort, TaskActivityRepositoryPort y TaskListPort; conservar filtros AND, búsqueda como subcadena literal insensible a mayúsculas, paginación 20/100 y orden (columnId, orderIndex, createdAt). Página y total proceden del mismo snapshot SQL; no crear eventos al consultar. Mantener private/no-store y no depender de caché SQL para lecturas inmediatas.
6. **ACL evolutivas.** Extender la política del migrador por versión/estado de catálogo: poder verificar y actualizar desde 1/2 sin exigir prematuramente tablas 3, y rechazar cualquier tabla/permiso esperado que falte una vez aplicada 3. DELETE solo donde las operaciones vigentes lo requieren; nunca concederlo globalmente ni ampliar acceso a proyectos/membresías/ledger. Mantener verificaciones agrupadas de ownership, columnas, delegación y MAINTAIN.
7. **Composición completa.** Reutilizar el selector por request en app.ts para todos los puertos Kanban, incluidos los atómicos. memory conserva Maps; postgres utiliza SQL en todos ellos y falla si falta configuración/esquema, sin fallback silencioso. No se cambian puertos salvo incompatibilidad demostrada y revisión explícita previa.

## Archivos previstos para una futura implementación

- `apps/api/migrations/sql/0003_kanban_persistence.sql`, `manifest.json`, `runtime-privileges.ts`, `runner.ts` si la verificación por versión lo exige, y sus pruebas focalizadas.
- `apps/api/src/infrastructure/postgresql/kanban.repositories.ts`: repositorios de tablero/columnas, tareas y actividad.
- `apps/api/src/infrastructure/postgresql/kanban.transactions.ts`: adaptadores TaskCreationPort, TaskUpdatePort, TaskMovePort y BoardColumnDeletionPort.
- `apps/api/src/infrastructure/postgresql/kanban-list.adapter.ts`: TaskListPort.
- `apps/api/src/infrastructure/http/app.ts`: composición SQL/Maps completa.
- `apps/api/src/infrastructure/postgresql/kanban.sql.test.ts` y prueba local de reinicio/proxy, usando fixtures aislados y las suites Maps relevantes existentes.
- `docs/04-data-model.md`, `docs/development-local.md` y evidencia local: documentar el estado durable únicamente tras verificarlo.

No se modifican SQL 0001/0002 ni sus hashes, los adaptadores Maps, UI o contratos HTTP para lograr persistencia.

## Migration Plan / Recovery

Probar base vacía y actualización 2→3 sobre fixtures exclusivos, con proyectos/membresías y asignaciones docentes previos intactos. Crear tableros por el mecanismo perezoso existente; no reconstruir estados de memoria perdidos. Ejecutar plan→apply→plan manual, con auditoría conservada; no migrar al iniciar cada request. Ante fallo, conservar evidencia y detener; recuperación bajo autorización, sin editar ledger ni borrar historial para reaplicar. Reiniciar dos procesos API contra la misma base de pruebas para comprobar durabilidad y concurrencia.

## Decisiones resueltas

El usuario autorizo mantener la rama actual y no importar Maps. Posteriormente aprobo 0004 para preservar listas ordenadas con repeticiones sin modificar 0003. Los resultados y limites se registran abajo.

## Implementación local autorizada y evidencia

Autorización D: continuar en la rama actual, sin importar Maps, aplicar 0003 solo en is488_dev y conservar proyectos/membresías. El usuario autorizó después 0004 para preservar responsables repetidos sin reescribir 0003. Se conserva feature/epic-002-postgresql-projects-memberships y el trabajo previo, sin Git de escritura.

Implementado: migraciones 0003/0004; repositorios SQL de tablero/columnas, tareas e historial; puertos atómicos de creación/edición/movimiento/reasignación; listado con snapshot único para página/total; composición completa SQL/Maps y actor de request para revalidación bajo lock. El dominio y contratos públicos permanecen intactos. Las transiciones existentes se evalúan en un snapshot efímero privado a la transacción; PostgreSQL conserva todo el estado autoritativo. Se escriben diferencias por lotes y se agregan eventos sin actualizar/eliminar historial. No hay caché compartida ni fallback a Maps.

### Resultados verificados

- DDL de 1/2/3 desde esquema vacío efímero dentro de is488_dev: ocho tablas y rollback confirmado, sin crear/modificar otra base. Es ensayo de esquema, no inicialización de otra base con el runner.
- Inyección 22012 tras DDL 0003: rollback confirmado y ausencia de tablas nuevas antes de aplicar.
- Runner real plan→apply→plan: 0003 y después 0004 committed, cierres confirmados, ledger [1,2,3,4], cero pendientes. SQL 0001–0003 y hashes conservados.
- Datos previos de proyectos/membresías/asignaciones: mismo hash antes/después de 0003. Las ocho tablas: mismo hash antes/después de 0004. No se borraron datos ni se importó Maps. Se conservan los fixtures identificados por la restricción de no borrar proyectos/membresías.
- **16 casos SQL distintos**: creación/edición/no-op, columnas 1/10, clamping y orden, concurrencia, filtros literales AND/paginación, permisos, ACL de historial, fallos entre estado/eventos, retiro concurrente, COMMIT/respuesta perdidos sin retry/rollback compensatorio, nueva instancia y listas ordenadas con repeticiones. Se comprobó rollback conjunto de creación, movimiento y reasignación. Se ejecutaron focalizadamente casos nuevos/fallidos; las exclusiones por filtro no se cuentan como aprobadas.
- **76 regresiones Maps/HTTP/sesión/composición**, **21 comprobaciones OpenAPI**, **un caso Maps explícito** y **dos pruebas ACL evolutivas**. No se ejecutaron suites sobre otras bases. Se reutilizó evidencia aprobada del protocolo del runner en ramas COMMIT/cierre/reconciliación no modificadas, además de los ensayos nuevos.
- Tipos API/migrador/preparación, lint, formato y build API dry-run aprobados.
- Reinicio real de PostgreSQL, Wrangler y Vite: mismo proyecto/membresías, cuatro columnas, tarea asignada/movida e historial. La última comparación conserva también los cuatro responsables con repeticiones y cinco eventos, con IDs, campos, orden, detalles y fechas exactos. Sin reconstrucción desde memoria.

### Compatibilidad resuelta

La clave (task_id,user_id) de 0003 no representaba repeticiones admitidas por Maps. Bajo autorización expresa, 0004 la sustituyó por (task_id,position) sin modificar SQL aplicado ni eliminar filas. La prueba SQL verificó creación, edición, otra instancia, historial y filtro sin multiplicar tareas. El reinicio completo confirmó orden y repeticiones exactos.

### Límites y operación

Maps continúa como alternativa explícita; postgres selecciona todos los puertos. Se leen las tareas del proyecto para evaluar transiciones: escala/latencia remota requieren medición futura; este smoke no acredita carga.

Evidencia: evidence/kanban-postgresql/migration.json, migration-0004.json, summary.json, restart-before.json, restart-after.json, repeated-restart-before.json y repeated-restart-after.json, además de las pruebas y salidas registradas. Sin recursos remotos, dependencias nuevas, ZIP, commits, push o despliegue. Contadores remotos: 143/220 y 1020/2200. No se archiva/sincroniza OpenSpec ni se declara aceptación remota.
