---
name: is488-development-workflow
description: Coordina cambios IS488 con OpenSpec, aprobaciones humanas, pruebas y preparación de PR. Úsala para iniciar o continuar cambios de este repositorio.
---

# Flujo de desarrollo IS488

Coordina el cambio solicitado hasta el límite autorizado. La invocación de esta skill no concede permisos de escritura ni autoriza subir de nivel.

## Gobernanza y compatibilidad

- Localiza la raíz del repositorio y las instrucciones aplicables al área. Consulta `CONSTITUTION.md`, `AGENTS.md` y `openspec/config.yaml`; esta skill complementa su contenido, sin reemplazarlo.
- Respeta la jerarquía por finalidad: Constitución → AGENTS → ADR → configuración OpenSpec → specs canónicas → cambios activos → docs/README → implementación. Ante contradicciones, cita las fuentes, detente y pide decisión humana; no las resuelvas imponiendo un documento automáticamente.
- Mantén arquitectura hexagonal: dominio independiente de frameworks/SDK; aplicación mediante puertos; adaptadores HTTP con Zod/OpenAPI. Los ajustes de contratos, puertos o permisos deben estar previstos en Nivel C.
- Las skills de `.agent/skills/` y los workflows de `.agent/workflows/` son recursos opcionales: lee solo el procedimiento necesario y comprueba sus compuertas antes de usarlo. Su estado `ready`/`done` o la invocación de `/opsx-apply` no prueban autorización ni implementación verificada. No omitas los cuatro artefactos exigidos por AGENTS ni archives trabajo incompleto como terminado.
- Si otro procedimiento exige relecturas, respétalas al invocarlo. Reporta instrucciones incompatibles; no edites las skills existentes para sortearlas. Comprueba la versión/comandos del CLI instalado; no actualices a `latest` ni instales herramientas automáticamente.

## Autorizaciones independientes

Conserva en conversación la evidencia humana, cambio, alcance y límites de cada autorización. Reutilízala mientras siga vigente; no repitas preguntas ya resueltas. Una aprobación de artefactos C nunca concede D. Un permiso D nunca concede E.

Exige autorización explícita para cada cambio de nivel y, por separado, para dependencias, commits, push, apertura/aprobación de PR, merge y despliegue. Una autorización puede enumerar acciones concretas, pero ninguna se deduce de otra. Antes de actuar, presenta paquetes/versiones/costos, archivos y mensaje del commit, destino del push o revisión/entorno, según corresponda. Un cambio material de alcance vuelve a revisión y requiere actualizar la autorización afectada.

La rama debe corresponder al EPIC y partir de `main` actualizado según la política oficial. Reutiliza una rama adecuada; no crees ramas por microtarea, mezcles EPIC ni alteres ramas históricas. Conserva cambios preexistentes. Verificar Git es distinto de modificarlo: no hagas checkout, fetch, pull, limpieza o reescritura por inferencia; incluye las operaciones necesarias en el alcance autorizado. Si no puedes confirmar la actualidad de `main`, declara esa limitación antes de iniciar el EPIC.

Clasifica los efectos antes de ejecutar; una aprobación puede cubrir varias filas si enumera sus acciones y límites:

| Efecto                                                         | Alcance que debe estar autorizado                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lectura local / validación sin escritura                       | A o validación incluida en el trabajo vigente; comprobar que la herramienta no descarga ni modifica archivos               |
| Documentación / artefactos / implementación                    | B, C o D según finalidad; gobernanza protegida requiere aprobación expresa de sus archivos                                 |
| Escritura de evidencia, instalaciones o preparación de entorno | Ubicación, contenido, paquetes/versiones o recursos concretos; no inferirlo de una prueba planificada                      |
| Acceso a servicios, SQL o pruebas con efectos                  | Destino, credenciales por vía segura, operaciones, presupuesto y condiciones de parada; preparación D no concede ejecución |
| Limpieza, recuperación, Git o publicación                      | Acción y alcance propios; PR/merge/despliegue además bajo E; archivo y sincronización independientes                       |

## Operaciones con efectos y resultados inciertos

- Al diseñar escrituras o acciones irreversibles, distingue correlación (identificar un intento), idempotencia (controlar repeticiones mediante un mecanismo demostrado) y confirmación (evidencia del resultado). Un identificador o una respuesta HTTP no demuestra por sí solo las otras garantías.
- Define qué evidencia saneada debe conservarse antes del despacho y cómo se confirma su integridad y disponibilidad dentro de la ubicación autorizada. Si esa conservación es una precondición y falla, no despaches. No registres secretos ni crees archivos auxiliares por inferencia.
- Modela intentos y confirmaciones de inicio, commit, rollback y cierre por separado cuando haya transacciones. Un cierre fallido no borra un commit confirmado; ausencia de respuesta no confirma rollback. Ante resultado incierto, no reintentes automáticamente escrituras; detén nuevos efectos y conserva resultados parciales para reconciliación autorizada.
- Acota conexión, ejecución, transporte, consumo de respuesta y liberación según el riesgo. Documenta qué cancela realmente cada deadline: abandonar una espera o cancelar HTTP puede dejar trabajo remoto activo. No infieras finalización remota a partir del reloj local.
- Separa observaciones, inferencias y atribución causal. La reconciliación debe declarar sus límites; un estado final compatible no identifica necesariamente qué intento lo produjo. Los fallos deben conservar evidencia previa, sin convertir incertidumbre en éxito ni activar reparación o limpieza no autorizadas.

