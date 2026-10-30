# Desarrollo integrado local: frontend, API y PostgreSQL

El entorno está preparado en la carpeta principal `C:\Users\fritz\Sistema_De_Seguimiento_De_Proyectos_Academicos`, conservando la rama `feature/epic-002-postgresql-projects-memberships` y los cambios locales. No reemplaza el comando `npm run dev` anterior: se agrega un arranque explícito para el modo SQL local.

## Uso diario

Desde PowerShell normal:

```powershell
cd C:\Users\fritz\Sistema_De_Seguimiento_De_Proyectos_Academicos
npm.cmd run dev:local
```

Frontend: **http://127.0.0.1:5173**. API: http://127.0.0.1:8787. Ambos escuchan solo en loopback; Vite envía `/api` al Worker local. No hay despliegue, bindings remotos ni autenticación Cloudflare requeridos para este recorrido.

El comando mantiene frontend y API en ejecución. Para detenerlos, pulsa **Ctrl+C** en esa terminal, o desde otra terminal de la carpeta principal:

```powershell
npm.cmd run dev:local:stop
```

La parada termina únicamente los hijos de este arranque y detiene el cluster exclusivo cuando no quedan otras sesiones cliente. Conserva base, roles, datos y evidencia. Si detecta otras sesiones, conserva PostgreSQL encendido y lo indica; no termina sesiones ajenas.

Otros comandos:

```powershell
npm.cmd run dev:local:status
npm.cmd run dev:local:verify
```

`verify` recorre el sistema real a través de Vite: crea o reutiliza el proyecto sintético, agrega al colaborador si falta, crea una tarea nueva, la asigna y consulta el historial. Comprueba con una conexión SQL runtime independiente el proyecto y las dos membresías. Cada ejecución agrega una tarea de demostración; no reintenta mutaciones automáticamente. Una escritura cuyo resultado no se pudo confirmar deja `.local-dev/mutation-pending.json` y bloquea otras escrituras del verificador hasta revisión. No borrar ese archivo para ocultar incertidumbre.

## Inicialización y migraciones

Ya se ejecutó la inicialización autorizada. Para comprobar o preparar otra vez **este mismo entorno**, sin recrear sus datos:

```powershell
npm.cmd run dev:local:init
```

El comando reconoce el manifiesto local y valida el ledger. Si encuentra nombres preexistentes sin manifiesto propio, se detiene sin adoptarlos ni modificarlos. Una inicialización incompleta también exige revisión; no recrea automáticamente recursos.

Las nuevas migraciones revisadas se aplican mediante un comando manual independiente:

```powershell
npm.cmd run dev:local:migrate
```

El inicio ordinario comprueba que no haya migraciones pendientes y no ejecuta DDL. El migrador existente mantiene catálogo/checksums, lock, auditoría y bloqueo ante resultado incierto. Un COMMIT incierto no se reintenta.

## Destino aislado y datos

El usuario autorizó expresamente estos tres recursos nuevos:

- Base `is488_dev`.
- Rol migrador `is488_dev_migrator`.
- Rol runtime `is488_dev_runtime`.

Se alojan solo en el cluster exclusivo previamente existente: `127.0.0.1:55490`, directorio `%LOCALAPPDATA%\Temp\is488-migrator-d5974a0c7b7444ff9f9d85079bc86898`. Se comprobaron administrador sintético, puerto y directorio antes de inicializar. El script usa el PostgreSQL 18 instalado en `C:\Program Files\PostgreSQL\18\bin`. No instala paquetes ni inicializa otro cluster, y falla si ese directorio no existe. No usa el servicio PostgreSQL preexistente ni el puerto 55489.

Se reutilizaron las migraciones 1 y 2 y se aplicaron 0003 y 0004 con el migrador existente. Los adaptadores PostgreSQL cubren proyectos, membresías, alcance docente y Kanban completo. Los dos roles locales carecen de privilegios administrativos; runtime tiene permisos mínimos por tabla, incluido DELETE solo para columnas y asignaciones cuando lo requieren sus operaciones, sin DDL, ownership ni acceso al ledger. Actividad es append-only: runtime no puede UPDATE ni DELETE. El cluster local usa autenticación de confianza en loopback, por lo que la URI sintética no contiene contraseña. No sirve como configuración productiva.

