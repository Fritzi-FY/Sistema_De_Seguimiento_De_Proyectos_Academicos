# Diseño: persistencia interna de notificaciones de revisión

## Context

Base: `main` en `dd283ed7a2632cf6904387978a03b956a2e20ece`, después del merge del PR #9. Rama: `feature/epic-007-audit-reports-notifications`.

Hechos confirmados en EPIC-006:

- `RespondTeacherReviewUseCase` valida rol docente de sesión, asignación actual y proyecto; el repositorio confirma estado y acción inmutable en una transacción.
- Después del commit se comprueba la membresía activa del solicitante original y se invoca `ReviewNotificationPort`. Los fallos posteriores no revierten la revisión ni cambian su HTTP 200.
- `ReviewNotificationPayload` contiene proyecto, revisión, docente, estado y destinatarios, pero no la identidad de la acción. `recordTeacherResponse` devuelve solo la revisión.
- La composición usa una implementación sin persistencia por defecto. Hay dobles para verificar la emisión, no entrega garantizada.

Las decisiones siguientes son propuestas para revisión, no implementación ni tecnologías promovidas a definitivas. Se mantienen ADR-001, ADR-003 y ADR-007: monolito hexagonal, PostgreSQL mediante la configuración existente y lecturas de autorización sin caché obsoleta. Drizzle, Better Auth y Neon conservan su condición provisional.

## Goals / Non-Goals

Guardar un registro interno por respuesta docente confirmada y estudiante autorizado; demostrar permisos, deduplicación y fallos. No implementar consultas de bandeja, preferencias, canales externos, reportes, auditoría general ni un mecanismo de entrega garantizada.

## Decisions

### 1. Identidad de la respuesta y reutilización del puerto

Extender el resultado interno de `ReviewRepositoryPort.recordTeacherResponse` con la identidad de la acción `TEACHER_RESPONSE` creada en esa misma transacción. Actualizar los adaptadores PostgreSQL y en memoria y sus consumidores. La representación HTTP seguirá siendo la revisión actual, sin exponer un nuevo contrato público.

Añadir `responseActionId` obligatorio a `ReviewNotificationPayload` y conservar `ReviewNotificationPort.notifyReviewCompleted`. La aplicación toma esa identidad del resultado confirmado, nunca del cliente ni de una consulta posterior de la última acción. Cada ciclo de corrección produce una identidad distinta, aunque repita `CHANGES_REQUESTED`.

Se rechazan claves basadas solo en reviewId, estado o reloj: confunden respuestas diferentes o fallan ante concurrencia. La identidad correlaciona; la restricción única y las pruebas demuestran la deduplicación.

### 2. Límites entre módulos

Un adaptador de aplicación de notificaciones implementará `ReviewNotificationPort`; dependerá de un puerto de guardado interno y de una interfaz explícita para validar el contexto de la acción de revisión. El dominio no importará PostgreSQL ni frameworks. El adaptador SQL encapsulará las consultas parametrizadas y la transacción de autorización/guardado; no se harán lecturas arbitrarias de tablas desde el caso de uso.

La composición PostgreSQL reutilizará `SqlSession` y la configuración existente; el modo de pruebas en memoria tendrá un doble equivalente. Sustituir el no-op de producción, sin añadir rutas de ingreso de eventos ni confiar en `recipientUserIds` como autoridad.

### 3. Destinatario y autorización en el momento de guardar

El evento debe corresponder a una acción persistida `TEACHER_RESPONSE` con proyecto, revisión, docente y estado coincidentes. El único destinatario admisible es el solicitante original, con membresía activa y permiso de consulta de esa revisión. No se amplía a otros miembros, docentes o administradores por pertenecer al proyecto.

Revalidar el contexto dentro de la transacción de guardado. Una retirada de membresía confirmada antes de esa validación impide el registro. Serializar la comprobación con actualizaciones de membresía mediante bloqueo de fila compatible con el modelo existente (propuesta PostgreSQL: `FOR SHARE`, no solo `FOR KEY SHARE`); probar ambas ordenaciones concurrentes. Si el guardado se confirma antes de una retirada posterior, el registro no se borra automáticamente. Cualquier futura consulta deberá volver a autorizar, pero su API queda fuera de este incremento.

