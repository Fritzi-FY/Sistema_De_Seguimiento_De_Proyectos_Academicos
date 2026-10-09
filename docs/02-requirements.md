# 2. Requisitos y criterios de aceptación

## 2.1 Requisitos funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| FR-001 | El sistema permitirá iniciar sesión con Google OAuth institucional, tras validar la identidad y el dominio permitido. | Alta |
| FR-002 | El sistema ofrecerá una alternativa de correo/contraseña con verificación de correo, si se configura un proveedor de correo transaccional. | Alta |
| FR-003 | El sistema mantendrá roles estudiante, docente y administrador; el rol no podrá elevarse por autoselección del usuario. | Alta |
| FR-004 | El usuario podrá consultar y actualizar los datos de perfil no privilegiados. | Media |
| FR-005 | Un estudiante autorizado podrá crear un proyecto con título, descripción, curso, fechas y miembros. | Alta |
| FR-006 | Los proyectos tendrán un docente responsable o asignado y reglas explícitas de membresía. | Alta |
| FR-007 | Los integrantes autorizados podrán crear y editar tareas con responsable, prioridad, fechas, etiquetas y estado. | Alta |
| FR-008 | El sistema permitirá crear columnas Kanban configurables y ordenar/mover tareas, respetando permisos y consistencia. | Alta |
| FR-009 | El sistema ofrecerá una vista de lista y una vista Kanban responsive. | Media |
| FR-010 | Los usuarios autorizados podrán comentar tareas y registrar actividad/avances. | Alta |
| FR-011 | Se podrán registrar entregables con nombre, descripción, fecha y enlace/metadatos de evidencia. | Alta |
| FR-012 | El docente asignado podrá registrar observaciones y estado de revisión de un entregable o avance. | Alta |
| FR-013 | El sistema generará notificaciones internas sobre fechas próximas, menciones y observaciones relevantes. | Media |
| FR-014 | El sistema conservará eventos de auditoría de cambios relevantes. | Alta |
| FR-015 | El sistema presentará reportes de avance por proyecto, curso y equipo según los permisos del usuario. | Media |
| FR-016 | El asistente IA podrá resumir información de un proyecto al que el usuario tenga acceso. | Alta |
| FR-017 | El asistente IA podrá identificar señales de riesgo basadas en fechas/estados y proponer próximos pasos, sin emitir calificaciones. | Alta |
| FR-018 | El sistema limitará el uso de IA por usuario/proyecto y registrará metadatos de consumo sin almacenar secretos. | Alta |
| FR-019 | Las listas grandes tendrán filtros, ordenamiento y paginación del lado del servidor. | Alta |
| FR-020 | El sistema expondrá una API REST versionada/documentada mediante OpenAPI. | Alta |
| FR-021 | El sistema podrá operar con IA deshabilitada o proveedor no disponible, mostrando un error controlado. | Alta |
| FR-022 | La aplicación permitirá exportar o consultar un historial básico del proyecto para sustentación y seguimiento. | Baja |

## 2.2 Requisitos no funcionales (NFR)

Los umbrales siguientes son **objetivos iniciales de aceptación**, no resultados medidos. Se revisarán tras la primera línea base de pruebas.

| ID | Atributo | Objetivo verificable |
|---|---|---|
| NFR-001 | Seguridad | Todas las rutas privadas autentican y autorizan del lado del servidor; las pruebas incluyen acceso horizontal no autorizado. |
| NFR-002 | Rendimiento | En staging, con 50 usuarios virtuales y una carga representativa, p95 de endpoints de lectura ordinarios ≤ 500 ms y tasa de error < 1%, excluyendo fallas deliberadas de servicios externos. |
| NFR-003 | Escalabilidad | Frontend estático distribuible por CDN; API sin estado local; consultas paginadas; conexión a PostgreSQL por pool/Hyperdrive. |
| NFR-004 | Disponibilidad | Degradación controlada si IA o correo están indisponibles; las funciones centrales no dependen de IA. |
| NFR-005 | Mantenibilidad | Dominio y casos de uso no dependen de componentes de UI ni directamente de SDK de proveedores. |
| NFR-006 | Testabilidad | Unit tests e integration tests obligatorios en CI; E2E para flujos críticos. |
| NFR-007 | Interoperabilidad | API documentada y validada contra su contrato OpenAPI. |
| NFR-008 | Accesibilidad | Navegación por teclado, foco visible, etiquetas accesibles y contraste adecuado en flujos principales. |
| NFR-009 | Trazabilidad | Cambios relevantes almacenan actor, acción, recurso, fecha y metadatos mínimos. |
| NFR-010 | Privacidad | Enviar a IA solo datos mínimos y autorizados; no enviar contraseñas, tokens, secretos ni datos ajenos al proyecto. |
| NFR-011 | Portabilidad | Persistencia y migraciones versionadas; secretos y configuración separados del código. |
| NFR-012 | Costo | Priorizar niveles gratuitos; cuotas de IA, correo y base de datos configurables; alertar antes de superar presupuestos. |
| NFR-013 | UX | Diseño responsive; operaciones frecuentes del tablero requieren pocos pasos y estados de carga/error claros. |
| NFR-014 | Observabilidad | Registrar errores, latencia, estado de dependencias y despliegues sin registrar credenciales ni contenido sensible. |

## 2.3 Criterios de aceptación globales

- Un estudiante no puede acceder a un proyecto del que no es miembro salvo que tenga permiso explícito por rol y asignación.
- Un docente solo puede revisar proyectos de su ámbito asignado, salvo administración autorizada.
- Mover una tarea actualiza el estado y deja un evento de actividad consistente.
- Las columnas de un tablero no se pueden eliminar si dejarían tareas huérfanas sin una política explícita de migración/reasignación.
- Una falla de OpenRouter no bloquea la consulta o edición de proyectos y tareas.
- Las pruebas unitarias, de integración, contrato y E2E críticas pasan en CI antes de integrar a `main`.
- El despliegue productivo solo ocurre desde `main` y el pipeline ejecuta un smoke test posterior.
- Las pruebas de carga se ejecutan en staging; en producción solo se ejecutan verificaciones ligeras.
- Los artefactos OpenSpec se revisan y archivan al finalizar un cambio funcional.

## 2.4 Reglas de negocio iniciales

1. Solo un usuario con rol permitido puede crear proyectos; la política exacta de creación por curso se configurará.
2. Cada proyecto tiene un conjunto explícito de miembros y, cuando corresponda, docente responsable.
3. Cada tarea pertenece a un proyecto y a una columna válida del tablero de ese proyecto.
4. El porcentaje de avance no se introduce manualmente como verdad única: se deriva de tareas completadas y puede complementarse con un avance narrativo.
5. La revisión docente no equivale a una nota oficial del curso.
6. La IA produce recomendaciones no vinculantes; el usuario valida cualquier acción.
7. La auditoría no almacena contraseñas, tokens ni cuerpos completos sensibles.
