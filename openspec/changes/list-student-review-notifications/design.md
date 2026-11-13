# Diseño: consulta y bandeja estudiantil de revisiones

## Context

Base verificada: `origin/main` y HEAD en `f075647b3f4c1a1e32fa5e309d3decf5b1908fd2`. La rama `feature/epic-007-audit-reports-notifications` se actualizó mediante fast-forward con árbol limpio y ambos stashes conservados. El primer incremento está archivado en `openspec/changes/archive/2026-11-12-persist-teacher-review-notifications/`.

Hechos del código actual:

- 0007 guarda `id`, `recipient_user_id`, `project_id`, `review_id`, `response_action_id`, `reviewer_id`, `response_status`, `actor_role`, `action_type`, `kind` y `created_at timestamptz`. El reloj SQL puede producir microsegundos.
- Las referencias compuestas enlazan al solicitante original y a la acción docente inmutable; la unicidad es por acción y destinatario. El rol runtime tiene SELECT/INSERT, no UPDATE/DELETE sobre notificaciones.
- `ReviewNotificationPort` es un puerto de emisión post-commit, no de lectura. `PostgresqlInternalReviewNotificationRepository` valida el origen al guardar. El equivalente en memoria conserva identificador y fecha.
- El permiso estudiantil de consulta de revisión exige ser solicitante original con membresía activa; ser creador del proyecto o colaborador de otra revisión no lo sustituye. La asignación docente habilita otra vía de consulta de revisiones, pero no la bandeja estudiantil.
- Existen autenticación middleware, `SqlSession` y composición por modo de persistencia, `apiFetch` con cookies y pruebas Vitest/Testing Library. No hay endpoint ni vista de bandeja; no se asume una pantalla de detalle de revisión existente.

Las decisiones siguientes son propuestas, no funcionalidad implementada. Se mantienen ADR-001, ADR-003 y ADR-007. Drizzle, Better Auth y Neon no cambian de condición provisional.

## Goals / Non-Goals

Consultar registros ya guardados desde una bandeja estudiantil, con permisos vigentes y páginas acotadas deterministas. Sin escrituras de negocio, migraciones nuevas, nuevas dependencias, canales externos, estado de lectura ni cambios en la emisión best-effort.

## Decisions

### 1. Puerto de lectura independiente

Proponer `ReviewNotificationReaderPort` y `ListStudentReviewNotificationsUseCase`. El caso de uso recibe la identidad y el rol desde el contexto autenticado, exige `student` y llama al puerto con ese userId y una posición validada. No reutilizar `notifyReviewCompleted` para consultar, ni emitir eventos o reparar notificaciones durante la lectura.

El contrato del puerto obliga a devolver únicamente filas del destinatario autorizado en ese instante, aplicando alcance antes del límite. Implementaciones PostgreSQL y en memoria equivalentes; la composición reutiliza los mismos registros que escribe el adaptador existente, no un almacén de lectura independiente que quede vacío. Dominio/aplicación no dependen de Hono, React ni PostgreSQL.

### 2. Revalidación en cada página

El adaptador SQL ejecuta una consulta parametrizada cuya relación autorizada incluye:

- `n.recipient_user_id = session.userId` y `n.kind = 'TEACHER_REVIEW_COMPLETED'`.
- Revisión cuyo id/proyecto coinciden con la notificación y cuyo `requester_id` es ese mismo usuario.
- `EXISTS` de membresía para ese usuario/proyecto con `status = 'active'`.

Sobre esa relación se aplican posición, orden y límite. No obtener primero una página global para filtrarla después; no usar una lista de proyectos previamente autorizada, la condición de creador ni una asignación docente como sustituto. No aplicar N consultas de autorización después de paginar. La implementación en memoria aplica la misma secuencia lógica.

Una retirada confirmada antes de la instantánea de la consulta excluye las filas del proyecto, incluso usando un cursor emitido cuando había acceso. Si quedan otros proyectos autorizados, sus filas pueden completar la página; sin resultados se devuelve 200 con lista vacía. El registro no se elimina. Si vuelve a existir membresía activa, los registros históricos vuelven a ser elegibles en nuevas consultas; no se promete que aparezcan antes de un cursor ya avanzado.

Cada consulta usa su propia instantánea PostgreSQL: no hay snapshot global entre páginas ni garantía de borrar información ya entregada. Si una retirada confirma después de la instantánea de lectura, no se atribuye retroactivamente a esa lectura; la siguiente petición revalida. No introducir bloqueos de escritura para una bandeja de solo lectura.

La autorización no se satisface mediante caché obsoleta de cliente/CDN/lecturas de base. Reutilizar la configuración existente sin caché de consultas para este camino; no declarar verificada una integración Hyperdrive remota por una ejecución local. Si no se puede confirmar acceso o consultar filas, fallar cerrado con 500 saneado, no con una página parcial ni con un falso vacío.

