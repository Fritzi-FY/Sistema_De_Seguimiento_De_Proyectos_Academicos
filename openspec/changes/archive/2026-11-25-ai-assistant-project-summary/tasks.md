# Tareas de Implementación: Asistente de IA (Análisis y Resumen Estructurado del Proyecto)

## Bloque 1: Contratos, Puertos y Adaptadores Fake/In-Memory en `@is488/shared`

- [x] 1.1 Definir interfaces de abstracción `AICompletionRequest`, `AICompletionResponse` y el puerto `AIProviderPort` en `packages/shared/src/ports/ai-provider.port.ts`.
  - **Criterio:** Compilar sin errores TypeScript; el puerto no importa SDKs de terceros ni tipos de red.
- [x] 1.2 Definir el puerto `AIQuotaPort` con métodos `checkAndAcquire(userId, projectId): Promise<{ allowed: boolean; reason?: string }>` y `release(userId, projectId, outcome: 'success' | 'error' | 'timeout'): Promise<void>` en `packages/shared/src/ports/ai-quota.port.ts`.
  - **Criterio:** Compilar sin errores; los métodos no dependen de PostgreSQL ni de ninguna implementación concreta.
- [x] 1.3 Definir esquemas Zod `AIAnalysisRequestSchema`, `AIAnalysisResponseSchema`, `AIModelPayloadSchema` (esquema interno de validación de respuesta cruda del modelo) y tipos asociados en `packages/shared/src/contracts/ai-assistant.contract.ts`.
  - **Criterio:** `AIAnalysisResponseSchema` incluye `analysis.progressSummary`, `analysis.riskSignals`, `analysis.nextSteps` y `meta.disclaimer`. `AIModelPayloadSchema` valida los tres campos mínimos del JSON devuelto por el modelo.
- [x] 1.4 Implementar `FakeAIProvider` en `packages/shared/src/testing/fake-ai-provider.ts` con soporte para: respuestas predefinidas deterministas, simulación de fallas de red, timeout (`AbortError`) e inspección del último `systemPrompt` y `userPrompt` recibido.
  - **Criterio:** `FakeAIProvider` implementa `AIProviderPort`; compilar; no hace llamadas de red reales.
- [x] 1.5 Implementar `InMemoryAIQuotaAdapter` en `packages/shared/src/testing/in-memory-ai-quota.adapter.ts` que: registra solicitudes en vuelo por `(userId, projectId)`, rechaza segundas solicitudes concurrentes y rechaza cuando el recuento supera 5 en 10 minutos.
  - **Criterio:** `InMemoryAIQuotaAdapter` implementa `AIQuotaPort`; sin dependencias externas.
- [x] 1.6 Exportar los nuevos contratos, puertos, `FakeAIProvider` e `InMemoryAIQuotaAdapter` en `packages/shared/src/index.ts`.
  - **Criterio:** Importaciones funcionales desde `@is488/shared` sin errores de resolución.
- [x] 1.7 Crear y ejecutar pruebas unitarias en `packages/shared/src/contracts/ai-assistant.contract.test.ts`:
  - Validar payload de respuesta conforme al esquema.
  - Rechazar payload con campos ausentes o de tipo incorrecto.
  - Verificar que el campo `disclaimer` es obligatorio y no puede ser vacío.
  - Verificar comportamiento del `InMemoryAIQuotaAdapter`: guard de concurrencia y rechazo tras 5 solicitudes en la ventana.
  - **Criterio:** Suite ejecuta en < 2 s; 100% de aserciones pasan sin conexión de red.

## Bloque 2: Caso de Uso de Aplicación en `apps/api`

- [x] 2.1 Implementar `GenerateProjectAISummaryUseCase` en `apps/api/src/application/use-cases/generate-project-ai-summary.use-case.ts`, verificando autorización de acceso mediante `MembershipRepositoryPort` o `TeacherProjectScopePort`.
  - **Criterio:** Rechazo explícito (403 o 404) antes de extraer datos o invocar al proveedor cuando el usuario no tiene acceso.
