# Incremento PostgreSQL local de EPIC-002

Maps continúa siendo el modo predeterminado. La aplicación singleton consulta `PERSISTENCE_MODE`: `memory` o `postgres`. El segundo exige configuración; los errores nunca activan Maps. En desarrollo/test, `DATABASE_URL` solo admite localhost/127.0.0.1/::1. Mantén la conexión en configuración local ignorada, sin incorporarla a Git. No hay SQL automático al arrancar.

La composición programática usa `createApp({ nodeEnv: 'test', persistence: { mode: 'postgres', connection: config } })`. No mezclar repositorios inyectados Maps con modo SQL. El futuro binding HYPERDRIVE exige autorización remota y caché de consultas deshabilitada; no está configurado ni validado aquí. dev-auth permanece limitado a development/test.

El esquema inicial está en [schema.sql](../apps/api/src/infrastructure/postgresql/schema.sql). Solo se aplicó dentro de bases nuevas exclusivas de pruebas; no aplicar sobre bases existentes. Migrador de producto con ledger, recuperación y aprobación remota pendientes. PostgreSQL mínimo 17 por transaction_timeout; evidencia local en 18.6.

Proyectos y membresías persisten en SQL. Tableros, tareas e historial Kanban siguen en memoria, compartidos por aplicación. Reiniciar pierde Kanban; cambiar el selector no migra datos ni conserva los Maps del proceso anterior. Los IDs de usuario siguen siendo textuales donde el contrato lo admite; no hay conversión a UUID ni relajación de assigneeIds.

El retiro usa `DELETE /api/projects/{projectId}/members/{userId}?membershipId={uuid}`. Sin query válida responde 400; una identidad antigua, ajena o ya retirada responde 404; el propietario activo sigue protegido con 422. Respuesta con removedAt obligatorio: null al alta y el mismo timestamp que updatedAt al retiro.

Un COMMIT sin confirmación produce error interno saneado y estado interno unknown. No reintentar automáticamente ni borrar filas. Una lectura posterior autorizada de los IDs puede observar ambos/ninguno; no demuestra por sí sola causalidad ni rollback. El cierre fallido se reporta separado del resultado confirmado.

## Reproducir pruebas locales

Se necesitan los binarios PostgreSQL instalados y un cluster nuevo de pruebas, escuchando solo en 127.0.0.1:55489. No usar el servicio ni bases existentes. Inicializar en una carpeta TEMP nueva con prefijo is488-epic002-, usuario exclusivo is488_test_admin y autenticación local de ese cluster. La prueba verifica usuario y data_directory antes de crear recursos.

Desde la raíz, con ese cluster disponible:

```powershell
$env:IS488_SQL_TEST = '1'
npm.cmd run test -w @is488/api -- src/infrastructure/postgresql
Remove-Item Env:IS488_SQL_TEST
```

Cada ejecución crea base y rol aleatorios, aplica el esquema en una transacción, otorga solo SELECT/INSERT/UPDATE y elimina únicamente esos recursos. Sin IS488_SQL_TEST=1, las pruebas SQL se muestran omitidas; eso no acredita PostgreSQL. session.test.ts son simulaciones explícitas. No se usan dependencias ni credenciales de spikes.

SEC-01 y pruebas remotas Workers/Hyperdrive/TLS/Neon siguen pendientes. Ningún spike WIP se presenta como aceptado.

## Evidencia ejecutada — 2026-10-26

Rama feature/epic-002-postgresql-projects-memberships, HEAD b0bb5db. Incremento local implementado sin commits, staging, push, despliegue, migraciones remotas ni cambios en el worktree EPIC-003. Los spikes WIP permanecen intactos.

- Pruebas afectadas API: 25 suites, 301 pruebas aprobadas, incluidas seis pruebas PostgreSQL reales, un caso Maps y siete simulaciones de sesión.
- Contratos shared: 2 suites, 17 pruebas aprobadas (membresías y actividad).
- Web afectado: 6 suites, 40 pruebas aprobadas.
- Total: 358 pruebas aprobadas. No se ejecutó una suite global del monorepo.
- Typecheck shared/API/web aprobado.
- Builds shared, API (wrangler build: dry-run, sin bindings) y frontend aprobados.
- Contrato OpenAPI verificado por sus 21 pruebas dentro de API.
- Formato de los archivos de código modificados/nuevos aprobado. Los documentos protegidos están excluidos del formateador general; no se reformateó su contenido histórico.
- OpenSpec activo validado con `openspec.cmd validate postgresql-projects-memberships --strict`.
- Build frontend conserva avisos de anotaciones PURE de Zod/Rollup, sin fallo de build.

Comandos de la ronda afectada:

```powershell
$env:IS488_SQL_TEST = '1'
npm.cmd run test -w @is488/api -- src/application/use-cases src/infrastructure/adapters/repositories/in-memory-membership.repository.test.ts src/infrastructure/adapters/repositories/in-memory-project-creation.adapter.test.ts src/infrastructure/http src/infrastructure/openapi src/infrastructure/postgresql
npm.cmd run test -w @is488/shared -- src/contracts/membership.contract.test.ts src/contracts/task-activity.contract.test.ts
npm.cmd run test -w @is488/web -- src/services/membership.service.test.ts src/components/ProjectDetail.test.tsx src/components/ProjectDetail.assignees.test.tsx src/components/ProjectMembersList.test.tsx src/components/CreateTaskModal.assignees.test.tsx src/components/EditTaskModal.assignees.test.tsx
```

La prueba real aplicó el esquema solo en bases nuevas aleatorias, con rol runtime exclusivo sin DDL/DELETE/administración. Verificó creación y lecturas Maps/SQL, timestamp único, segunda inserción fallida y rollback observado por otra sesión, constraints/FK, altas/retiros concurrentes, historia y retiro antiguo tras reincorporación, aislamiento de tres proyectos, acceso Kanban revocado y rechazo de asignación a retirados. La recreación de aplicación conservó el proyecto SQL y perdió el tablero volátil como está documentado.

Un proxy TCP local perdió deliberadamente la respuesta COMMIT; el error fue unknown y otra sesión observó ambas filas confirmadas. Esto acredita ese escenario local, no pérdida HTTP ni transporte Workers/Hyperdrive. Las simulaciones comprueban conexión única y ausencia de ROLLBACK/retry después de COMMIT incierto, rollback no confirmado y cierre fallido separado de commit confirmado.

No se ejecutó navegador/E2E ni servicios remotos. Siguen pendientes la aceptación remota, R1–R7/H1/H2, migrador productivo/ledger, SEC-01 y autenticación productiva. No se declara cerrado EPIC-002.

Al finalizar se comprobó que no quedaban bases is488_test_* ni roles is488_runtime_* y se detuvo el cluster exclusivo. Su directorio nuevo de TEMP se conserva detenido; el servicio PostgreSQL preexistente no se usó ni detuvo. Lint TypeScript acotado y formato de la guía nueva aprobados.

Corrección documental (2026-10-26): los siete casos de postgresql.sql.test.ts son seis SQL y uno Maps. Total 358 sin cambios; no se repitió el incremento por esta corrección.
