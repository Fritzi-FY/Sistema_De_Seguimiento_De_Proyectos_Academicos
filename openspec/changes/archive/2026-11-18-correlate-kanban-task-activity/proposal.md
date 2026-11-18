# Correlación de la actividad de tareas Kanban

## Why

El requisito canónico [Audit relevant changes](../../specs/audit-notifications-reporting/spec.md) exige actor, acción, recurso, fecha y correlación cuando esté disponible. Kanban ya registra los primeros cuatro datos en `task_activity` al crear, editar, mover y reasignar tareas por eliminación de una columna. No existe un campo ni un recorrido HTTP → caso de uso → puerto → persistencia que conserve una correlación disponible en la petición.

Valor académico: completar la trazabilidad entre una operación y sus eventos sin duplicar el historial existente, debilitar sus transacciones ni confundir correlación con autorización o idempotencia. El [diagnóstico por campo, operación y prueba](design.md) distingue cobertura inspeccionada de ejecución empírica.

## What Changes

- Transportar `correlationId` opcional en las operaciones existentes que generan `CREATED`, `UPDATED`, `MOVED` y `COLUMN_DELETED_REALLOCATION`.
- Proponer `X-Correlation-ID` como entrada HTTP opcional, admitiendo únicamente un UUID textual válido de 36 caracteres y normalizándolo a minúsculas antes de propagarlo. Omitir valores ausentes o inválidos, sin copiar el valor rechazado a eventos, errores o logs ni generar uno cuando falte.
- Guardar la correlación en el mismo evento y límite atómico que la mutación. Todos los eventos de una reasignación de columna comparten la correlación de esa operación y conservan identidades de evento distintas.
- Incorporar el campo opcional al contrato del historial autorizado y a OpenAPI; conservar respuestas históricas que no tengan correlación.
- Añadir una migración posterior a 0007 para una columna UUID nullable, sin reescribir migraciones, eventos ni fechas existentes.
- Probar propagación, ausencia, entrada inválida, aislamiento, no-op, rollback y conservación tras lectura SQL.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `audit-notifications-reporting`: precisar exclusivamente la correlación opcional de la actividad Kanban dentro de `Audit relevant changes`, conservando el escenario canónico existente.

## Impact

- Implementación futura: tipos/contratos compartidos, comandos y puertos atómicos Kanban, adaptadores en memoria/PostgreSQL, rutas de tareas y eliminación de columnas, contrato OpenAPI, nueva migración/manifiesto y pruebas asociadas. El detalle de archivos está en [design.md](design.md).
- No se necesita una segunda tabla `audit_events`, un servicio de auditoría general, dependencias nuevas, índices de búsqueda por correlación ni cambios de frontend.
- Costo incremental de servicios propuesto: US$0, reutilizando PostgreSQL. Un UUID opcional por evento añade almacenamiento y transferencia según uso; no se promete capacidad ilimitada ni se contratan recursos.
- La eliminación de tareas no tiene caso de uso, ruta ni UI actuales. `DELETED` está declarado, y el repositorio ofrece borrado interno sin evento; esto no acredita el escenario de eliminación por usuario. Este incremento no diseña permisos ni un flujo DELETE nuevo y no declara completo ese escenario. Véase el límite en [design.md](design.md).
- Fuera de alcance: notificaciones, reportes, comentarios, auditoría general de otras entidades, logging global de requests, trazas distribuidas, idempotencia, eliminación de tareas y cambios de permisos.

## Authorization

Planificación Nivel C solicitada el 2026-11-14 en `feature/epic-007-audit-reports-notifications`, actualizada mediante el `--ff-only` autorizado a `8dbf8b4e495d5e9d16789ce2e03842b53bd41e5d`. Solo se crean estos cuatro artefactos OpenSpec. Implementación, operaciones SQL, instalaciones, commits, publicación, PR, archivo, merge de esta propuesta y despliegue requieren autorización independiente. La revisión de C no concede Nivel D.

### Aprobación posterior — 2026-11-14

El usuario aprobó Nivel C de `correlate-kanban-task-activity` y autorizó Nivel D para el primer bloque de contratos y propagación al crear, editar y mover tareas existentes, con sus pruebas y validación OpenSpec estricta. Autorizó un commit documental separado de estos cuatro artefactos antes de implementar, desde `8dbf8b4e495d5e9d16789ce2e03842b53bd41e5d`, y entregar después el código sin commit para revisión local. Se limita el bloque 2 a esas tres operaciones y se separa la reasignación de columnas en 2.4, pendiente de autorización D. No se autorizan migraciones/operaciones SQL, HTTP/OpenAPI, nuevas dependencias, publicación ni archivo en este bloque. Ambos stashes y los 12 archivos de evidencia se conservan.