No volver a exigir que el docente siga asignado después de una respuesta ya confirmada: la acción histórica es la fuente del evento. Las nuevas respuestas siguen sujetas a los permisos y conflictos de EPIC-006: rol incorrecto 403, alcance ajeno 404, transición inválida 409; sin sesión 401 en HTTP. Solicitar o reenviar sigue exigiendo rol student de sesión, autoría y membresía activa.

### 4. Persistencia mínima e idempotencia

Propuesta de tabla `internal_notifications`: identificador, destinatario, proyecto, revisión, acción docente de origen, tipo de evento, estado de la respuesta y fecha de creación del servidor. No copiar observaciones, ajustes, enlaces de evidencia, correos ni secretos. Referencias y validación deben impedir combinar acción/revisión/proyecto ajenos.

Restricción única `(response_action_id, recipient_user_id)`. El mismo evento válido repetido, incluso concurrentemente, conserva una sola fila y su identidad/fecha originales. Una nueva respuesta del mismo estado conserva su propio registro. El conflicto único no debe ocultar errores de integridad distintos.

Migración aditiva siguiente disponible (actualmente 0007), catálogo/ledger y privilegios mínimos para lectura de validación e inserción; no conceder actualización o borrado por este flujo. Aplicación desde vacío y desde 0006, repetición sin cambios e integridad referencial requieren pruebas SQL reales. No modificar bytes ni SHA de 0006. Reversión operativa: volver a la composición anterior sin borrar notificaciones ni reescribir migraciones aplicadas; una eliminación de datos exigiría autorización separada.

### 5. Fallos y límites de garantía

Conservar el límite post-commit: el fallo de notificación no modifica la revisión confirmada, sus acciones ni su HTTP 200. Si falla el commit de la revisión, no invocar el puerto. Si no se pueden confirmar permisos, no insertar.

Un fallo de inserción con rollback confirmado no deja una notificación parcial. Registrar diagnóstico estructurado con etapa, identificadores de correlación y clasificación saneada del resultado; nunca cuerpos ni credenciales. Separar fallo, rollback confirmado, commit confirmado y resultado incierto. Un fallo de cierre después de commit no equivale a rollback.

Ante pérdida de confirmación de commit, no afirmar que falta la fila ni repetir automáticamente la escritura; detener nuevos efectos de ese intento y conservar diagnóstico para reconciliación autorizada. La clave única permite deduplicar una futura repetición explícita de la misma acción, pero no implementa reintentos ni garantiza que ocurra. No repetir la respuesta docente para recuperar una notificación.

Alternativa aplazada: outbox transaccional con dispatcher. Cerraría la ventana entre ambas escrituras, pero ampliaría el alcance, las garantías y la operación. Este incremento conserva deliberadamente la semántica best-effort de EPIC-006.

## Validation Strategy

- Unitarias: identidad de acción confirmada, destinatario único, permisos, dos solicitudes de cambios con identidades distintas, duplicados y fallos.
- SQL real: restricción única concurrente, aislamiento entre proyectos, integridad referencial, retirada de membresía, rollback y fallos de confirmación/cierre mediante inyección controlada.
- HTTP con la composición real: solicitud, dos ciclos de cambios y aprobación; tres notificaciones para tres respuestas, ninguna por solicitud/reenvío; estado e historial de revisión sin regresiones. Rechazos 401/403/404/409 no generan filas. Fallo de notificación mantiene HTTP 200 y revisión persistida.
- Reiniciar realmente API y PostgreSQL y comprobar que las filas conservan identidad, destinatario, origen y estado completos; sin añadir API de bandeja para probarlo. Comparar revisión por HTTP y registros por el adaptador SQL autorizado.
- SQL local únicamente tras autorización D y del entorno: `127.0.0.1:55491`, `data_directory` exacto `C:/Users/fritz/is488-db/reviews-cluster`; configuración explícita y validación antes de crear/migrar/limpiar. Mantener perfil CI aislado; excluir 5432, 55489, 55490 y respaldo de preservación. Si no está disponible, reportar bloqueo, no sustituir destino.
- Ejecutar scripts existentes de tests, lint, formato, tipos, preparación, build y OpenSpec estricto; distinguir omitidas por configuración de ejecuciones SQL reales.

## Open Questions / Gate

La revisión humana debe aceptar expresamente el alcance de almacenamiento best-effort sin outbox, la clave por acción/destinatario y la exclusión de entrega/preferencias. No hay autorización para implementar, operar PostgreSQL, crear commits ni publicar esta propuesta en esta sesión.