- [x] 2.2 Integrar `AIQuotaPort.checkAndAcquire` en el caso de uso, antes de extraer datos del proyecto o invocar `AIProviderPort`. Implementar llamada a `AIQuotaPort.release` al finalizar en bloque `finally`.
  - **Criterio:** Si la cuota del proyecto (5/10 min) está agotada o hay un análisis en vuelo del mismo usuario/proyecto, el caso de uso devuelve error de tasa sin consultar a `AIProviderPort`; `release` se invoca siempre.
- [x] 2.3 Implementar la extracción, priorización y acotación determinista de contexto: selección de máximo 50 tareas (priorizando activas, bloqueadas, alta prioridad, con fecha límite próxima; excluyendo completadas hace > 7 días); truncamiento si el prompt supera 10.000 caracteres (~2.500 tokens).
  - **Criterio:** Con un proyecto de 200 tareas, el prompt no supera 10.000 caracteres; con mezcla de completadas antiguas y activas, se excluyen las completadas > 7 días; la selección es determinista para la misma entrada.
- [x] 2.4 Redactar el `systemPrompt` con instrucciones de rol formativo, prohibición explícita de emitir calificaciones y solicitud de respuesta JSON estructurada con exactamente tres campos: `progressSummary`, `riskSignals`, `nextSteps`.
  - **Criterio:** El prompt no contiene datos de sesión, correos ni tokens; incluye la prohibición de calificación; exige formato JSON con los tres campos nombrados.
- [x] 2.5 Implementar la validación de respuesta con `AIModelPayloadSchema`; inyectar el `disclaimer` desde constante de servidor; lanzar `AIInvalidResponseError` para payload malformado.
  - **Criterio:** Respuesta malformada o JSON inválido del proveedor produce `AIInvalidResponseError`; `disclaimer` del payload de respuesta es el valor constante del servidor, no el que devuelve el modelo.
- [x] 2.6 Crear y ejecutar suite exhaustiva de pruebas unitarias en `apps/api/src/application/use-cases/generate-project-ai-summary.use-case.test.ts` con `FakeAIProvider` e `InMemoryAIQuotaAdapter`:
  - Éxito con respuesta estructurada y `disclaimer` inyectado por el servidor.
  - Rechazo 403 sin membresía activa.
  - Rechazo 404 con proyecto inexistente.
  - Verificación de sanitización: `systemPrompt` inspeccionado no contiene credenciales ni datos ajenos al proyecto.
  - Verificación de acotación: más de 50 tareas → exactamente 50 seleccionadas; completadas > 7 días excluidas.
  - Verificación de cuota: rechazo 429 con concurrencia activa; rechazo 429 con cuota superada; `release` invocado en éxito y en fallo.
  - Verificación de validación JSON: respuesta malformada → `AIInvalidResponseError`.
  - Degradación: timeout → error controlado; proveedor no configurado → 503; rate limit externo (402, 429) → error mapeado.
  - **Criterio:** Suite ejecuta sin conexión real; todas las aserciones pasan.

## Bloque 3: Adaptadores de Infraestructura en `apps/api`

- [x] 3.1 Implementar `OpenRouterAIAdapter` en `apps/api/src/infrastructure/adapters/ai/openrouter-ai.adapter.ts` usando `fetch` nativo con cabeceras `Authorization` y `HTTP-Referer`, parámetro `max_tokens: 600`, temperatura 0.3 y `response_format: { type: "json_object" }` cuando el modelo lo soporte.
  - **Criterio:** No importa SDKs externos; implementa `AIProviderPort`; compilar sin errores.
- [x] 3.2 Implementar `AbortController` con timeout de exactamente 8 segundos en `OpenRouterAIAdapter`; mapear expiración a `AIProviderUnavailableError`.
  - **Criterio:** Mock de `fetch` que nunca resuelve → el adaptador rechaza con `AIProviderUnavailableError` antes de 8.5 s en test.
