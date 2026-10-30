## Why

El entorno local ya conserva proyectos y membresías en PostgreSQL, pero pierde tablero, columnas, tareas e historial al reiniciar la API. Completar esa persistencia permite demostrar el recorrido académico y su integridad entre procesos, reutilizando los puertos y el migrador existentes.

## What Changes

- Añadir una migración aditiva después de la versión 2 para tablero, columnas, tareas, responsables e historial, con restricciones, índices y ACL mínimas.
- Implementar adaptadores PostgreSQL de los puertos actuales, manteniendo atómicas creación, edición, movimiento, reordenamiento y eliminación/reasignación de columnas con sus eventos.
- Conservar contratos HTTP, límites, permisos por endpoint, validación de responsables activos, orden y semántica de no-op ya definidos en boards-tasks y su cambio activo.
- Seleccionar todos los adaptadores Kanban por el modo de persistencia existente. Maps continúa disponible para las pruebas actuales; PostgreSQL no mezcla tareas o eventos en memoria.
- Añadir pruebas SQL aisladas de migraciones, operaciones, concurrencia, permisos, fallos y reinicio real de la API.

Fuera de alcance: autenticación definitiva, UI nueva, eliminación de tareas no expuesta actualmente, importación automática de Maps, ORM nuevo, servicios remotos, despliegue y operaciones Git.

## Capabilities

### New Capabilities

- `kanban-postgresql-persistence`: durabilidad SQL del Kanban con paridad de los contratos existentes.

### Modified Capabilities

- Ninguna regla de negocio o contrato público se modifica; se conservan boards-tasks y los permisos vigentes de cada endpoint.

## Impact

Cambian migraciones/ACL, adaptadores de infraestructura, composición HTTP y pruebas SQL; los puertos, casos de uso y Maps se reutilizan. No se añaden dependencias ni costos de servicio en esta planificación. Una ejecución SQL futura necesita autorización de destino/fixtures; cualquier validación remota o gasto requiere autorización independiente. Contadores remotos conservados: 143/220 solicitudes y 1020/2200 sentencias.

Estado D autorizado por el usuario: implementado en la misma rama, sin importar Maps y solo en is488_dev. 0003 y 0004 aplicadas y verificadas; datos previos conservados. Resultados en design.md. Sin actualizar main, Git de escritura o despliegue.