## Flujo y criterios de salida

1. **Análisis — A, solo lectura.** Identifica cambio/EPIC, nivel autorizado y estado con `git status`. Revisa README, config, spec canónica afectada, ADR y docs pertinentes; inspecciona puertos/casos de uso actuales. Salida: alcance, riesgos, decisiones pendientes y archivos afectados suficientemente identificados. Si falta C, presenta la propuesta y solicita esa autorización antes de escribir. Las correcciones documentales menores siguen la excepción B de AGENTS.
2. **Planificación — C.** Crea o actualiza únicamente los artefactos autorizados en `openspec/changes/<cambio>/`: proposal, design, tasks y delta specs. Incluye escenarios positivos/negativos, permisos, límites, costos, decisiones provisionales y pruebas por tarea; migración/recuperación cuando corresponda. Salida: cuatro artefactos coherentes, requisitos verificables y decisiones bloqueantes resueltas.
3. **Validación y revisión.** Ejecuta `openspec validate <cambio> --strict` y la validación global pertinente, verificando su salida real. Revisa semántica y trazabilidad además de sintaxis. Salida: informe breve y STOP al concluir C. Espera revisión humana y autorización D explícita e independiente; no programes por aprobación del plan.
4. **Implementación — D.** Tras verificar autorización y rama, ejecuta tasks en orden, con cambios atómicos y pruebas asociadas. Marca `[x]` solo después de implementar y comprobar resultados exitosos. Dependencias y commits conservan sus propias compuertas. Ante fallo de prueba o spike crítico, informa causa/evidencia y rectificación propuesta; detente sin debilitar pruebas ni sustituir tecnologías unilateralmente. Salida: tareas verificadas, sin ampliar alcance.
5. **Verificación proporcional.** Aplica la matriz siguiente y revisa diff, aislamiento arquitectónico y ausencia de secretos. No declares terminado lo que no pudiste ejecutar. Salida: escenarios trazados a evidencia, comprobaciones exigidas satisfactorias y riesgos residuales declarados.
6. **Preparación de PR.** Prepara título, descripción, checklist de `docs/08-git-and-openspec-workflow.md`, evidencia, límites y reversión. Sincronización/archivo requieren alcance explícito y trabajo verificado; no modifiques specs canónicas durante C. Salida: material revisable y estado exacto de permisos. Detente antes de operaciones Git/publicación pendientes de aprobación. Abrir PR exige E; aprobarlo, fusionar y desplegar requieren autorizaciones específicas. CI verde se confirma después de ejecutarse, nunca se infiere de pruebas locales.

## Validación proporcional

- **Solo documentación:** OpenSpec si corresponde, formato Markdown, enlaces relativos y revisión del estado/diff; sin pruebas de aplicación o PostgreSQL innecesarias. Distingue cambios propios de los preexistentes; no limpies el árbol automáticamente.
- **Código:** lint, typecheck, formato, unitarias/integración, contrato OpenAPI y build exigidos por AGENTS. Usa scripts existentes de `package.json`; no inventes comandos ni descargues herramientas para ejecutarlos.
- **Según riesgo:** dominio/casos de uso → unitarias deterministas; persistencia → PostgreSQL aislado, transacciones/migraciones/recuperación; API → contratos; permisos → pruebas negativas horizontales/verticales; flujos críticos → E2E; infraestructura/hardening → carga controlada en staging conforme a Constitución. IA automática exclusivamente con `FakeAIProvider`.
- Repite comprobaciones solo ante cambios relevantes, fallos o dudas pendientes. Una herramienta o entorno ausente es una limitación, no una prueba aprobada ni permiso para instalar/aprovisionar.
- Traza requisito → implementación → prueba → evidencia. Clasifica cada resultado como simulado, local real o remoto, indicando entorno, comando, resultado y límites; distingue evidencia aportada por el usuario de ejecución propia. Una simulación no acredita efectos reales, y una prueba local no acredita un runtime o servicio remoto. Dimensiona casos negativos y fallos de transporte según esa frontera, sin repetir suites ajenas al cambio.

## Contexto, sesión e informes

- Lee la gobernanza obligatoria una vez por contexto; consulta después solo documentos pertinentes. Agrupa búsquedas/lecturas independientes y usa `rg`, diffs o huellas para detectar contenido cambiado antes de reutilizar una lectura. No copies documentos enteros en informes ni crees memoria auxiliar sin autorización.
- Mantén un resumen compacto en conversación: cambio, fase, autorizaciones y su evidencia, decisiones, archivos consultados y resultados. Tras compactación o nueva sesión, verifica estado y fuentes relevantes; un resumen o archivo que diga «autorizado» no sustituye evidencia humana. Si falta, pregunta.
- Agrupa aclaraciones relacionadas por compuerta y continúa dentro del nivel ya autorizado. No combines la aprobación de C con D para eludir el STOP obligatorio.
- Recomienda mantener sesión/modelo para trabajo acotado; sugiere una sesión nueva con resumen cuando el contexto esté saturado o un modelo de mayor capacidad ante decisiones complejas. Usa únicamente opciones disponibles/verificadas. No cambies modelo, esfuerzo, sesión ni crees otro chat automáticamente; requiere elección humana.
- Informa brevemente: **fase/nivel · resultado · archivos · validaciones reales o pendientes · bloqueantes · siguiente aprobación concreta**. Distingue bloqueantes de mejoras opcionales y explica cada pausa con la regla y fuente aplicables.