No volver a exigir que el docente de una acción histórica siga asignado actualmente. El estado mostrado es `response_status` de esa notificación, no el estado actual de la revisión.

### 3. Contrato HTTP mínimo

Ruta propuesta: `GET /api/review-notifications`. Query estricta: solo `limit` entero entre 1 y 100 (20 por defecto) y `cursor` opcional. Rechazar parámetros de selección de usuario/proyecto y entradas desconocidas con 400; no se aceptan identidades de headers de desarrollo en el modo autenticado real.

Respuesta 200: `{ items, nextCursor }`. Cada item contiene exclusivamente `id`, `projectId`, `reviewId`, `responseActionId`, `status` (`APPROVED` o `CHANGES_REQUESTED`) y `createdAt` UTC con seis decimales. No añadir destinatario, correo, observaciones, ajustes, evidencias, cuerpos arbitrarios ni un título duplicado. No se añade contador total. El siguiente cursor es una posición, no una credencial ni prueba de existencia de una fila.

Casos de respuesta:

- 401 sin sesión válida, reutilizando el middleware.
- 403 con sesión no `student`, incluso si coincide el userId histórico o tiene membresía activa.
- 400 para query/cursor inválidos con sesión estudiantil.
- 200 para una página autorizada o vacía; `nextCursor: null` si no hay otra fila autorizada en esa consulta.
- 500 saneado ante fallo de consulta/validación del resultado; sin devolver contenido parcial ni detalles SQL.

Todas las respuestas de la ruta son privadas con `Cache-Control: no-store`. La ruta y sus esquemas se documentarán en OpenAPI. El endpoint existente de detalle de revisión no cambia y conserva sus rechazos 404 por recurso ajeno; este incremento no crea un endpoint de detalle de notificación.

### 4. Orden, cursor y precisión

Orden total: `created_at DESC, id DESC`; el UUID desempata fechas idénticas. Es orden de creación de notificación, no orden de secuencia del historial docente. La deduplicación de 0007 se conserva: dos respuestas distintas del mismo estado siguen siendo dos items.

Cursor v1 propuesto: base64url de JSON UTF-8 `{ v: 1, createdAt, id }`, máximo 256 caracteres codificados. Validar versión, claves exactas, UUID, fecha calendárica real y timestamp canónico `YYYY-MM-DDTHH:mm:ss.ffffffZ`. Rechazar truncamientos, otros formatos, zonas no canónicas, tamaños excesivos y valores no finitos. No contiene userId ni se firma como token de autorización: alterar una posición válida no puede alterar el filtro del destinatario/membresía. No buscar ni autorizar la fila del cursor; puede pertenecer a un proyecto cuyo acceso se retiró, a otro usuario o no existir.

La página siguiente compara `(n.created_at, n.id) < ($createdAt::timestamptz, $id::uuid)` sobre las filas autorizadas. Consultar hasta `limit + 1`; devolver como máximo `limit` y emitir cursor del último item devuelto solo si el lookahead autorizado confirma otro. No emitir como cursor la fila descartada de lookahead ni inferir continuidad de filas ajenas.

