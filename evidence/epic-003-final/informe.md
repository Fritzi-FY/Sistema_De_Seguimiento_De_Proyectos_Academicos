# EPIC-003: revisión funcional y verificación final, sin cierre

Fecha de referencia: 2026-10-26, America/Lima. Se conserva la rama feature/epic-003-kanban-boards-tasks y el worktree con sus cambios locales. No se ejecutaron staging, commits, push, PR, merge, despliegue ni archivo/sincronización de OpenSpec. No se añadieron dependencias ni funcionalidad de EPIC-002.

## Resultado funcional

El contraste detallado está en auditoria.md. Se completaron los pendientes menores especificados: filtro por responsable UUID exacto y barra contextual para actualizar Tablero/Lista. Aplicar/limpiar reinicia la página; actualizar Lista conserva filtros aplicados y página, independientemente de cambios en el borrador. Se reutilizan contratos y endpoints existentes. Los anuncios de movimiento incluyen origen, destino y posición. Los avisos act se corrigieron esperando el montaje/efectos del modal antes de escribir y resolviendo/rechazando las promesas controladas dentro de act; se conservaron todas las aserciones de aislamiento.

Los incrementos previos de responsables/historial y columnas se comprobaron en la suite actual y en dos flujos HTTP reales aislados. Los proyectos antiguos con identidad textual siguen separados del UUID nuevo de desarrollo. No se convirtieron identidades ni se borraron/migraron datos; no se reiniciaron procesos.

## Una ronda global final y repeticiones afectadas

| Comprobación                          | Resultado real                                                                                                     | Evidencia                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| npm.cmd test                          | 613 pruebas aprobadas en 65 archivos: shared 79/7, API 324/28, web 210/30; código 0                                | suite.log                                  |
| Avisos React act en ronda final       | 0; no se silenciaron console.error/warn ni se debilitaron aserciones                                               | suite.log; cambios KanbanBoard.test.tsx    |
| npm.cmd run typecheck                 | shared/API/web aprobados, código 0                                                                                 | static.log                                 |
| npm.cmd run lint                      | Global aprobado, código 0                                                                                          | lint.log                                   |
| npm.cmd run format:check              | Primera ronda: código 1, 12 archivos preexistentes del EPIC con formato pendiente                                  | format.log                                 |
| Corrección y formato afectado         | Solo esos 12 archivos, sin cambio semántico. Prettier --check de los 12: código 0. No se repitió el chequeo global | format-correction.log, format-affected.log |
| npm.cmd run build                     | shared tsc, API wrangler build dry-run y web Vite aprobados, código 0; sin despliegue                              | build.log                                  |
| OpenSpec activo estricto              | CLI instalado 1.7.0, cambio válido, código 0                                                                       | openspec.log                               |
| OpenSpec --all --strict               | 8 artefactos aprobados, 0 fallidos, código 0                                                                       | openspec.log                               |
| Prueba afectada tras formato API      | 15/15 aprobadas, sin repetir suite global; diff --ignore-all-space vacío para ambos archivos API                   | test-format-affected.log                   |
| Flujo identidad/responsable/historial | 1/1 aprobado; incluye filtro HTTP assigneeId con coincidencia y sin coincidencias                                  | identity-flow.log                          |
| Flujo columnas                        | 1/1 aprobado; iniciales, IN_REVIEW opcional, orden, eliminación/traslado e historial y restricciones               | columns-flow.log                           |

La comprobación previa acotada detectó dos fallos de sincronización del test al agrupar apertura y edición del modal en el mismo act. Se separó la espera de montaje de la escritura y del settlement, manteniendo las aserciones. pre-final-targeted.log registra ese intento fallido; no se presenta como evidencia aprobada. La única ronda global final posterior pasó íntegramente las pruebas.

Los 12 archivos corregidos de formato son in-memory-board.repository.ts y su prueba, archivos_actuales_incremento_3a.md, auditoria_estado_4a.md, cierre_4a_verificado.md, revision_3d.md, revision_4a.md, revision_4b.md y cuatro artefactos en evidence/lista-paginada: cierre-lista-destinos-vacios.md, columns-test-results.json, manifest-cierre.json y manifest.json. Los manifiestos de ese directorio siguen siendo antecedentes; el manifiesto SHA-256 del ZIP final es el que acredita este snapshot.

Los cuatro Markdown del cambio OpenSpec están excluidos del format:check global por la configuración existente. Por ello también se verificaron explícitamente con --ignore-path .gitignore: se corrigió su formato tras las anotaciones finales y el check acotado pasó (format-openspec-affected.log). La auditoría e informe nuevos pasaron Prettier. Se repite únicamente la validación del cambio OpenSpec afectado tras estas actualizaciones documentales, sin volver a ejecutar la ronda global.

