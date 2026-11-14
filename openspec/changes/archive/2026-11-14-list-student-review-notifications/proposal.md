# Bandeja estudiantil de notificaciones de revisión

## Why

El primer incremento de EPIC-007 ya guarda notificaciones internas de respuestas docentes, pero no ofrece una consulta ni una bandeja en la aplicación. El estudiante necesita consultar sus aprobaciones y solicitudes de cambios sin confundir la existencia histórica del registro con un permiso de acceso vigente.

Valor académico: demostrar autorización contextual en cada lectura, paginación determinista sin perder microsegundos y separación hexagonal entre almacenamiento, consulta HTTP y presentación.

## What Changes

- Añadir una consulta de solo lectura para la sesión con rol `student`, sin aceptar un destinatario elegido por el cliente.
- Reutilizar exclusivamente los registros de `internal_notifications` creados por 0007. Filtrar destinatario, solicitante original y membresía activa del proyecto antes de paginar, en cada petición.
- Ordenar por `created_at DESC, id DESC`, mediante cursor opaco de posición con timestamp UTC de seis decimales, sin convertirlo a `Date` ni recortarlo a milisegundos.
- Proponer `GET /api/review-notifications?limit=20&cursor=...`, con respuesta `{ items, nextCursor }`, esquemas Zod y documentación OpenAPI.
- Añadir una vista estudiantil mínima con una página visible, mensajes de estado histórico, fecha y referencias de proyecto/revisión; estados de carga, vacío y error, y acciones Actualizar/Siguiente/Reintentar.
- Revalidar permisos al cambiar de página o actualizar; conservar los registros retirados del alcance sin mostrarlos ni borrarlos. No reutilizar páginas como autorización ni mostrar respuestas tardías de otra sesión.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `audit-notifications-reporting`: añadir el requisito `Student review notification inbox`. No modificar los requisitos canónicos de auditoría, persistencia interna ni reportes; la exclusión de una bandeja en el primer incremento no impide este incremento explícito de consulta.

## Impact

- Áreas previstas para una implementación futura: puerto de lectura compartido, caso de uso de listado, adaptadores PostgreSQL/en memoria, composición API, ruta y contratos, servicio web y vista integrada en AppShell, con sus pruebas.
- No modificar bytes, hashes ni manifiesto de las migraciones 0006/0007. No se necesitan nuevas columnas, permisos de escritura ni migraciones para la consulta mínima. Un índice adicional requerirá evidencia y revisión separadas; no se promete rendimiento sin medición.
- No añadir dependencias ni servicios. Costo incremental de servicios propuesto: US$0, reutilizando la infraestructura existente; las lecturas consumen recursos y cuotas PostgreSQL, sin promesa de capacidad ilimitada.
- Fuera de alcance: marcar leído, contadores de no leídas, borrado, preferencias, correo/push, entrega garantizada, outbox, reparación/reintentos de notificaciones, auditoría general, reportes y una pantalla nueva de detalle de revisión.
- La lectura no cambia el guardado best-effort: una respuesta docente puede no tener notificación. No se reconstruyen ni completan registros faltantes al consultar.

## Authorization

Sesión de planificación Nivel C. La implementación, operación SQL, instalaciones, commits, publicación, PR, archivo, merge y despliegue no están autorizados por esta propuesta. Tras validar los cuatro artefactos, detenerse para revisión humana y autorización Nivel D explícita por bloque.

### Aprobación posterior — 2026-11-12

El usuario aprobó `list-student-review-notifications` y autorizó Nivel D exclusivamente para contratos, puerto de consulta, codec de cursor y caso de uso (tareas 2.1–2.3), con sus pruebas y validaciones. Autorizó guardar estos cuatro artefactos en un commit documental separado antes de implementar, partiendo de `f075647b3f4c1a1e32fa5e309d3decf5b1908fd2`. No se autoriza implementar adaptadores, rutas/API/OpenAPI, UI ni operar SQL; el código del bloque 2 se entrega sin commit ni publicación para revisión local. Ambos stashes y hashes 0006/0007 deben conservarse.