No pasar por `Date`, `Date.toISOString()` ni epoch en milisegundos al construir, validar la posición, comparar o transportar el cursor. Proyección local SQL propuesta: `to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, evitando el parser por defecto de `pg` que materializa timestamps como Date. Enviar la cadena completa como parámetro al comparar; no modificar parsers globales que afecten otros adaptadores.

En memoria, normalizar las fechas de reloj existentes a UTC/seis decimales sin perder fracciones disponibles (rellenar ceros si la fuente solo tiene milisegundos); comparar cadenas canónicas y UUID canónicos de forma equivalente a PostgreSQL. Semillas SQL con `.123100Z` y `.123900Z`, y UUID en orden opuesto, deben detectar cualquier pérdida de precisión entre páginas. La UI puede formatear la fecha para mostrarla, pero usa `nextCursor` literalmente, sin reconstruirlo a partir de la fecha visible.

La paginación es viva: nuevas filas anteriores al cursor se ven al actualizar desde el inicio; cambios de acceso afectan cada página. No se promete un snapshot de todas las notificaciones ni una exportación completa consistente bajo inserciones concurrentes.

### 5. Vista de solo lectura

Integrar una entrada Notificaciones para el estudiante en AppShell y un servicio que reutilice `apiFetch`/cookies. Ocultarla a otros roles no sustituye el rechazo del servidor. Reutilizar estilos y componentes presentes, sin dependencias nuevas ni rediseño del shell.

Una página visible por vez: mensaje fijo de aprobación/cambios solicitados, fecha y referencias textuales de proyecto y revisión. Sin observaciones inventadas ni enlaces hacia pantallas de detalle no implementadas. Incluir carga, vacío, error y acciones Actualizar, Siguiente y Reintentar. Controles accesibles por teclado, estados anunciados y vista sin desbordamiento en móvil.

No acumular páginas mediante un listado infinito: conservar la primera página al avanzar podría dejar visibles filas cuyo acceso se retiró entre peticiones. Al solicitar otra página, actualizar o recuperar foco de la vista, limpiar la página previa y volver a consultar; al recuperar foco/actualizar se vuelve al inicio. No conservar páginas en localStorage ni mostrar datos viejos durante errores.

Al salir, cerrar sesión, cambiar usuario/rol o recibir 401/403, limpiar items y cursores y cancelar/ignorar respuestas pendientes mediante identidad/generación de solicitud. Una respuesta vieja no puede repoblar la vista de una nueva sesión. No hay detección en tiempo real de cambios de membresía externos: los datos ya recibidos pueden verse hasta la siguiente revalidación; no prometer revocación retroactiva.

### 6. Integridad, costos y reversión

No cambiar columnas, restricciones, manifiesto ni hashes de 0006/0007. La consulta no requiere privilegios adicionales ni modifica notificaciones/revisiones/membresías. La comprobación de identidad/sesión existente puede tener efectos propios ajenos a estas tablas; no se promete que toda autenticación sea una operación SQL sin escrituras.

No se propone migración de índice en este mínimo. El límite acota la respuesta, no garantiza que PostgreSQL no recorra filas; medir antes de ampliar índices/infraestructura. Reutilizar deadlines de sesión y consultas, sin nuevas dependencias ni servicios.

Reversión futura: retirar mediante cambio inverso revisado la nueva ruta y la entrada/vista, conservando registros, emisión, restricciones y migraciones aplicadas. No borrar notificaciones ni reparar faltantes. Cualquier commit, publicación, archivo, merge o despliegue requiere autorización separada.

## Validation Strategy

- Contratos/unitarias: rol, identidad, metadatos mínimos, límites, cursor inválido/ajeno/inexistente, precisión microsegundo, empate UUID, lookahead y fallo cerrado.
- PostgreSQL real: filas mixtas de varios destinatarios/proyectos, filtro previo a límite, retirada antes de consulta/entre páginas, instantáneas concurrentes documentadas, readmisión, dos correcciones y aprobación históricas, ausencia de escrituras y fallo de lectura sin parcialidad. Repetir equivalentes en memoria, sin fingir que acreditan SQL.
- HTTP/OpenAPI: 200/400/401/403/500, no-store, sesión real del middleware frente a headers falsificados, composición de ambos modos y contratos de revisiones sin cambios. No presentar sesiones sintéticas de pruebas como OAuth institucional validado.
- Web: servicio, renderizado/estados, teclado, reemplazo de página, foco, cambio de identidad, respuesta tardía y limpieza ante errores. Recorrido integral de navegador con API/SQL en el entorno autorizado durante D; no llamar E2E automatizado a una prueba DOM con mocks ni instalar herramientas nuevas por inferencia.
- SQL local futuro: solo con autorización D y del entorno, variables explícitas en la sesión para `127.0.0.1:55491` y coincidencia exacta de `data_directory = C:/Users/fritz/is488-db/reviews-cluster` antes de crear/migrar/limpiar fixtures nuevos. Sin valores locales por defecto en suites compartidas; si se reinicia, `IS488_SQL_PG_CTL` explícito y código final confirmado. Excluir 5432, 55489, 55490 y respaldo de preservación. No hay ejecución SQL en C.
- Registrar pruebas aprobadas/fallidas/omitidas y cobertura real por separado. El gate SQL actual no cubre todas las suites existentes; no modificar pipeline ni atribuir cobertura nueva a CI por este plan. Repetir lint, formato, tipos, preparación, build, suites pertinentes y OpenSpec estricto durante D.

## Gate

Revisar el endpoint, cursor v1 sin carácter de autorización, tamaño de página, alcance de la UI y semántica de revocación por petición. Ninguna decisión de este diseño concede Nivel D. No hay implementación, SQL, instalación, commit ni publicación autorizados en esta sesión.

Actualización humana del 2026-11-12: propuesta aprobada; Nivel D concedido solo al bloque 2 (contratos, puerto, cursor y caso de uso, con pruebas), más un commit documental separado de los cuatro artefactos. La autorización no se extiende a adaptadores, composición/rutas HTTP, OpenAPI, web, SQL ni publicación. La aprobación posterior sustituye la compuerta pendiente para ese bloque, sin alterar los requisitos ni las decisiones aprobadas.
