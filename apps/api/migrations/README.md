# Migrador local del producto

Runner manual Node 24.18.0 y pg ya instalados. No se importa desde la API ni aplica SQL al arrancar. Solo acepta conexión directa loopback, puerto/base/usuario explícitos; no usa DATABASE_URL, Hyperdrive ni destinos remotos. No instala dependencias. PostgreSQL >=17 por transaction_timeout; ver evidencia local en 18.6.

## Preparación separada

El aprovisionamiento de base/roles es una operación independiente autorizada del administrador local, no una función de este runner. Usar una **base vacía exclusiva del producto** y dos roles LOGIN distintos: migrador propietario de esa base y runtime. Ambos NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, sin membresías de otros roles. Runtime no puede asumir migrador. Revocar TEMPORARY de la base a PUBLIC y runtime, y CREATE del esquema public a PUBLIC/runtime si existiera; migrador debe conservar CREATE en public como propietario. El runner verifica estos límites, no cambia permisos de bases ajenas. Credenciales distintas suministradas por canal local seguro, sin archivos de entorno versionados, argumentos o logs.

Variables de la sesión local: IS488_MIGRATION_HOST (127.0.0.1), IS488_MIGRATION_PORT, IS488_MIGRATION_DATABASE, IS488_MIGRATION_USER, IS488_MIGRATION_PASSWORD (por canal seguro si corresponde), IS488_RUNTIME_ROLE e IS488_MIGRATION_AUDIT (ruta persistente a JSONL en directorio existente y privado). No imprimir estas variables. Quitar la contraseña de la sesión al finalizar. El rol runtime usa su propia configuración DATABASE_URL en la API; nunca la credencial migradora.

Desde raíz, ejecutar por separado, tras revisar el plan y con autorización de aplicación:

```powershell
npm.cmd run migrate:plan -w @is488/api
npm.cmd run migrate:apply -w @is488/api
npm.cmd run migrate:reconcile -w @is488/api
```

Plan toma el mismo lock de sesión y consulta el catálogo, sin crear ledger ni DDL. Apply no provisiona roles, base ni baseline. Bases con objetos de usuario sin ledger se rechazan; adoptar una base existente necesita inspección y propuesta/aprobación separadas, no hay bandera de bypass. Esquema negocio public, ledger is488_migrations.versions privado, search_path pg_catalog,public. Runtime solo recibe SELECT/INSERT/UPDATE en projects/project_memberships; no defaults generales. Se neutralizan ACL heredadas por defaults en el ledger y se verifica acceso efectivo antes de commit; roles asumibles se rechazan.

## Versiones y recuperación

manifest.json lista versiones consecutivas desde 1 con nombre y SHA-256 de bytes exactos. SQL aplicado no se edita; cambios mediante nueva versión revisada. .gitattributes evita conversión Git de saltos de línea de SQL. El runner admite solo SQL transaccional revisado, sin bloques procedurales, control de transacciones, DDL concurrente ni cambios de roles/esquemas. No es un parser SQL general ni un sandbox frente a un autor malicioso; requiere revisión del SQL. La versión inicial califica tablas/FK con public. Ledger/checksum y fingerprint estructural de public detectan historial desconocido/alterado y cambios en tablas/columnas/constraints/índices; no certifican contenido de filas ni son auditoría general de toda la base.

DDL y fila de ledger se confirman en una transacción por versión; ledger inicial se crea en la primera. Sesión dedicada con lock (488,2002), compartido por plan/apply/reconcile dentro de la misma base. Espera de lock 2 s, sentencias 5 s, consulta cliente 6 s, conexión 3 s, transacción 15 s, cierre 1.5 s. Timeout cliente/cierre no prueba fin del servidor; la reconciliación debe adquirir el mismo lock. Cierre se registra separado de COMMIT confirmado.

Se conserva evidencia JSONL saneada con fsync antes de BEGIN y COMMIT; si falla no se despacha el siguiente efecto. No contiene contraseñas, URLs, SQL ni respuestas de datos. Mantener la misma ruta y archivo de auditoría para el destino; no borrarlo, truncarlo ni cambiarlo para eludir una incertidumbre. Es evidencia local, no una garantía ante manipulación del operador. Un fallo de auditoría después de COMMIT confirmado detiene con confirmed_commit_audit_failed, sin compensar el commit.

COMMIT sin respuesta: commit_unknown detiene el lote, sin retry, rollback compensatorio ni versiones siguientes. Reconcile abre otra sesión y adquiere el mismo lock, valida ledger/checksum/fingerprint y solo observa. reconciled_applied permite que un **nuevo comando manual** considere versiones futuras; no atribuye causalidad al intento. reconciled_absent no autoriza reaplicar: apply sigue bloqueado, requiere revisión y recuperación aprobadas fuera de este comando. Nunca editar/borrar el ledger o el audit para maquillar el estado. La restauración o forward-fix son acciones independientes, con evidencia y autorización.

## Pruebas exclusivas

IS488_MIGRATOR_TEST=1 habilita las nuevas pruebas; sin la variable se omiten y no acreditan PostgreSQL. Exigen cluster nuevo exclusivo en 127.0.0.1:55490, usuario is488_migration_admin y data_directory igual a IS488_MIGRATION_TEST_DIR con prefijo TEMP/is488-migrator-. Nunca usar el servicio PostgreSQL existente. IS488_MIGRATION_TEST_EVIDENCE indica un directorio existente para conservar auditorías saneadas.

```powershell
npm.cmd run test:migrations -w @is488/api
npm.cmd run test -w @is488/api -- migrations/adapters.test.ts
npm.cmd run typecheck:migrations -w @is488/api
```

Las pruebas crean bases y roles aleatorios y eliminan exclusivamente sus propios recursos. Los catálogos de evolución/fallo son fixtures temporales; no modifican migraciones del producto ni spikes. La limpieza de fixtures no borra las auditorías copiadas al directorio de evidencia. Las pruebas TCP prueban transporte PostgreSQL local, no Workers/Hyperdrive/HTTP. Ver informe de ejecución en evidence/postgresql-migrator-local/README.md desde la raíz del repositorio.
