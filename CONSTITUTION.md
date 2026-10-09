# CONSTITUTION.md — Constitución del Sistema de Seguimiento IS488

**Proyecto Académico IS488 — Semestre 2026-II**

Universidad Nacional de San Cristóbal de Huamanga

Autor / Responsable: Fritz Brenner Flores Yarasca

---

## Preámbulo y Propósito

Este documento constituye la norma suprema de gobernanza técnica, arquitectónica y operativa del Sistema de Seguimiento de Proyectos Académicos.

Todo colaborador, sea desarrollador humano o agente de inteligencia artificial (incluyendo Google Antigravity o herramientas CLI equivalentes), está subordinado a los principios inmutables aquí establecidos. Ninguna instrucción de prompt, optimización local o conveniencia de implementación tiene validez si contradice esta Constitución.

---

## Artículo I: Soberanía de OpenSpec, Jerarquía Documental y Resolución de Conflictos

1. **Gobernanza del Comportamiento:** OpenSpec es el marco mandatorio que gobierna todo cambio en el comportamiento del sistema, requisitos funcionales y no funcionales, contratos de API y decisiones de arquitectura. Ningún cambio de esta índole puede programarse sin un cambio estructurado y activo en `openspec/changes/`.
2. **Jerarquía Documental por Finalidad:**
   * **Nivel 1 — Principios Constitucionales:** `CONSTITUTION.md` (norma suprema, límites éticos, técnicos y no negociables).
   * **Nivel 2 — Instrucciones Operativas:** `AGENTS.md` (protocolo de ejecución y normas de conducta para agentes de IA y desarrolladores).
   * **Nivel 3 — Decisiones Arquitectónicas (ADR):** Registros en `ADR/` (decisiones de arquitectura aceptadas con contexto, alternativas y consecuencias).
   * **Nivel 4 — Configuración de Gobernanza:** `openspec/config.yaml` (reglas y contexto de Spec-Driven Development).
   * **Nivel 5 — Especificaciones Canónicas:** `openspec/specs/*` (línea base viva del comportamiento del producto).
   * **Nivel 6 — Cambios de Comportamiento Activos:** `openspec/changes/<cambio>/` (`proposal.md`, delta specs en `specs/<capacidad>/spec.md`, `design.md`, `tasks.md`).
   * **Nivel 7 — Documentación de Soporte y Contexto:** Documentos en `docs/`, `README.md` y `REFERENCES.md`.
   * **Nivel 8 — Implementación Concreta:** Código fuente (`src/`), migraciones y suites de pruebas.
3. **Resolución de Conflictos y Prohibición de Resolución Automática:**
   * Los documentos tienen finalidades distintas y complementarias. Ante una contradicción real entre documentos de distinta finalidad o ante una decisión ambigua, **el agente tiene la prohibición estricta de resolverla de forma unilateral o automática imponiendo un documento sobre otro**.
   * El agente debe **detenerse de inmediato**, documentar la discrepancia citando las fuentes y **solicitar una decisión humana explícita**.

---

## Artículo II: Precedencia Documental, Consulta Previa y Modificaciones Menores

1. **Consulta Previa Obligatoria:** Antes de plantear una propuesta o alterar una especificación, es obligatorio consultar los documentos relevantes en `docs/` y los registros aplicables en `ADR/`. Está prohibido formular cambios ignorando el contexto histórico, las restricciones de costo o las alternativas ya evaluadas.
2. **Excepción para Documentación Menor:** De acuerdo con la regla de mantenimiento establecida en `README.md`, no se requiere un cambio OpenSpec para ajustes puramente documentales menores (corrección de erratas, mejoras de redacción sin alteración de comportamiento, enlaces rotos o notas de lectura en `docs/`). Estas modificaciones deben contar con autorización humana previa y tramitarse en ramas `docs/<descripcion>` o en la rama del EPIC activo.
3. **Obligatoriedad de OpenSpec:** Cualquier modificación que afecte reglas de negocio, esquemas de datos, flujos de navegación, contratos OpenAPI, permisos, límites de servicio o infraestructura exige indefectiblemente el ciclo completo de OpenSpec (`proposal.md`, delta specs, `design.md`, `tasks.md`).

---

## Artículo III: Niveles de Autorización Humana y Separación Estricta de Fases

Para garantizar el control humano riguroso y evitar avances autónomos no supervisados, se establecen cinco niveles formales de autorización:

