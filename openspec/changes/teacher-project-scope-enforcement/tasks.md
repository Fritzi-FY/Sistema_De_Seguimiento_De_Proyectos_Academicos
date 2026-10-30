> Estado D local (sesión 2026-10-26–27): D-P y D-S autorizados posteriormente por el usuario e implementados/verificados en el worktree existente, sin crear ramas, mover cambios ni Git de escritura. La evidencia de preparación y SQL local no acepta cloud ni cierra EPIC-002. Recursos/SQL remoto/E siguen pendientes. Los textos de C anteriores se conservan como historial de planificación.
## 1. Compuertas de implementación

C actual autoriza cuatro artefactos y validación, no estas tareas de código/SQL. No marcar realizadas por existir un plan.

- [x] 1.1 Obtener D-S independiente para inventario design y acuerdo de separación Git/worktree o excepción explícita, conservando cambios locales; no crear/mover ramas por inferencia. Coordinar dependencia D-P de ACL/auth sin instalar paquetes nuevos.
- [x] 1.2 Confirmar que el contrato implementado corresponde a política C aprobada (creator/collaborator conservados, asignación read-only y fuente institucional pendiente), sin introducir permisos administrativos o mutaciones nuevos.

## 2. Puerto y autorización de aplicación

- [x] 2.1 Crear TeacherProjectScopePort read-only y export; tests de tipos/contrato y fake/adapter en memoria con conjunto vacío por defecto, sin dependencia framework/SQL en dominio.
- [x] 2.2 Cambiar ListProjectsUseCase a unión propia/membresía/asignación docente deduplicada, eliminando findAll por teacher. Probar asignado/ajeno/sin asignaciones, docente creador/colaborador con y sin asignación y metadatos no filtrados al cliente.
- [x] 2.3 Cambiar GetProjectByIdUseCase a relación existente o asignación explícita, ajeno null→404. Probar error de fuente fail-closed, membresía retirada con asignación aún válida y ausencia total de relación.
- [x] 2.4 Preservar permisos de mutación por relación. Tests prueban asignación sola sin gestión de integrantes/otras mutaciones; docente owner/collaborator conserva exactamente reglas existentes. No debilitar aserciones válidas.

## 3. Persistencia y composición

- [x] 3.1 Crear adaptador SQL de lectura de public.teacher_project_assignments mediante sesión producto; pruebas unitarias de mapeo, parámetros, error sin fallback y fuente vacía.
- [x] 3.2 Preparar migración aditiva 0002/manifest y entrada ACL runtime SELECT en política producto; verificar checksum/orden y no modificación v1, sin aplicar SQL por preparar archivo.
- [x] 3.3 Inyectar puerto en createApp y rutas proyectos, sin dev remoto ni grants desde cliente. Tests HTTP de filtrado/404, asignación sola read-only y relaciones creador/colaborador preservadas.
- [x] 3.4 Solo tras permiso independiente de cluster/datos/limpieza, ejecutar integración SQL nueva exclusiva: evolución preservando proyectos/membresías, PK/FK, nuevas sesiones y denegaciones runtime DML/DDL/ledger. Sin servidor preexistente ni remoto.

## 4. Verificación y dependencia de exposición

- [x] 4.1 Ejecutar tests afectados nuevos, lint, typecheck, formato, contrato OpenAPI y build, conservar salidas saneadas y revisar diff; no repetir experimentos históricos completos ni simular aprobación SQL.
- [x] 4.2 Validar ambos cambios OpenSpec y trazabilidad a escenarios aprobados; informar fuente institucional pendiente y evidencia local/simulada/remota por separado.
- [x] 4.3 Informar a EPIC-002 que SEC-01 fue implementado/verificado antes de permitir exposición; formalización C sola no satisface esta compuerta. Detener antes de recursos/SQL remoto/E y no archivar ni fusionar.
