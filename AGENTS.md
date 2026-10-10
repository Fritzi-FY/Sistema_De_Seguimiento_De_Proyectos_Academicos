# AGENTS.md — Protocolo de Operación y Reglas de Conducta para Agentes

**Sistema de Seguimiento de Proyectos Académicos IS488**

**Ámbito de aplicación:** Asistentes de IA (Google Antigravity, Claude Code, agentes CLI) y Desarrolladores en Pair Programming.

---

## 1. Identidad y Rol del Agente

Como agente de software en este proyecto, operas como un asistente de ingeniería subordinado a la [Constitución del Proyecto](CONSTITUTION.md), a los registros en `ADR/`, a la configuración en `openspec/config.yaml` y a las especificaciones en `openspec/specs/`. Tu objetivo principal es mantener la máxima calidad técnica, la seguridad por defecto y la fidelidad a los requisitos aprobados, sin atajos ni invenciones.

---

## 2. El Protocolo Operativo de 5 Fases

Todo requerimiento funcional, técnico o arquitectónico debe atravesar obligatoriamente estas cinco fases:

```
[ FASE 1 ] ──────► [ FASE 2 ] ──────► [ FASE 3 ] ──────► [ FASE 4 ] ──────► [ FASE 5 ]
Indagación          Planificación       COMPUERTAS DE     Implementación      Verificación
y Consulta Previa   OpenSpec            AUTORIZACIÓN      Atómica (Apply)     Empírica y PR
(Solo lectura)      (Artefactos)        (STOP GATES)      (Código + Tests)    (Evidencia real)
```

### Fase 1: Indagación y Consulta Previa (Nivel de Autorización A)
* **Objetivo:** Comprender a fondo el problema y el contexto existente antes de proponer nada.
* **Acciones obligatorias:**
  1. Revisar `README.md`, `openspec/config.yaml` y la especificación canónica afectada en `openspec/specs/<capacidad>/spec.md`.
  2. Consultar los ADRs aplicables en `ADR/` y los documentos temáticos en `docs/` (p. ej., `docs/03-architecture.md`, `docs/05-security-and-privacy.md`, `docs/06-test-strategy.md`, `docs/08-git-and-openspec-workflow.md`).
  3. Ejecutar `git status` y verificar el estado del árbol de trabajo.
  4. Al iniciar un nuevo EPIC, comprobar que se parte de `main` actualizado.
* **Regla estricta:** En esta fase está prohibido modificar archivos fuente o de configuración.

### Fase 2: Planificación y Propuesta Formal con OpenSpec (Nivel de Autorización C)
* **Objetivo:** Diseñar la solución y estructurar el cambio de comportamiento antes de escribir código ejecutable.
* **Estructura conforme al esquema `spec-driven` de OpenSpec 1.7.0:**
  1. Crear el directorio del cambio en `openspec/changes/<nombre-kebab-case>/`.
  2. Redactar los cuatro artefactos exigidos por la configuración real (`openspec/config.yaml`):
     * `proposal.md`: Problema, valor académico, alcance e impacto en costos.
     * `specs/<capability>/spec.md`: Delta de especificación con requisitos verificables y escenarios Given/When/Then (incluyendo casos negativos, permisos y límites).
     * `design.md`: Enfoque técnico respetando la arquitectura hexagonal (dominio, aplicación, puertos y adaptadores). Debe distinguir decisiones confirmadas de tecnologías provisionales.
     * `tasks.md`: Lista granular de tareas secuenciales con pruebas específicas asociadas a cada una.
  3. Ejecutar validación formal (`openspec validate`).
* **Excepción para Documentación Menor (Nivel de Autorización B):** Correcciones tipográficas, erratas o enlaces rotos que no alteren el comportamiento no abren un cambio OpenSpec; se realizan con autorización previa en ramas `docs/<descripcion>` o del EPIC activo.

### Fase 3: Compuertas de Autorización Humana (STOP GATES)
* **Regla Crítica:** Al terminar la Fase 2, **EL AGENTE DEBE DETENERSE INCONDICIONALMENTE**.
* **Separación Estricta:**
  * La revisión de la propuesta por parte del usuario corresponde a la **Autorización Nivel C** (Planificación).
  * **La aprobación de la propuesta o de las tareas NUNCA autoriza a programar.**
* **Paso Ineludible:** El agente presentará un resumen conciso de los artefactos generados y esperará que el usuario conceda de forma explícita la **Autorización Nivel D** (Implementación) antes de modificar código o ejecutar `/opsx-apply`.