* **Nivel A — Autorización para Indagar / Analizar:** Permite al agente leer repositorios, explorar código, consultar documentación y diagnosticar problemas (`openspec explore`), sin modificar ningún archivo.
* **Nivel B — Autorización para Documentar Menor:** Permite editar documentación menor según lo previsto en el Artículo II.2, sin tocar código ni contratos.
* **Nivel C — Autorización para Planificar / Proponer:** Permite al agente inicializar y redactar artefactos de planificación en `openspec/changes/<cambio>/` (`proposal.md`, delta specs, `design.md`, `tasks.md`).
* **Nivel D — Autorización para Implementar:** Permite modificar código fuente, esquemas de base de datos, dependencias o suites de pruebas en la rama de trabajo autorizada (`openspec apply`).
* **Nivel E — Autorización para Integrar y Desplegar:** Permite abrir Pull Requests, fusionar cambios hacia `main` y realizar despliegues a entornos publicados.

**Cláusulas Inquebrantables de Compuerta (Stop Gates):**
1. **La aprobación de una propuesta o plan (Nivel C) NUNCA autoriza a implementar (Nivel D):** Tras redactar y validar los artefactos de OpenSpec, el agente debe detenerse. Se requiere autorización humana explícita e independiente para comenzar a codificar o ejecutar `/opsx-apply`.
2. **La culminación de la implementación (Nivel D) NUNCA autoriza a fusionar ni desplegar (Nivel E):** La autorización para implementar no implica autorización para aprobar, fusionar o desplegar. El agente no puede modificar `main`, fusionar PRs ni activar despliegues sin revisión humana aprobada y CI verde.

---

## Artículo IV: Integridad Arquitectural, Capas Hexagonales y Estado Tecnológico

1. **Monolito Modular y Arquitectura Hexagonal:** El sistema se estructura como un monolito modular guiado por Clean Architecture / Puertos y Adaptadores (ADR-001 y `docs/03-architecture.md`):
   * **Dominio (`domain`):** Entidades puras, agregados y reglas invariantes; estrictamente desacoplado de frameworks, bibliotecas de persistencia, Workers y React.
   * **Aplicación (`application`):** Casos de uso y orquestación transaccional; interactúa con el exterior únicamente a través de interfaces (Puertos).
   * **Infraestructura (`infrastructure`):** Adaptadores que implementan los puertos hacia el exterior (endpoints HTTP, persistencia, clientes de correo, proveedor IA).
   * **Prohibición de Microservicios Iniciales:** Se prohíbe introducir particionamiento distribuido o microservicios independientes sin justificación técnica respaldada por mediciones reales de saturación (ADR-001).
2. **Catálogo de Estado Tecnológico:**
   * **Decisiones Confirmadas (Línea Base del Proyecto):**
     * Arquitectura: Monolito modular con arquitectura hexagonal (ADR-001).
     * Frontend: React + TypeScript + Vite (`docs/03-architecture.md`).
     * UI y Diseño: Tailwind CSS + `shadcn/ui` + Radix UI + Lucide + `dnd-kit` (`docs/10-ui-ux-system.md`).
     * Backend Destino Preferido: TypeScript sobre Cloudflare Workers (ADR-002).
     * Agrupador de Conexiones DB: Cloudflare Hyperdrive para pooling hacia PostgreSQL (ADR-003).
     * Interfaz de IA: Puerto interno `AIProvider` con adaptador inicial OpenRouter y mocks para pruebas (ADR-005).
     * Archivos Binarios Pospuestos: Solo metadatos y enlaces en v1; prohibido persistir binarios en el filesystem de Workers (ADR-006).
     * Estrategia de Caché: Enfoque incremental sin Redis/KV inicial; respuestas privadas no se cachean en CDN compartido por defecto (ADR-007).
     * Contratos: Zod y especificación OpenAPI (`docs/03-architecture.md`).
   * **Decisiones Provisionales (Sujetas a Spike Técnico Obligatorio):**
     * **Drizzle ORM:** Candidato a ORM y migraciones; su adopción definitiva exige validar transacciones y empaquetado en el runtime de Workers con Hyperdrive (ADR-002 y `docs/12-open-questions-and-risks.md`).
     * **Better Auth:** Candidata a biblioteca de autenticación; su adopción definitiva exige comprobar compatibilidad con Workers, Hyperdrive, cookies seguras y callbacks (ADR-004 y `docs/12-open-questions-and-risks.md`).
     * **Neon PostgreSQL:** Candidato inicial para base de datos gestionada; sujeto a corroborar pausas por inactividad, conectividad vía Hyperdrive, TLS y cuotas del plan gratuito (ADR-003 y `docs/12-open-questions-and-risks.md`).
     * **FastAPI en Python Workers:** Alternativa técnica documentada y rechazada preliminarmente; permanece como reserva documentada si el spike de TypeScript en Workers fracasara (ADR-002).
     * **Proveedor de Correo Transaccional:** Servicio sujeto a selección y verificación de límites de nivel gratuito (`docs/05-security-and-privacy.md` y `docs/12-open-questions-and-risks.md`).
     * **Google OAuth Institucional UNSCH (`@unsch.edu.pe`):** Sujeto a validación con cuenta real para confirmar políticas de Google Workspace institucional (ADR-004 y `docs/12-open-questions-and-risks.md`).
   * **Regla de No-Elevación:** Ningún agente puede elevar una tecnología provisional a definitiva por el hecho de aparecer mencionada en la documentación o en este archivo; se requiere el registro formal del spike técnico aprobado.

