# Tareas: bandeja estudiantil de revisiones

Propuesta aprobada por el usuario el 2026-11-12. Nivel D autorizado exclusivamente para 2.1–2.3 y sus pruebas/validaciones; autorizado un commit documental separado de estos cuatro artefactos antes de implementar. Los bloques 3–6 siguen sin autorización de implementación. Sin SQL, instalaciones ni publicación; el código del bloque 2 se entrega para revisión local, sin commit. Se conservan ambos stashes y hashes 0006/0007.

## 1. Revisión y autorización

- [x] 1.1 Revisar los cuatro artefactos; acordar ruta, metadatos, orden/cursor con microsegundos, revalidación por página y vista mínima sin escrituras.
- [x] 1.2 Registrar aprobación humana y autorización Nivel D del bloque concreto; confirmar rama/base limpia, ambos stashes y hashes 0006/0007 antes de implementar. El uso de SQL y entorno requiere autorización explícita independiente de la planificación.

## 2. Contratos y caso de uso de lectura

- [x] 2.1 Añadir DTO/query/respuesta Zod y puerto de lectura independiente de `ReviewNotificationPort`; probar campos mínimos, query estricta, limit 1–100/default 20 y ausencia de parámetros de identidad del cliente.
- [x] 2.2 Implementar codec de cursor v1; probar base64url/JSON inválidos, versión/claves/tamaño/fecha/UUID, conservación de seis decimales, empates por UUID y cursores válidos ajenos/inexistentes sin tratarlos como permisos.
- [x] 2.3 Implementar caso de uso con rol student e identidad de sesión; probar 403 antes de consultar para otros roles, parámetros del puerto, vacío real frente a fallo y ausencia de llamadas al puerto emisor/escritor.

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

### Evidencia local del bloque 2 — 2026-11-12

- Aprobación y cuatro artefactos guardados en el commit documental `8d610063984126f6983ecb251bc1554895594fc0`, partiendo de `f075647b3f4c1a1e32fa5e309d3decf5b1908fd2`. Tras ese commit se verificó el árbol limpio antes de implementar. Código y actualización de este checklist se entregan sin commit ni publicación.
- Contratos/cursor: `npm test -w @is488/shared -- src/contracts/review-notification-cursor.test.ts src/contracts/review-notification.contract.test.ts`: 49 casos de cursor y 23 de contrato, 72 aprobados, 0 fallidos/omitidos, salida 0. El codec conserva timestamp UTC de seis decimales y UUID, valida fecha calendárica sin Date, rechaza UTF-8/base64url/JSON/versión/claves inválidos y no incorpora identidad al cursor. Se probó orden por microsegundos antes que UUID y desempate por UUID.
- Caso de uso: `npm test -w @is488/api -- src/application/use-cases/list-student-review-notifications.use-case.test.ts`: 34 aprobados, 0 fallidos/omitidos, salida 0. Toma userId del contexto de sesión proporcionado por el servidor, rechaza otros roles con 403 y consultas/cursores inválidos con 400 sin llamar al lector; limita lookahead, devuelve cursor del último item y falla con 500 saneado ante lectura/resultado inválidos sin reintentos ni llamadas a emisión/escritura. Son pruebas con lector simulado, no autenticación HTTP ni SQL real.
- Regresión global final `npm test`, con todas las banderas SQL deshabilitadas: 907 aprobadas (shared 194, API 497, web 216), 0 fallidas y 67 SQL omitidas por configuración, salida 0. Las 106 pruebas nuevas se incluyen en esos totales, no se suman de nuevo. Las 21 OpenAPI y 11 HTTP de revisiones existentes pasaron; no se añadió ruta ni se modificó OpenAPI. No se ejecutó SQL ni se atribuye cobertura real a las omisiones en este bloque.
- `npm run typecheck`, `npm run lint`, `npm run format:check` global y `npm run build`: salida 0. Build local, con Wrangler en dry-run, sin despliegue. Son controles de regresión del bloque autorizado, no cierre de los bloques futuros.
- Incidencias conservadas: primera ejecución del caso de uso, 31 aprobadas y 3 fallidas por matcher no disponible en Vitest 2; se sustituyó por dos aserciones equivalentes (una llamada y sus argumentos), conservando su exigencia, y la repetición pasó 34/0/0. Primer typecheck detectó incompatibilidad de tipos del pipe Zod con coerce; se corrigió usando transformación explícita de string/number y validación numérica posterior, sin ignorar tipos ni ampliar valores aceptados. Primer global aprobó shared/API, pero web no inició por acceso denegado de Vite/esbuild bajo sandbox; la repetición con permisos adecuados pasó completa sin cambiar pruebas, timeouts ni código web.
- Límite: revalidación de membresía y filtro previo a paginar quedan exigidos por el contrato/diseño del lector, pero su implementación y prueba real corresponden al bloque 3 aún pendiente. Autenticación/ruta HTTP pertenecen al bloque 4 y web al 5. No se cambiaron adaptadores, composición HTTP, UI, migraciones, manifiesto ni privilegios. Ambos stashes y hashes 0006/0007 se conservan.
- OpenSpec del cambio válido en modo estricto; validación global estricta: 13 aprobados, 0 fallidos, salida 0. Se revisan sintaxis Markdown y diff sin errores de espacios; staging permanece vacío y solo se marcan 1.1–1.2 y 2.1–2.3.