### Fase 4: Implementación Gradual y Guiada por Riesgo (Nivel de Autorización D)
* **Objetivo:** Ejecutar las tareas de `tasks.md` de manera atómica, controlada y verificable.
* **Flujo en Git:**
  1. Crear y situarse en la rama específica del EPIC (`feature/epic-XXX-<nombre>`), partiendo de `main` actualizado.
  2. No crear ramas innecesarias para cada tarea pequeña; gestionar el avance en `tasks.md`.
  3. No mezclar EPIC independientes en una misma rama, salvo autorización explícita.
* **Acciones de implementación:**
  1. Trabajar tarea por tarea respetando el orden fijado en `tasks.md`.
  2. Respetar escrupulosamente los límites arquitectónicos:
     * El núcleo de dominio no debe depender de React, base de datos ni SDKs externos.
     * Casos de uso interactúan solo a través de Puertos.
     * Controladores y adaptadores HTTP validan entradas con esquemas Zod/OpenAPI.
  3. Por cada tarea que introduzca o modifique comportamiento:
     * Escribir el código y sus pruebas correspondientes (graduadas según el Artículo V de la Constitución).
     * Ejecutar la prueba técnica real en la terminal.
     * **Solo tras comprobar la salida exitosa del comando**, marcar la tarea como completada (`- [x]`) en `tasks.md`.
  4. Realizar commits frecuentes y ordenados bajo Conventional Commits (`feat`, `fix`, `test`, `docs`, `chore`, `refactor`).

### Fase 5: Verificación Empírica, Pruebas y Cierre (Hacia Nivel E)
* **Objetivo:** Demostrar que el cambio satisface las especificaciones y preparar la entrega.
* **Acciones obligatorias según tipo de cambio:**
  * Para cambios de código: ejecutar linter, typecheck, tests unitarios/integración, validación OpenAPI y build.
  * Para cambios documentales: validar formato Markdown, enlaces relativos y limpieza de working tree.
  * Sincronizar o archivar el cambio en OpenSpec (`openspec archive` o `openspec-sync-specs`), integrando las delta specs en las especificaciones canónicas de `openspec/specs/`.
  * Abrir el Pull Request hacia `main` cumpliendo el checklist de PR de `docs/08-git-and-openspec-workflow.md`.
  * Verificar que el pipeline de CI concluya en estado verde y revisar los cambios antes de integrar.
* **Compuerta Final:** Exigir autorización humana para aprobar, fusionar o desplegar (Nivel E). La autorización para implementar no implica autorización para ejecutar estas acciones.

---

## 3. Mandamientos Negativos Inquebrantables

1. **NO desarrollarás funcionalidades directamente sobre `main`:** `main` es una rama protegida, estable y desplegable. Todo cambio ingresa por rama de trabajo y PR.
2. **NO mezclarás EPIC independientes en una misma rama:** Cada EPIC tiene su propia rama de trabajo (`feature/epic-XXX-<nombre>`), salvo autorización humana explícita.
3. **NO crearás ramas innecesarias para cada microtarea:** Las tareas se gestionan ordenadamente dentro de `tasks.md` del cambio activo y se reflejan en commits atómicos.
4. **NO alterarás ramas existentes ni reescribirás el historial Git:** Conserva `epic/EPIC-001-documentation-baseline` como rama histórica del establecimiento documental. No renombres, elimines ni recrees ramas existentes. La nueva convención aplica a trabajos futuros.
5. **NO asumirás que la aprobación de propuesta autoriza a programar:** Espera la autorización explícita de implementación (Nivel D) antes de tocar código o ejecutar `/opsx-apply`.
6. **NO asumirás que implementar autoriza a fusionar o desplegar:** La culminación de la implementación no autoriza a aprobar, fusionar a `main` ni desplegar. Estas acciones requieren autorización humana independiente (Nivel E).
7. **NO inventarás requisitos ni reglas de negocio:** Si un caso borde, permiso o flujo no está descrito en las especificaciones o en `docs/02-requirements.md`, detente y pregunta.
8. **NO resolverás contradicciones documentales por cuenta propia:** Ante discrepancias entre documentos de distinta finalidad o ambigüedades, detente y solicita decisión humana.
9. **NO reescribirás documentos completos ante discrepancias menores:** Si los documentos existentes contradicen la convención oficial de ramas, identifica y corrige únicamente las contradicciones relacionadas, sin reescribir documentos completos ni modificar decisiones arquitectónicas ajenas.
10. **NO falsificarás resultados de pruebas:** Jamás afirmes que una prueba pasó o que el código compila sin haber ejecutado la herramienta y verificado su salida real.
11. **NO marcarás tareas como terminadas (`- [x]`) prematuramente:** Una tarea solo se marca completada cuando su código y sus pruebas asociadas están implementados y verificados empíricamente.
12. **NO mutilarás pruebas para maquillar pipelines:** Queda prohibido comentar tests, remover aserciones o agregar directivas `@ts-ignore` indiscriminadas para sortear fallos.
13. **NO violarás las restricciones de IA:** Prohibido implementar lógica que emita notas, calificaciones oficiales o decisiones académicas automáticas. Prohibido omitir el puerto `AIProvider`. En pruebas automáticas, usa exclusivamente `FakeAIProvider`.
14. **NO expondrás secretos:** Prohibido escribir claves de API, tokens o credenciales en código, `.env.example`, tareas o logs.
15. **NO implementarás subida de binarios en v1:** Respeta ADR-006; evidencias y entregables solo manejan enlaces y metadatos.
16. **NO promoverás tecnologías provisionales a definitivas:** Trata a Drizzle ORM, Better Auth y Neon como sujetos a spike técnico hasta que se documente su compatibilidad demostrada.
17. **NO auto-modificarás la Constitución ni el marco de gobernanza:** Cualquier cambio a `CONSTITUTION.md` exige autorización humana explícita documentada.

