# 9. Roadmap de implementación por EPIC

La prioridad es terminar temprano un flujo vertical y expandir después. La secuencia puede adaptarse a la evaluación semanal, pero cada EPIC mantiene su rama, propuesta OpenSpec, pruebas, PR y evidencia.

| EPIC | Rama sugerida | Resultado demostrable | Dependencias |
|---|---|---|---|
| EPIC-001 | `feature/epic-001-foundation` | Repositorio, estructura, reglas, OpenSpec, CI básica, lint/typecheck y build. | Ninguna |
| EPIC-002 | `feature/epic-002-vertical-slice` | Login de desarrollo, crear proyecto, tablero inicial, crear/mover tarea y persistir datos en PostgreSQL. | 001 |
| EPIC-003 | `feature/epic-003-identity-access` | Google OAuth institucional + correo/contraseña verificado, perfiles, RBAC y pruebas de acceso. | 002 |
| EPIC-004 | `feature/epic-004-projects-teams` | Cursos, proyectos, equipos, membresías y asignación docente. | 003 |
| EPIC-005 | `feature/epic-005-kanban-tasks` | Columnas configurables, drag/drop, etiquetas, prioridades, responsables, fechas y vista de lista. | 004 |
| EPIC-006 | `feature/epic-006-collaboration-reviews` | Comentarios, avances, metadatos de entregables y revisión docente. | 005 |
| EPIC-007 | `feature/epic-007-audit-reports-notifications` | Auditoría, notificaciones internas y reportes básicos. | 006 |
| EPIC-008 | `feature/epic-008-ai-assistant` | Asistente OpenRouter para resúmenes, señales de riesgo y próximos pasos, con límites y mocks. | 006–007 |
| EPIC-009 | `feature/epic-009-quality-hardening` | Pruebas completas, seguridad, accesibilidad, rendimiento, k6 y observabilidad. | 002–008 |
| EPIC-010 | `feature/epic-010-production-delivery` | HTTPS, CI/CD, staging/prod, smoke tests, rollback y documentación de sustentación. | 001–009 |

## 9.1 Definition of Done por EPIC

- Cambio OpenSpec aprobado antes de implementar comportamiento significativo.
- Tareas completadas y correspondencia con requisitos demostrable.
- Unit tests y integration tests apropiados pasan.
- No hay defectos críticos conocidos de autorización o pérdida de datos.
- Contrato API actualizado si cambió.
- CI verde y PR revisado.
- Evidencia del resultado funcional capturada de manera real.
- Documentación/ADR actualizado si cambió una decisión.
- Cambio OpenSpec verificado y archivado tras integrar.

## 9.2 Primera entrega funcional

La primera demo debe incluir un flujo completo pequeño, no pantallas desconectadas: usuario autenticado (modo de desarrollo inicialmente), crea proyecto, crea tarea, mueve tarea de columna, recarga y confirma persistencia. La autenticación real se integra después de validar el spike y no se considera terminada por tener un formulario visual.

## 9.3 Evidencias para nota

Mantener por EPIC: enlace a rama, commits, PR, estado CI, archivos OpenSpec, capturas de UI real, pruebas, y despliegue. Crear `docs/evidence/` con nombres de archivo fechados; no almacenar secretos ni datos reales de alumnos.