No quedaron fallos funcionales detectados del EPIC en la ronda. Como aviso ajeno al código del EPIC, Rollup informa dos anotaciones PURE de la dependencia Zod; el build concluye con éxito. PowerShell puede representar stderr nativo con NativeCommandError en los logs aun cuando el proceso devuelve 0: se verificaron los códigos de salida y resultados reales. No se modificaron dependencias para ocultar avisos.

## Navegador y única comprobación manual pendiente

Se intentó Computer Use con las herramientas disponibles: cua.getState detectó Brave (ventana 66662); cua.getApp devolvió "Computer Use app approval timed out". El flujo quedó bloqueado antes de interactuar con la aplicación. No hay capturas, ejecución manual del agente ni confirmación nueva del usuario; las confirmaciones históricas no se atribuyen al estado actual.

La única lista manual pendiente es:

1. **Filtros y vistas:** combinar texto, columna, prioridad, responsable UUID y etiqueta; aplicar desde otra página, paginar/reintentar/limpiar y actualizar Lista con un borrador sin aplicar. Volver a Tablero y comprobar coherencia tras mover una tarea con puntero y teclado, incluido destino vacío, Escape y foco.
2. **Responsables e historial:** en un proyecto nuevo con UUID, asignar miembro activo al crear y cambiar/quitar responsables al editar; confirmar eventos reales, error/reintento y bloqueo de doble envío/cambio de vista. No atribuir los proyectos textuales antiguos al UUID nuevo.
3. **Columnas:** comprobar tres iniciales, añadir opcionalmente En revisión, renombrar y mover antes/después; cancelar y confirmar eliminación vacía/con destino para tareas; verificar rechazo de última columna y opciones actualizadas al entrar a Lista. Revisar foco/teclado y presentación móvil/escritorio.

## Pendientes y límites de entrega

La implementación y las pruebas locales enumeradas están verificadas actualmente; no se declara EPIC-003 cerrado. Permanecen pendientes el recorrido manual anterior, E2E de navegador, CI y revisión humana. No se ejecutaron staging ni comprobaciones remotas/PostgreSQL. Los adaptadores actuales son en memoria y la autenticación sigue siendo andamiaje dev/test. No se exige ni se simula un árbol Git limpio: los cambios se preservan y 7.5 permanece abierta en su condición de limpieza.

El ZIP es un paquete de revisión. Incluye los archivos de código/pruebas/documentación del EPIC cambiados respecto de main y los nuevos del worktree, el diff rastreado respecto de HEAD y main, estado Git con archivos no rastreados y manifiesto SHA-256 de cada entrada salvo el propio manifiesto. Excluye .git, skills/configuración del agente, secretos y archivos de entorno, dependencias, builds, cachés y ZIP anteriores. Los logs de esta verificación se incluyen expresamente aunque Git los ignore. Los informes antiguos se preservan como contexto, sin usarlos para aprobar la ronda final. El script de empaquetado verifica entradas y hashes al producir el único ZIP final y su checksum externo.

El primer empaquetado se generó y verificó antes de marcar F.6. Después se actualiza el mismo ZIP con las marcas/documentación final y se vuelven a verificar todas sus entradas y hashes. Solo se entrega EPIC-003-revision-final.zip; su checksum externo se encuentra en EPIC-003-revision-final.zip.sha256. No se incluyen paquetes de revisiones anteriores ni se borra ninguno de los archivos previos del usuario.

Gate UI acotado: controles nativos y etiquetados, foco visible y estados de error/carga comprobados por código y pruebas; el build y los recorridos automatizados de los controles nuevos pasan. Se conserva la dirección visual existente (ENERGY 1 / RHYTHM 1 / MOTION 1), sin activos nuevos. La inspección visual real y una auditoría completa de accesibilidad no se presentan como ejecutadas.

## Autorización posterior para publicar un PR en borrador

La descripción de F anterior corresponde a la verificación local previa a publicar. Después, el usuario autorizó commits coherentes, publicación exclusiva de feature/epic-003-kanban-boards-tasks sin force-push y PR en borrador hacia main. La conformidad visual general se registra en conformidad-visual.md sin inferir pruebas específicas. Las comprobaciones técnicas/manuales pendientes conservan su alcance. Los logs, ZIP, manifiestos, diffs de empaquetado y scripts temporales permanecen locales y no se versionan; los resultados comprobados se resumen en este informe y en el PR. No se repiten suites aprobadas porque el código coincide con el snapshot verificado. Esta autorización no incluye merge, despliegue ni archivo/sincronización de OpenSpec.