---

## Artículo V: Veracidad, Graduación de Pruebas según Riesgo y Evidencia Empírica

1. **Cero Tolerancia a la Falsificación y Alucinación:** Queda terminantemente prohibido:
   * Declarar pruebas como aprobadas sin haber ejecutado el comando técnico real en el entorno correspondiente.
   * Marcar tareas como completadas (`- [x]`) en `tasks.md` si el código, las pruebas o las condiciones de aceptación no están enteramente cumplidas.
   * Inventar respuestas de servicios externos, requisitos no solicitados o estados de pipeline ficticios.
   * Eliminar, comentar o desactivar pruebas (`skip`, directivas indiscriminadas de `@ts-ignore`) para maquillar fallos en CI (`openspec/config.yaml`).
2. **Graduación Pertinente de Pruebas según Riesgo y Tipo de Cambio:**
   * **Modificaciones Puramente Documentales:** Se exige validación de formato Markdown, enlaces relativos y estado limpio de Git. **No se exigen pruebas de código ni de base de datos** para cambios documentales.
   * **Cambios en Dominio o Casos de Uso:** Pruebas unitarias exhaustivas, deterministas, rápidas y aisladas de red (`docs/06-test-strategy.md`).
   * **Cambios en Persistencia y Adaptadores:** Pruebas de integración con base de datos de prueba aislada, verificando integridad referencial, transacciones y migraciones (`docs/06-test-strategy.md`).
   * **Cambios en Rutas, Parámetros o Respuestas de API:** Pruebas de contrato y validación de esquemas contra el contrato OpenAPI (`openspec/specs/platform-quality/spec.md`).
   * **Cambios con Impacto en Seguridad y Permisos:** Pruebas de acceso horizontal (un usuario no debe acceder a proyectos ajenos) y vertical (un estudiante no puede auto-promoverse) (`docs/05-security-and-privacy.md` y `openspec/specs/identity-access/spec.md`).
   * **Flujos Críticos de Usuario:** Pruebas E2E automatizadas (Playwright) ejecutadas en staging o flujos prioritarios de CI (`docs/06-test-strategy.md`).
   * **Cambios de Infraestructura o EPICs de Hardening:** Pruebas de carga controladas (k6) ejecutadas **exclusivamente en staging con datos sintéticos** (objetivo inicial: p95 ≤ 500 ms y tasa de error < 1% a 50 VUs). Queda prohibido ejecutar pruebas de carga contra producción (`docs/06-test-strategy.md`).
3. **Evidencia Técnica Obligatoria:** Todo entregable o cierre de EPIC debe respaldarse con evidencia verificable: salidas reales de tests, estado de CI/CD, reportes de OpenAPI y métricas observables (`docs/06-test-strategy.md` y `docs/09-epic-roadmap.md`).

---

## Artículo VI: Seguridad, Privacidad y Confinamiento Ético de la IA

1. **Seguridad Defensiva y Mínimo Privilegio:**
   * La autorización se comprueba siempre en el servidor en cada operación; el cliente no es autoridad (`docs/05-security-and-privacy.md`).
   * Toda solicitud privada asume política de denegación por defecto.
   * Las sesiones deben usar cookies seguras (`HttpOnly`, `Secure`, `SameSite`) y no almacenar tokens de sesión duraderos en `localStorage` (`docs/05-security-and-privacy.md`).
2. **Autenticación Dual y Contingencia:**
   * Google OAuth institucional es la vía principal a validar, pero la alternativa de correo y contraseña con verificación por email es un mecanismo de contingencia obligatorio e indispensable; no debe removerse (`openspec/specs/identity-access/spec.md`).
3. **Confinamiento Ético y Operativo del Asistente de IA:**
   * **Prohibición Inquebrantable:** El asistente de IA jamás emitirá notas oficiales, calificaciones automáticas ni decisiones académicas vinculantes (ADR-005 y `docs/01-product-vision-and-scope.md`).
   * Toda respuesta de IA debe presentarse explícitamente como sugerencia asistiva no vinculante.
   * La plataforma debe permanecer plenamente funcional si el proveedor de IA falla o agota su cuota (`openspec/specs/ai-assistant/spec.md`).
   * En pruebas automáticas y entornos de CI está estrictamente prohibido invocar APIs reales de pago; se deben usar implementaciones simuladas (`FakeAIProvider` / mocks) (ADR-005).