- [x] 3.3 Mapear códigos HTTP de OpenRouter a errores tipados: `AIAuthenticationError` (401), `AIInsufficientCreditsError` (402), `AIRateLimitError` (429), `AIProviderUnavailableError` (5xx). Prohibido exponer el cuerpo crudo de errores del proveedor.
  - **Criterio:** Mock con cada código de error → excepción tipada correcta; sin filtración de headers ni cuerpos de respuesta del proveedor.
- [x] 3.4 Implementar `PostgresqlAIQuotaAdapter` en `apps/api/src/infrastructure/adapters/ai/postgresql-ai-quota.adapter.ts` con:
  - Guard de concurrencia: inserción atómica de fila `'in_flight'` con constraint `UNIQUE (user_id, project_id)` condicional; fila expirada si `started_at < NOW() - 30s`.
  - Ventana deslizante: `COUNT(*)` atómico de los últimos 10 minutos del proyecto.
  - Método `release`: actualizar `status` a `'completed'` o `'failed'`.
  - **Criterio:** Las comprobaciones de concurrencia y ventana usan la misma sesión de base de datos existente; no introduce nuevas dependencias.
- [x] 3.5 Crear y ejecutar pruebas unitarias del adaptador de proveedor en `apps/api/src/infrastructure/adapters/ai/openrouter-ai.adapter.test.ts` con mock de `fetch`:
  - Construcción correcta de cabeceras y body.
  - Manejo de `AbortSignal`.
  - Mapeo de cada código de error al tipo de excepción correspondiente.
  - **Criterio:** 100% de aserciones pasan sin llamadas de red reales.
- [x] 3.6 Crear y ejecutar prueba de integración SQL de `PostgresqlAIQuotaAdapter` en `apps/api/src/infrastructure/adapters/ai/postgresql-ai-quota.adapter.test.ts` sobre base de datos de test aislada:
  - `checkAndAcquire` rechaza una segunda solicitud concurrente del mismo usuario/proyecto.
  - `checkAndAcquire` rechaza cuando el recuento del proyecto supera 5 en los últimos 10 minutos.
  - `release` actualiza el estado correctamente.
  - Fila expirada (> 30 s) no bloquea nuevas solicitudes.
  - **Criterio:** Prueba ejecuta sobre base de datos de test; pasa de forma aislada.

## Bloque 4: Ruta HTTP, Contrato OpenAPI y Cableado en `apps/api`

- [x] 4.1 Implementar router Hono para el endpoint `POST /api/projects/:projectId/ai/analysis` en `apps/api/src/infrastructure/http/routes/ai-assistant.route.ts` con middleware de autenticación existente y validación de entrada por esquema Zod.
  - **Criterio:** La ruta rechaza peticiones sin sesión (401) o con `projectId` inválido (400) antes de invocar el caso de uso.
- [x] 4.2 Registrar el nuevo path, esquemas de entrada y respuesta en `apps/api/src/infrastructure/openapi/openapi.contract.ts`.
  - **Criterio:** La especificación OpenAPI generada documenta los códigos 200, 401, 403, 404, 429, 502, 503 y 504.
- [x] 4.3 Integrar la ruta e inyectar `AIProviderPort` y `AIQuotaPort` en `apps/api/src/infrastructure/http/app.ts`.
  - **Criterio:** En modo test se inyectan `FakeAIProvider` e `InMemoryAIQuotaAdapter`; en producción `OpenRouterAIAdapter` y `PostgresqlAIQuotaAdapter`.
- [x] 4.4 Crear y ejecutar pruebas de integración HTTP en `apps/api/src/infrastructure/http/routes/ai-assistant.route.test.ts`:
  - `200 OK` con análisis estructurado y `disclaimer` inyectado.
  - `401 Unauthorized` sin sesión.
  - `403 Forbidden` sin membresía ni asignación.
  - `404 Not Found` con proyecto inexistente.
  - `429 Too Many Requests` por cuota de proyecto superada.
  - `429 Too Many Requests` por análisis en vuelo del mismo usuario/proyecto.
  - `502 Bad Gateway` por respuesta malformada del modelo.
  - `503 Service Unavailable` por proveedor no configurado.
  - **Criterio:** Todos los códigos verificados; sin fugas de datos sensibles en respuestas de error.
