## 1. Revisión y autorización

- [x] 1.1 Revisar propuesta, delta y diseño: confirmar alcance de almacenamiento interno, destinatario único, deduplicación por acción y semántica best-effort sin entrega según preferencias.
- [x] 1.2 Obtener autorización explícita Nivel D independiente; confirmar rama, árbol y alcance de pruebas con efectos antes de modificar código. No interpretar aprobación del plan como autorización de implementación.

Aprobación humana registrada el 2026-11-10: propuesta aceptada y Nivel D autorizado exclusivamente para el bloque 2, incluyendo que una revisión confirmada puede quedar sin notificación. Rama verificada: `feature/epic-007-audit-reports-notifications`; árbol inicial con solo estos cuatro artefactos nuevos y staging vacío. Sin SQL real, migraciones, publicación ni implementación de los bloques 3–5. Se autoriza un commit documental separado de los cuatro artefactos; la implementación se entrega sin commit para revisión.

## 2. Contratos y reglas de aplicación

- [x] 2.1 Extender el resultado de respuesta docente con la identidad de su acción confirmada y el payload de `ReviewNotificationPort`; adaptar repositorios y dobles. Unitarias: identidad exacta sin consulta de última acción y dos respuestas CHANGES_REQUESTED distintas.
- [x] 2.2 Definir puertos y reglas de notificación interna con metadatos mínimos. Unitarias: solicitante original activo, otro miembro rechazado, proyecto/acción/docente/estado inconsistentes y permisos no verificables sin guardado.
- [x] 2.3 Conectar el caso de uso conservando revisión HTTP y tratamiento post-commit. Unitarias: revisión fallida no emite; notificación fallida no revierte; diagnóstico saneado; ningún reintento automático ante resultado incierto.

Evidencia del bloque 2 (2026-11-10): cinco suites afectadas, 55 pruebas aprobadas, 0 fallidas y 0 omitidas. Incluyen las reglas de aplicación (18), respuesta docente (18), repositorio en memoria (6), rutas HTTP existentes (11) y contrato del resultado PostgreSQL con sesión SQL simulada (2). Esta última no acredita ejecución SQL real. Pasaron typecheck, lint, format:check global, typecheck:preparation, build local y OpenSpec estricto (13 elementos). Web y build requirieron repetición fuera del sandbox por denegación de acceso de esbuild. No se ejecutó PostgreSQL real ni se implementaron restricción única, migración, revalidación SQL transaccional o composición de producción: siguen pendientes en bloques 3 y 4. El puerto de guardado exige revalidación transaccional y deduplicación en su futura implementación; los dobles solo verifican la delegación y la ausencia de reintentos.

`npm test` completo, repetido fuera del sandbox sin habilitar SQL: código 0, 783 aprobadas (shared 122, API 445, web 216), 0 fallidas, 36 SQL omitidas por configuración. No se contabilizan esas omisiones como pruebas SQL reales. El primer intento de las suites afectadas detectó un matcher no disponible en Vitest 2; se reemplazó por aserciones equivalentes de cantidad y argumentos y la repetición pasó sin debilitar cobertura.

## 3. Persistencia PostgreSQL

- [ ] 3.1 Preparar migración aditiva, catálogo y privilegios mínimos; conservar el SHA de 0006. SQL real: aplicar desde vacío y desde 0006, reaplicar sin cambios y comprobar restricciones e integridad referencial.
- [ ] 3.2 Implementar adaptador de guardado y validación transaccional mediante interfaces explícitas. SQL real: destinatario autorizado, membresía retirada, aislamiento entre proyectos y evento sin acción confirmada.
- [ ] 3.3 Demostrar deduplicación por acción/destinatario secuencial y concurrente, sin modificar fila previa; demostrar que dos ciclos del mismo estado producen dos filas distintas.
- [ ] 3.4 Inyectar fallos de inserción, rollback, confirmación de commit y cierre. Verificar resultados confirmados frente a inciertos, ausencia de registros parciales tras rollback confirmado y ausencia de repetición automática.
- [ ] 3.5 Probar retirada de membresía concurrente en ambas ordenaciones con el guardado, confirmando el punto de autorización y sin atribuir a una retirada posterior la eliminación de registros previos.

## 4. Composición y flujo integrado

- [ ] 4.1 Conectar el adaptador a la composición PostgreSQL existente y equivalente de pruebas; no crear endpoints, bandeja ni preferencias. Verificar configuración incompleta antes de conectar y destino exacto antes de SQL.
- [ ] 4.2 Probar por HTTP solicitud, dos ciclos de corrección y aprobación final: tres respuestas, tres registros internos, ninguno por solicitud o reenvío. Mantener contratos y seis eventos del historial de revisión.
- [ ] 4.3 Regresión HTTP de sesión/roles, docente no asignado, autoría, membresía y proyectos ajenos; comprobar 401/403/404/409 según contrato y cero nuevas notificaciones en operaciones rechazadas.
- [ ] 4.4 Inyectar fallo de guardado de notificación tras respuesta válida; verificar HTTP 200, revisión y acción confirmadas, diagnóstico seguro y no duplicación.
- [ ] 4.5 Guardar evidencia saneada antes y después de reiniciar realmente API y PostgreSQL; comparar estado e historial HTTP completos y todos los campos de las notificaciones mediante SQL autorizado. Esperar salida final del arranque y detenerse ante fallos.

## 5. Verificación y entrega

- [ ] 5.1 Ejecutar suites afectadas y `npm test`; registrar aprobadas, fallidas y omitidas. Ejecutar SQL real únicamente en el clúster local autorizado o perfil CI aislado; no contar omisiones como cobertura real.
- [ ] 5.2 Ejecutar `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run typecheck:preparation -w @is488/api` y `npm run build`; revisar contratos OpenAPI sin ampliar API.
- [ ] 5.3 Ejecutar `openspec validate persist-teacher-review-notifications --strict`, `openspec validate --all --strict` y `git diff --check`; revisar trazabilidad de escenarios y evidencia real.
- [ ] 5.4 Preparar resumen de resultados, límites y reversión; comprobar 0006, ambos stashes y rama EPIC-006 preservados. Commit, publicación, PR, archivo, merge y despliegue requieren sus autorizaciones separadas.