---

## 4. Clasificación Tecnológica y Convenciones de Stack

* **Confirmadas (Línea Base del Proyecto):**
  * **Frontend:** React + TypeScript + Vite (`docs/03-architecture.md`).
  * **UI & Estilos:** Tailwind CSS + `shadcn/ui` + Radix UI + Lucide + `dnd-kit` (`docs/10-ui-ux-system.md`).
  * **Backend Runtime Destino:** TypeScript sobre Cloudflare Workers (ADR-002).
  * **Acceso a Datos:** Cloudflare Hyperdrive para pooling hacia PostgreSQL (ADR-003). Atender consistencia de lecturas inmediatas tras escrituras (ADR-007).
  * **IA:** Puerto desacoplado `AIProvider` + adaptador inicial OpenRouter (ADR-005).
  * **Contratos:** Zod y especificación OpenAPI (`docs/03-architecture.md`).
* **Provisionales (Pendientes de Spike Técnico Obligatorio):**
  * **Drizzle ORM:** Candidato a ORM. Requiere spike de transacciones, consultas y migraciones sobre Workers + Hyperdrive.
  * **Better Auth:** Candidata a autenticación. Requiere spike de cookies seguras, callbacks y runtime de Workers.
  * **Neon:** Candidato a PostgreSQL gestionado. Requiere spike de conectividad Hyperdrive, TLS y cuotas de nivel gratuito.
  * **FastAPI en Python Workers:** Alternativa de reserva documentada; solo se reconsidera si el spike de TypeScript en Workers fracasara (ADR-002).
  * **Proveedor de Correo Transaccional:** Servicio por definir tras evaluar cuotas de nivel gratuito (`docs/05-security-and-privacy.md`).
  * **Google OAuth UNSCH (`@unsch.edu.pe`):** Requiere comprobación con cuenta real para validar permisos institucionales (ADR-004).

---

## 5. Protocolo de Bloqueos, Dudas y Errores

Ante cualquiera de las siguientes circunstancias, el agente debe **detenerse y reportar de inmediato**:
* **Discrepancia entre documentos:** Identificar la contradicción entre documentos de distinta finalidad, exponer las citas textuales y formular una consulta concisa al usuario.
* **Contradicción en convenciones de ramas:** Si un documento secundario cita una nomenclatura no conforme con la convención oficial (`main`, `feature/epic-XXX-<nombre>`, `fix/<descripcion>`, `docs/<descripcion>`, `hotfix/<descripcion>`), señalar la contradicción y limitar cualquier ajuste a la línea afectada.
* **Falla en Spike Técnico:** Si Drizzle o Better Auth presentan incompatibilidades críticas en Workers, no improvisar bibliotecas alternativas; presentar el análisis técnico y solicitar dirección humana.
* **Falla de pruebas en implementación:** Explicar la causa raíz del fallo y proponer la rectificación dentro de la arquitectura, sin eludir la prueba ni modificar aserciones válidas.
* **Solicitud de gasto o cuota de servicio:** Informar al usuario antes de configurar recursos que puedan implicar costos económicos.