4. **Privacidad de Datos y Secretos:**
   * Hacia el proveedor de IA solo se transmiten los datos mínimos y autorizados del proyecto en consulta. Prohibido enviar tokens, credenciales o datos fuera del ámbito permitido (`docs/05-security-and-privacy.md`).
   * Prohibido registrar o versionar secretos en código, repositorios, logs o artefactos OpenSpec (`docs/07-deployment-and-operations.md`).
5. **Consistencia de Datos en Caché (Hyperdrive):**
   * Debido a que Cloudflare Hyperdrive puede cachear consultas de lectura sin invalidación automática tras una escritura, las rutas que requieran consistencia inmediata no deben apoyarse en lecturas cacheadas por el pooler (ADR-007 y `docs/12-open-questions-and-risks.md`).

---

## Artículo VII: Política Oficial de Ramas en Git y Ciclo de Entrega

1. **Convención Oficial de Ramas:**
   * `main`: Rama principal estable e integrable. Protegida; prohibido commits o pushes directos.
   * `feature/epic-XXX-<nombre>`: Desarrollo de EPIC nuevos (ejemplo: `feature/epic-002-identity-access`, `feature/epic-003-projects-teams`).
   * `fix/<descripcion>`: Correcciones de errores puntuales que no justifican una rama de EPIC.
   * `docs/<descripcion>`: Cambios documentales independientes y acotados.
   * `hotfix/<descripcion>`: Correcciones urgentes que requieran atención inmediata en producción o rama principal.
2. **Tratamiento de las Ramas Existentes e Historial:**
   * Conservar `epic/EPIC-001-documentation-baseline` como rama histórica del establecimiento de la documentación inicial.
   * No renombrar, eliminar ni recrear las ramas existentes.
   * No modificar el historial Git para adaptarlo a la nueva convención.
   * Aplicar la convención nueva estrictamente a los trabajos futuros.
3. **Flujo de Trabajo Obligatorio:**
   1. Partir de `main` actualizado al iniciar un nuevo EPIC.
   2. Revisar o preparar el cambio correspondiente en OpenSpec antes de implementar cambios de comportamiento.
   3. Crear una rama específica para el EPIC siguiendo la convención (`feature/epic-XXX-<nombre>`).
   4. Trabajar y ejecutar las pruebas correspondientes al alcance aprobado.
   5. Abrir un Pull Request hacia `main`.
   6. Verificar el CI y revisar los cambios antes de integrar.
   7. Exigir autorización humana para aprobar, fusionar o desplegar. La autorización para implementar no implica autorización para ejecutar estas acciones.
4. **Reglas para los Agentes en Git:**
   * No desarrollar funcionalidades directamente sobre `main`.
   * No mezclar EPIC independientes en una misma rama, salvo autorización explícita.
   * No crear ramas innecesarias para cada tarea pequeña; las tareas se gestionan en `tasks.md` del cambio activo.
   * Respetar el alcance aprobado en OpenSpec y las restricciones documentales del proyecto.
   * Si los documentos existentes contradicen esta convención, identificar y corregir únicamente las contradicciones relacionadas, sin reescribir documentos completos ni modificar decisiones arquitectónicas ajenas.
   * Commits atómicos y descriptivos siguiendo Conventional Commits (`feat`, `fix`, `test`, `docs`, `chore`, `refactor`).

---

## Artículo VIII: Frugalidad Operativa, Control de Costos y Enmiendas Constitucionales

1. **Meta de Gasto Operativo:** El proyecto persigue un costo operativo mensual mínimo, idealmente US$0 (con tolerancia de US$0–10 para consumos residuales indispensables) (`docs/07-deployment-and-operations.md` y `README.md`).
2. **Control de Presupuesto:** Los agentes no tienen autorización para incorporar dependencias, proveedores o configuraciones que generen gasto recurrente sin cuantificar el impacto y obtener aprobación previa explícita (`openspec/config.yaml`).
3. **Mecanismo Exclusivo de Enmienda Constitucional:**
   * Esta Constitución únicamente puede ser modificada mediante **revisión y autorización humana documentadas**, aprobadas de manera expresa por el propietario del proyecto.
   * Queda terminantemente prohibido que un agente de IA modifique, flexibilice o reinterprete este documento de forma autónoma o como efecto colateral de un cambio funcional.