- [x] 4.5 Crear y ejecutar prueba de conformidad OpenAPI en `apps/api/src/infrastructure/openapi/ai-assistant.openapi.test.ts`.
  - **Criterio:** El path y esquemas del contrato OpenAPI generado validan correctamente.

## Bloque 5: Interfaz de Usuario y Cliente Frontend en `apps/web`

- [x] 5.1 Implementar `ai-assistant.service.ts` en `apps/web/src/services/` para invocar `POST /api/projects/:projectId/ai/analysis` y mapear las respuestas de error (429, 502, 503) a mensajes amigables de usuario.
  - **Criterio:** El servicio no incluye lógica de presentación; retorna tipos tipados del contrato compartido.
- [x] 5.2 Implementar `ProjectAIAssistantModal.tsx` en `apps/web/src/components/` con gestión de estados: idle, loading (spinner con `aria-live="polite"`), success (tres secciones + banner de advertencia permanente e ineludible) y error/degradación.
  - **Criterio:** El banner de advertencia siempre visible en estado `success`; sin campos de entrada de texto libre; sin controles de calificación.
- [x] 5.3 El componente modal gestiona correctamente el mensaje de error para HTTP 429 (cuota agotada o análisis en curso), HTTP 502 (respuesta inválida del modelo) y HTTP 503 (asistente no disponible) con texto amigable y sin exponer detalles internos.
  - **Criterio:** Cada código de error produce un mensaje descriptivo específico y accesible (rol `alert`).
- [x] 5.4 Integrar el botón disparador del asistente en `apps/web/src/components/ProjectDetail.tsx` con soporte de teclado (`Enter`/`Space`), etiqueta accesible y visibilidad según el rol del usuario (solo miembros activos y docentes asignados).
  - **Criterio:** El botón no aparece ni responde para usuarios sin autorización en el proyecto.
- [x] 5.5 Crear y ejecutar pruebas de componentes en `apps/web/src/components/ProjectAIAssistantModal.test.tsx`:
  - Renderizado de cada estado (idle, loading, success, error).
  - Banner de advertencia presente y visible en estado success.
  - Accesibilidad de teclado: cierre con `Escape`, foco inicial correcto, `aria-live` en spinner.
  - Respuesta a error 429 (cuota), 502 (modelo inválido) y 503 (no disponible) con mensajes específicos.
  - Ausencia de campos de texto libre y controles de calificación.
  - **Criterio:** Suite ejecuta sin servidor real; todas las aserciones pasan.

## Bloque 6: Verificación Integral, Calidad de Plataforma y Preparación de Cierre

- [x] 6.1 Actualizar `.env.example` documentando `OPENROUTER_API_KEY` (clave para producción, nunca comprometer) y `OPENROUTER_MODEL` (nombre del modelo, ej. `google/gemini-2.0-flash-lite:free`) sin exponer valores reales.
  - **Criterio:** `.env.example` no contiene claves reales; los nombres de variables son correctos y tienen comentarios explicativos.
- [x] 6.2 Ejecutar suite completa de calidad técnica en los tres paquetes: `npm run lint`, `npm run typecheck` y `npm test` en `@is488/shared`, `apps/api` y `apps/web`.
  - **Criterio:** Cero errores de linter; cero errores TypeScript; todas las suites pasan.
- [x] 6.3 Ejecutar verificación de build de producción: `npm run build`.
  - **Criterio:** Build completa sin errores; sin advertencias críticas nuevas de Rollup.
- [x] 6.4 Verificar que las funciones de tablero Kanban, tareas, membresías y revisiones docentes continúan funcionando correctamente cuando el proveedor de IA falla o `OPENROUTER_API_KEY` no está configurada (pruebas existentes deben seguir pasando sin modificación).
  - **Criterio:** Suite de pruebas preexistentes de EPIC-002 a EPIC-007 pasa intacta.
