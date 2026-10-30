> Estado D local (sesión 2026-10-26–27): D-P y D-S autorizados posteriormente por el usuario e implementados/verificados en el worktree existente, sin crear ramas, mover cambios ni Git de escritura. La evidencia de preparación y SQL local no acepta cloud ni cierra EPIC-002. Recursos/SQL remoto/E siguen pendientes. Los textos de C anteriores se conservan como historial de planificación.
## Why

SEC-01: ListProjectsUseCase devuelve findAll() para teacher y GetProjectByIdUseCase (mismo archivo) acepta teacher como rol elevado sin asignación. Identidad auténtica no evita exposición de listado/metadatos/detalle ajenos. Esto contradice Teacher scope de projects-teams. Valor académico: demostrar autorización por relación/alcance en servidor, independiente del adaptador de persistencia y autenticación.

## What Changes

Política aprobada expresamente por el usuario el 2026-10-26, Nivel C:

- teacher no concede acceso global.
- Asignación docente explícita permite consultar/revisar el proyecto asignado; no concede gestión de integrantes ni otras mutaciones por inferencia.
- Docente creador/colaborador conserva permisos existentes de esa relación.
- Listados filtrados en servidor; detalle ajeno 404; sin relación autorizada se deniega.
- Ningún rol enviado por cliente concede privilegios.
- Asignaciones mantenidas por operador autorizado, sin autoconcesión. Fuente institucional definitiva pendiente.

Introducir puerto de consulta de asignaciones y adaptadores en memoria/PostgreSQL. Listado: unión deduplicada de proyectos propios, membresías activas y asignaciones explícitas docentes. Detalle: propiedad/membresía existente, o asignación docente explícita; ajeno 404. No ampliar políticas de mutación, miembros, Kanban o permisos administrativos. La asignación no sustituye ni revoca la propiedad/membresía; retirar membresía no elimina una asignación independiente.

## Capabilities

### Modified Capabilities

- projects-teams: Teacher scope, conservando vías de autorización por relación y cerrando bypass global.

## Impact

Cambio independiente de postgresql-projects-memberships, sin crear ramas ni mover cambios locales durante C. Dependencia de exposición remota de EPIC-002: SEC-01 debe implementarse/verificarse antes de endpoints, junto con auth real inyectable. EPIC-002 conserva pooling/TLS/auth/recursos; no se apropia de esta corrección funcional. Coordinación de migración/ACL detallada en design, sin ejecutarla.

Sin dependencia npm nueva. Fuente técnica propuesta de asignaciones: registro explícito de operador en PostgreSQL; integración institucional futura sigue pendiente y no se deduce de tokens Access sintéticos. Nueva migración aditiva, SQL v1 inmutable. Costo operativo incremental esperado mínimo sobre base del producto, sin nuevo servicio ni gasto autorizado. US$0 de validación remota sigue condicionado a cuotas reales; no se crean recursos por esta propuesta.

C solo autoriza estos cuatro artefactos y validación CLI. No código, paquetes, SQL/cluster, Git de escritura, recursos, deploy ni archivado. Aprobar C nunca concede D-S, permisos de Git/SQL ni E.
