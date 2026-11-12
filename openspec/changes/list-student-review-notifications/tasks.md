# Tareas: bandeja estudiantil de revisiones

Propuesta aprobada por el usuario el 2026-11-12. Nivel D autorizado exclusivamente para 2.1–2.3 y sus pruebas/validaciones; autorizado un commit documental separado de estos cuatro artefactos antes de implementar. Los bloques 3–6 siguen sin autorización de implementación. Sin SQL, instalaciones ni publicación; el código del bloque 2 se entrega para revisión local, sin commit. Se conservan ambos stashes y hashes 0006/0007.

## 1. Revisión y autorización

- [x] 1.1 Revisar los cuatro artefactos; acordar ruta, metadatos, orden/cursor con microsegundos, revalidación por página y vista mínima sin escrituras.
- [ ] 1.2 Registrar aprobación humana y autorización Nivel D del bloque concreto; confirmar rama/base limpia, ambos stashes y hashes 0006/0007 antes de implementar. El uso de SQL y entorno requiere autorización explícita independiente de la planificación.

## 2. Contratos y caso de uso de lectura

- [ ] 2.1 Añadir DTO/query/respuesta Zod y puerto de lectura independiente de `ReviewNotificationPort`; probar campos mínimos, query estricta, limit 1–100/default 20 y ausencia de parámetros de identidad del cliente.
- [ ] 2.2 Implementar codec de cursor v1; probar base64url/JSON inválidos, versión/claves/tamaño/fecha/UUID, conservación de seis decimales, empates por UUID y cursores válidos ajenos/inexistentes sin tratarlos como permisos.
- [ ] 2.3 Implementar caso de uso con rol student e identidad de sesión; probar 403 antes de consultar para otros roles, parámetros del puerto, vacío real frente a fallo y ausencia de llamadas al puerto emisor/escritor.

## 3. Adaptadores y permisos por página

- [ ] 3.1 Añadir adaptador PostgreSQL de lectura usando la configuración/sesión existente: destinatario + solicitante original + EXISTS de membresía activa antes del cursor/orden/limit+1; proyección timestamp textual con precisión completa. Probar que no toma una página global para filtrarla después ni revela continuidad de filas ajenas.
- [ ] 3.2 Añadir equivalente en memoria conectado al almacén de escritura existente; probar mismo filtro, orden, desempate, cursor/lookahead y copias sin mutación.
- [ ] 3.3 Ejecutar SQL real en bases/roles de pruebas nuevos del destino autorizado, previa identidad exacta; probar aislamiento de estudiantes/proyectos, creador sin membresía, retirada antes de consulta/entre páginas, readmisión y ambas ordenaciones de una lectura/retirada concurrente según su instantánea.
- [ ] 3.4 Probar paginación SQL con timestamps distintos dentro del mismo milisegundo y UUID en orden opuesto, timestamps exactamente iguales, nuevas inserciones entre páginas, cursor del último item y lookahead exclusivamente autorizado. Comparar resultados del adaptador en memoria.
- [ ] 3.5 Probar dos CHANGES_REQUESTED y aprobación como registros distintos/históricos, reasignación docente sin borrar acceso del solicitante activo, tablas de negocio intactas tras GET y fallo de lectura sin parcialidad. Confirmar hashes/manifiesto/privilegios 0006/0007 sin cambios; registrar salida por suite y limpiar solo recursos propios tras revalidar destino.

## 4. API y OpenAPI

- [ ] 4.1 Conectar caso de uso y adaptadores en ambos modos de persistencia; añadir GET /api/review-notifications con autenticación existente, sesión como identidad, Zod y Cache-Control: no-store.
- [ ] 4.2 Actualizar OpenAPI y probar 200/400/401/403/500, incluidos vacío, rol cambiado, query que intenta elegir destinatario, cursor ajeno/retirado y headers de identidad falsificados sin ampliar alcance.
- [ ] 4.3 Probar HTTP con PostgreSQL real: primera página, retirada de membresía y segunda página filtrada antes del límite, respuesta con timestamp/cursor exactos, consulta fallida sin datos parciales y tablas de negocio sin escrituras. No afirmar OAuth real a partir de sesiones sintéticas.
- [ ] 4.4 Ejecutar regresiones de revisión/emisión para conservar los cuerpos y códigos HTTP vigentes, deduplicación y HTTP 200 best-effort ante fallo de guardado; no reparar notificaciones al leer.

## 5. Bandeja web de solo lectura

- [ ] 5.1 Añadir servicio con apiFetch y consumo literal de nextCursor; probar cookies, campos mínimos, fecha de presentación separada de la posición y errores sin datos viejos.
- [ ] 5.2 Integrar vista estudiantil en AppShell reutilizando estilos existentes: una página, mensaje histórico, fecha/referencias, carga/vacío/error y Actualizar/Siguiente/Reintentar. Probar roles, límites, último cursor y reemplazo, no acumulación, de páginas.
- [ ] 5.3 Probar revalidación al recuperar foco/actualizar, limpieza al salir/cerrar sesión/cambiar rol o usuario, 401/403/errores, cancelación y respuesta tardía de una sesión anterior. Probar teclado, anuncio de estados y ausencia de desbordamiento móvil.
- [ ] 5.4 Verificar recorrido integral en navegador con API y PostgreSQL del entorno autorizado: listado, cambio de página, retirada de membresía y revalidación sin filas del proyecto retirado. Registrar qué fue real, manual, DOM simulado o HTTP; no presentar mocks como E2E automatizado ni instalar herramientas sin aprobación.

## 6. Verificación y entrega

- [ ] 6.1 Ejecutar suites pertinentes y npm test; informar aprobadas/fallidas/omitidas y SQL real separado, incluidos límites de CI. No modificar pipeline sin autorización.
- [ ] 6.2 Ejecutar lint, format:check global, typecheck, typecheck:preparation y test:preparation de API, build y contratos OpenAPI; no desplegar.
- [ ] 6.3 Ejecutar openspec validate list-student-review-notifications --strict, openspec validate --all --strict y git diff --check; revisar trazabilidad, ausencia de datos sensibles y diff exclusivamente del alcance aprobado.
- [ ] 6.4 Entregar evidencia, límites de revocación/snapshot, reversión y git status; verificar ambos stashes y hashes 0006/0007. No marcar tareas sin su ejecución empírica; commit/push/PR/archivo/merge/despliegue requieren sus propias autorizaciones.