El frontend utiliza su identidad sintética existente:

| Actor       | ID                                     |
| ----------- | -------------------------------------- |
| Propietario | `11111111-1111-4111-8111-111111111111` |
| Colaborador | `22222222-2222-4222-8222-222222222222` |

Entra al proyecto **Desarrollo local IS488** desde la lista. Contiene un colaborador y una tarea asignada con historial. El encabezado `X-Dev-User-Id` es simulación local, no autenticación académica.

**En modo postgres, Kanban es durable:** tablero, columnas, tareas, responsables e historial sobreviven al reinicio de la API y de PostgreSQL. Maps permanece como alternativa explícita para pruebas; no se importa su estado automáticamente. El entorno local selecciona PostgreSQL para todos los puertos. La migración correctiva 0004, autorizada por el usuario, conserva el orden y las repeticiones de responsables admitidas por los contratos actuales, sin modificar 0003 ni borrar datos. No hace falta ejecutar `verify` para reconstruir tareas después de reiniciar; ese comando crea una tarea adicional solo cuando se solicita una nueva demostración.

El estado, los logs y el manifiesto viven en `.local-dev/`, excluido de Git. No borrar el manifiesto ni la auditoría como mecanismo de recuperación: no se adoptan silenciosamente bases existentes ni se borra evidencia de operaciones inciertas.

## Verificación realizada

Se comprobó por HTTP real el HTML y el módulo de entrada del frontend, el proxy Vite, Worker local, proyecto, alta de miembro, creación de tarea, asignación e historial; SQL independiente confirmó dos miembros activos y el creador esperado. No se operó el navegador ni se afirma una prueba visual/E2E de clics.

Después de aplicar 0003 y 0004 y detener/reiniciar PostgreSQL, Wrangler y Vite, se observaron exactamente el mismo proyecto y membresías, cuatro columnas, tarea asignada/movida e historial. La comprobación final conservó también la lista ordenada de cuatro responsables con repeticiones y los cinco eventos, incluyendo IDs, campos, colores/categorías, orden, detalles y fechas. No se reconstruyó estado desde memoria.

Evidencia actual: [migración 0003](../evidence/kanban-postgresql/migration.json), [migración 0004 y conservación de las ocho tablas](../evidence/kanban-postgresql/migration-0004.json), [reinicio inicial](../evidence/kanban-postgresql/restart-after.json) y [reinicio con responsables repetidos](../evidence/kanban-postgresql/repeated-restart-after.json). Se verificaron 16 casos SQL distintos, dos pruebas ACL, 76 regresiones Maps/HTTP/sesión/composición, 21 comprobaciones OpenAPI y un caso Maps explícito. Los casos nuevos o fallidos se ejecutaron focalizadamente; las exclusiones por filtro no se cuentan como aprobadas. Tipos, lint, formato y build API dry-run aprobados. No se ejecutaron suites que crean otras bases. El estado anterior volátil se conserva como histórico en `evidence/local-development/`.

## Pendientes reales para despliegue

- Autenticación académica definitiva y comprobación institucional; las cabeceras de desarrollo y los actores sintéticos de Access no la sustituyen. Sigue pendiente la fuente institucional para asignaciones docentes.
- Aceptación remota del recorrido funcional con el migrador corregido: Workers, Hyperdrive con TLS/cache configurados, Access/JWT, aislamiento y persistencia entre A/B. Run4 no alcanzó HTTP de producto y no se inició run5.
- Validar configuración productiva, secretos, cuotas/costos y controles operativos; CI y autorización humana para integrar/desplegar siguen pendientes. Este arranque local no los acredita.
- La eliminación manual del proyecto Neon de run4 sigue pendiente de confirmación humana; este trabajo no lo consultó ni modificó.

No hubo recursos ni consultas remotas nuevas, ZIP, commits, push o despliegue. Los contadores remotos siguen en **143/220 solicitudes y 1020/2200 sentencias**; la actividad local no los reinicia ni consume.
