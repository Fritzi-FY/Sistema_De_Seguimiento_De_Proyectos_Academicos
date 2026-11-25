# Asistente de IA: Análisis y Resumen Estructurado del Proyecto

## Why

En el desarrollo de proyectos académicos de la asignatura IS488, los estudiantes y docentes requieren una visión sintetizada y oportuna sobre el estado general del trabajo, las tareas atrasadas o bloqueadas y las prioridades de ejecución. Actualmente, esta evaluación exige navegar manualmente entre columnas, tareas e historiales de revisión.

El requisito canónico [AI Assistant](../../specs/ai-assistant/spec.md), el registro [ADR-005](../../../ADR/ADR-005-ai-provider.md) y la [Constitución del Proyecto (Artículo VI.3)](../../../CONSTITUTION.md) establecen la necesidad de proveer asistencia mediante un puerto desacoplado (`AIProviderPort`) con OpenRouter como adaptador inicial, restringido a orientaciones operativas sin facultades de evaluación o calificación académica.

Valor académico: fomentar la autorregulación estudiantil y facilitar la labor de supervisión docente mediante resúmenes de avance, detección de riesgos en cronograma y sugerencias de próximos pasos estructurados, salvaguardando la privacidad del proyecto y manteniendo la autoridad evaluativa exclusivamente en el docente humano.

## What Changes

- **Puerto desacoplado y contratos compartidos:** Crear `AIProviderPort`, esquemas Zod de entrada/salida (`ai-assistant.contract.ts`) y la clase `FakeAIProvider` para pruebas deterministas sin conexión a red en `@is488/shared`.
- **Adaptador OpenRouter para Cloudflare Workers:** Implementar `OpenRouterAIAdapter` en `apps/api` utilizando la API estándar `fetch` con cabecera `Authorization`, control estricto de timeout mediante `AbortController` (8 segundos), límites de tokens y mapeo seguro de errores HTTP (401, 402, 429, 5xx) a excepciones tipadas del dominio.
- **Caso de uso de análisis autorizado:** Implementar `GenerateProjectAISummaryUseCase` en `apps/api` con validación estricta de membresía activa o asignación docente antes de acceder a datos o invocar al proveedor.
- **Sanitización y minimización de datos:** El caso de uso compila exclusivamente los datos indispensables del proyecto en consulta (títulos de tareas, columnas, prioridades, fechas límite y estado de revisiones), prohibiendo el envío de contraseñas, tokens, credenciales, correos de terceros o datos de otros proyectos.
- **Salvaguardas éticas verificables:** Regla estricta contra calificación o evaluación académica. Si la solicitud busca emitir notas o juzgar la aprobación de un trabajo, el sistema rechaza o reorienta la respuesta hacia recomendaciones metodológicas. Toda respuesta incluye una advertencia explícita de "asistencia no vinculante generada por IA".
- **Ruta HTTP y Contrato OpenAPI:** Exponer el endpoint autenticado `POST /api/projects/:projectId/ai/analysis` en `apps/api`, documentado y validado en `openapi.contract.ts`.
- **Interfaz de usuario accesible:** Diseñar e incorporar en `apps/web` el componente `ProjectAIAssistantModal.tsx` y el servicio `ai-assistant.service.ts`, con interacción estructurada bajo demanda (sin chat libre), estados de carga accesibles por teclado, manejo limpio de errores o indisponibilidad del proveedor, y advertencia visible destacada.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ai-assistant`: precisar el análisis estructurado bajo demanda (resumen de avance, señales de riesgo y próximos pasos), la abstracción de proveedor con `AIProviderPort`, la sanitización estricta por proyecto, los límites de costos/timeout/tokens, la degradación controlada y la prohibición inmutable de emitir notas o calificaciones.

## Impact

- **Código y capas afectadas:**
  - `@is488/shared`: nuevos puertos, esquemas Zod, tipos de dominio y `FakeAIProvider`.
  - `apps/api`: caso de uso de aplicación, adaptador OpenRouter, ruta HTTP Hono, middlewares de autenticación/scope y contrato OpenAPI.
  - `apps/web`: servicio cliente HTTP, modal de asistencia bajo demanda integrado en `ProjectDetail.tsx`, estilos y pruebas de componentes.
- **Costo económico:** Objetivo US$ 0. Operación dentro del nivel gratuito de OpenRouter (modelos `:free` o cuotas de prueba). Sin compromisos de gasto recurrente ni suscripciones fijas.
- **Degradación:** Si OpenRouter no está configurado, excede su cuota o tiene fallas de red, la plataforma devuelve un error controlado descriptivo (HTTP 503/429) y el 100% de las funciones operativas del sistema (tablero Kanban, tareas, membresías, revisiones docentes) continúan funcionando sin interrupción.
- **Fuera de alcance:** Chat conversacional libre continuo, calificación automática de tareas o proyectos, almacenamiento permanente de prompts en base de datos, análisis de repositorios externos (GitHub) o procesamiento de archivos binarios.

## Authorization

Planificación OpenSpec de Niveles B y C preparada en la rama `feature/epic-008-ai-assistant`, originada desde `main` actualizado (`a1b0b62618e3b30b0467fe38161272c257ccf5c3`). Se generan exclusivamente los artefactos de planificación (`proposal.md`, `design.md`, `tasks.md` y `specs/ai-assistant/spec.md`). La implementación en código ejecutable requiere la compuerta de aprobación humana explícita (Nivel D).
