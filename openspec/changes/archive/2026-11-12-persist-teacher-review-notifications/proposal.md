# Persist teacher review notifications

## Why

EPIC-006 persiste las respuestas docentes y emite un evento verificable, pero la composición actual no guarda una notificación interna. El estudiante solicitante necesita conservar la referencia a una aprobación o solicitud de cambios sin depender de la vida del proceso de API. Este primer incremento de EPIC-007 añade ese registro, no una bandeja ni entrega externa.

## What Changes

- Reutilizar `ReviewNotificationPort` para guardar una notificación interna después del commit de una respuesta docente autorizada.
- Incorporar al evento la identidad estable de la acción docente persistida, para deduplicar por respuesta y destinatario, no por revisión o estado.
- Restringir el destinatario al estudiante solicitante original con membresía activa y permiso de consulta en el mismo proyecto; volver a comprobarlo al guardar.
- Persistir metadatos mínimos en PostgreSQL mediante puertos y una migración aditiva, conservando intacta `0006_collaboration_reviews.sql`.
- Mantener la respuesta HTTP exitosa de la revisión si falla el guardado posterior de la notificación; diagnosticar sin datos sensibles y sin reintentos automáticos.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `audit-notifications-reporting`: concretar el guardado interno para respuestas docentes, los permisos, la deduplicación y los fallos. No modificar los requisitos de auditoría ni reportes.

## Impact

- Áreas previstas: contratos compartidos de revisión/notificación, caso de uso de respuesta docente, adaptadores de revisión y notificaciones, composición API, catálogo de migraciones y pruebas unitarias, SQL y HTTP.
- Sin endpoints nuevos ni cambios de cuerpos o códigos HTTP de revisiones. Sin dependencias nuevas, proveedores, colas ni despliegues.
- Valor académico: trazabilidad de cada respuesta y demostración de aislamiento, idempotencia e integridad referencial.
- Costo incremental de servicios propuesto: US$0; se reutiliza PostgreSQL. Hay consumo adicional de filas e índices dentro de las cuotas existentes, sin prometer capacidad ilimitada ni autorizar ampliaciones de pago.

## Limits and Authorization

Fuera de alcance: bandeja, lectura/marcado, UI, preferencias, correo/push, plazos, menciones, auditoría general, reportes, outbox y recuperación automática. Guardar el registro no significa entregar una notificación según preferencias. La ventana entre commit de revisión y guardado puede dejar una respuesta sin notificación: no se promete entrega garantizada.

Esta sesión autoriza únicamente planificación Nivel C. Todos los cambios ejecutables y las pruebas con efectos quedan pendientes de revisión y autorización explícita Nivel D. No se completa EPIC-007 con este incremento.
