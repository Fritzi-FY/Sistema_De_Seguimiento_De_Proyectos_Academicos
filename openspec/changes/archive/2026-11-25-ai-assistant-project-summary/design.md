# Diseño Técnico: Asistente de IA (Análisis y Resumen Estructurado del Proyecto)

## Contexto y Alcance

Este diseño establece la integración del asistente de IA para el Sistema de Seguimiento de Proyectos Académicos (IS488). El cambio implementa la capacidad de generar un análisis estructurado bajo demanda para un proyecto específico, compuesto por tres secciones clave:
1. **Resumen de avance:** síntesis del progreso general basado en las tareas y columnas del tablero.
2. **Señales de riesgo:** detección de tareas atrasadas, cuellos de botella en columnas o sobrecargas en el flujo de trabajo.
3. **Recomendaciones de próximos pasos:** sugerencias operativas formativas para el equipo.

Se prohíbe taxativamente la interacción en formato de chat libre conversacional continuo, así como cualquier función de calificación, evaluación o emisión de notas académicas, en estricto cumplimiento del Artículo VI.3 de la [Constitución del Proyecto](../../../CONSTITUTION.md) y [ADR-005](../../../ADR/ADR-005-ai-provider.md).

---

## Decisiones Arquitectónicas y Justificación

### 1. Arquitectura Hexagonal y Puerto Desacoplado (`AIProviderPort`)

- **Decisión:** Definir el puerto `AIProviderPort` en `packages/shared/src/ports/ai-provider.port.ts` con tipos independientes de proveedores externos:
  ```typescript
  export interface AICompletionRequest {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
  }

  export interface AICompletionResponse {
    content: string;
    model: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }

  export interface AIProviderPort {
    generateCompletion(
      request: AICompletionRequest,
      options?: { signal?: AbortSignal }
    ): Promise<AICompletionResponse>;
  }
  ```
- **Justificación:** Los casos de uso de la aplicación interactúan únicamente a través de este puerto. Si en el futuro se reemplaza OpenRouter por Cloudflare Workers AI o un modelo local, no se modificará ninguna regla de negocio, contrato OpenAPI ni caso de uso.
- **Alternativa rechazada:** Utilizar el SDK de OpenAI o librerías pesadas (`langchain`, `llamaindex`) directamente en los casos de uso. Rechazado por violar los límites arquitectónicos, inflar el bundle de Cloudflare Workers y acoplar el núcleo a SDKs de terceros.

### 2. Adaptador OpenRouter con `fetch` Nativo

- **Decisión:** Implementar `OpenRouterAIAdapter` en `apps/api/src/infrastructure/adapters/ai/openrouter-ai.adapter.ts` invocando directamente la API REST de OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) mediante la API estándar global `fetch`, compatible de forma nativa con Cloudflare Workers.
- **Autenticación del Proveedor:**
  - Cabecera `Authorization: Bearer ${env.OPENROUTER_API_KEY}`.
  - Cabecera opcional `HTTP-Referer: https://is488.unsch.edu.pe` y `X-Title: IS488 Academic Projects Tracker` conforme a las recomendaciones de OpenRouter.
- **Control de Timeout:** Uso de `AbortController` configurado a 8 segundos. Si la petición excede dicho tiempo, se cancela la conexión inmediatamente para no retener recursos del Worker ni agotar el límite de ejecución.
- **Mapeo de Errores Tipados:**
  - HTTP 401: `AIAuthenticationError` (clave inválida o no configurada).
  - HTTP 402: `AIInsufficientCreditsError` (saldo o cuota agotada).
  - HTTP 429: `AIRateLimitError` (límite de velocidad excedido).
  - HTTP 5xx / Timeout: `AIProviderUnavailableError`.
- **Justificación:** Evita dependencias externas en `package.json`, garantiza compatibilidad total con el runtime edge de Cloudflare Workers y asegura el control granular de errores y cabeceras.

### 3. Doble Adaptador: `FakeAIProvider` para CI y Tests

- **Decisión:** Crear `FakeAIProvider` en `packages/shared/src/testing/fake-ai-provider.ts` que implementa `AIProviderPort` permitiendo:
  - Respuestas predefinidas deterministas en pruebas unitarias y de integración.
  - Simulación de demoras (`latencyMs`), fallos de timeout (`AbortError`), errores HTTP simulados (429, 503) y respuestas de contingencia.
  - Inspección del último `systemPrompt` y `userPrompt` recibido para verificar la sanitización de datos.
- **Justificación:** Cumple el mandamiento constitucional de cero consumo de tokens reales en CI/CD y pruebas automáticas, garantizando tests rápidos, aislados de red y 100% reproducibles.

### 4. Cuotas, Concurrencia y Protección de Tasa con Estado Persistente

- **Decisión:** Implementar control de cuota y concurrencia mediante un puerto persistente `AIQuotaPort`, respaldado en la base de datos PostgreSQL existente. No se utiliza un mapa en memoria como garantía global, ya que el runtime de Cloudflare Workers ejecuta múltiples instancias sin estado compartido y cualquier mecanismo en memoria sería incorrecto bajo concurrencia real.

- **Mecanismo adoptado (PostgreSQL como almacén de cuota):**
  - Se crea una tabla `ai_analysis_quota` con dos funciones:
    1. **Guard de concurrencia:** Registra el inicio de cada análisis en vuelo con una fila `(user_id, project_id, started_at, status = 'in_flight')`. Antes de invocar `AIProviderPort`, el caso de uso intenta insertar esa fila con una restricción `UNIQUE (user_id, project_id)` condicional a `status = 'in_flight'`. Si ya existe una fila activa, la inserción falla y el sistema devuelve `HTTP 429` indicando que el análisis está en curso. Al completar (éxito o fallo), el estado se actualiza a `'completed'` o `'failed'`.
    2. **Ventana deslizante de tasa:** Antes de registrar el intento en vuelo, una consulta `COUNT` atómica evalúa cuántos análisis del proyecto `P` se iniciaron en los últimos 10 minutos (`started_at > NOW() - INTERVAL '10 minutes'`). Si el recuento es ≥ 5, se rechaza con `HTTP 429` indicando que se alcanzó el límite del proyecto. Ambas comprobaciones se ejecutan dentro de la misma transacción de base de datos para garantizar atomicidad.
  - **Limpieza:** Las filas `'in_flight'` huérfanas (timeout o crash) deben considerarse expiradas tras 30 segundos. Una consulta de comprobación excluye filas `in_flight` con `started_at < NOW() - INTERVAL '30 seconds'` al evaluar concurrencia.

- **Puerto adicional necesario:** `AIQuotaPort` en `packages/shared/src/ports/ai-quota.port.ts` con métodos `checkAndAcquire(userId, projectId)` y `release(userId, projectId, outcome)`. Las implementaciones son:
  - `PostgresqlAIQuotaAdapter` para producción y desarrollo (usando SQL dentro de la transacción del request).
  - `InMemoryAIQuotaAdapter` para tests unitarios del caso de uso (sin base de datos).

- **Justificación:** PostgreSQL ya es la única fuente de estado compartido del sistema. Reutilizarlo para la cuota de IA garantiza consistencia entre instancias del Worker sin añadir dependencias externas (Redis, KV Store). Es coherente con el patrón de `internal_notifications` y `task_activity` del proyecto.

- **Alternativa rechazada:** `Map` global o variable en memoria del Worker. Rechazada porque es local a cada instancia, no sobrevive a reinicios y da garantías falsas bajo concurrencia real de múltiples Workers.

### 5. Caso de Uso de Aplicación, Límite de Contexto y Validación de Respuesta

- **Decisión:** Implementar `GenerateProjectAISummaryUseCase` en `apps/api/src/application/use-cases/generate-project-ai-summary.use-case.ts`:

  1. **Comprobación de Acceso:** Verifica la autorización del usuario mediante `MembershipRepositoryPort` (estudiante, colaborador o propietario con membresía activa) o `TeacherProjectScopePort` (docente con asignación académica en el proyecto). Si no tiene permiso, lanza error de autorización (`403 Forbidden` o `404 Not Found`).

  2. **Comprobación de Cuota y Concurrencia:** Invoca `AIQuotaPort.checkAndAcquire(userId, projectId)`. Si la cuota de proyecto (5 en 10 min) o el guard de concurrencia fallan, lanza error de tasa con `HTTP 429` y libera sin invocar al proveedor.

  3. **Extracción, Priorización y Acotación de Datos:** Lee los datos del proyecto mediante `ProjectRepositoryPort`, `BoardRepositoryPort`, `TaskRepositoryPort` y `ReviewRepositoryPort`. Solo extrae:
     - Nombre del proyecto.
     - Columnas del tablero y conteo de tareas por columna.
     - Resumen de tareas mediante **selección determinista acotada** (máximo 50 tareas):
       - Prioridad de selección: tareas activas, bloqueadas, con alta prioridad declarada y con fecha límite en los próximos 14 días.
       - Se excluyen explícitamente tareas con estado completado cuya última actualización sea anterior a 7 días.
       - El prompt de entrada resultante no puede exceder **10.000 caracteres / ~2.500 tokens**. Si la serialización supera el límite, se aplica truncamiento determinista eliminando primero las tareas de menor prioridad.
     - Resumen de revisiones: estado de la última revisión docente (`APPROVED`, `CHANGES_REQUESTED`, `PENDING`).

  4. **Sanitización Estricta:** Prohibido incluir correos electrónicos, identificadores de sesión, contraseñas, hashes, enlaces a evidencias externas con tokens, o datos de otros proyectos.

  5. **Instrucciones del Prompt y Salvaguardas Éticas:**
     - El `systemPrompt` instruye al modelo en un rol de "Asistente de Gestión y Planificación para Proyectos de Ingeniería de Software (IS488)".
     - Regla explícita en el prompt: "Está terminantemente prohibido calificar, evaluar numéricamente o determinar la aprobación académica de este proyecto. Tu objetivo es exclusivamente orientar en la organización operativa, identificar riesgos de cronograma y sugerir próximos pasos de desarrollo".
     - El prompt solicita al modelo una **respuesta JSON** con exactamente tres campos de primer nivel: `progressSummary` (string), `riskSignals` (array of strings) y `nextSteps` (array of strings). Se utilizará el parámetro `response_format: { type: "json_object" }` cuando OpenRouter lo soporte para el modelo configurado.

  6. **Validación Estructural de la Respuesta:**
     - El adaptador devuelve el campo `content` crudo de la respuesta del modelo.
     - El caso de uso valida esa cadena con el esquema Zod interno `AIModelPayloadSchema`:
       ```typescript
       const AIModelPayloadSchema = z.object({
         progressSummary: z.string().min(1),
         riskSignals: z.array(z.string()),
         nextSteps: z.array(z.string()),
       });
       ```
     - Si la validación falla (JSON inválido, campos ausentes o tipos incorrectos), se lanza `AIInvalidResponseError` y se responde con **HTTP 502 Bad Gateway** con un mensaje seguro y sin filtrar el contenido del modelo ni el prompt.
     - **El campo `disclaimer`** es inyectado directamente por el caso de uso desde una constante del servidor:
       `"Orientación formativa generada por IA. No constituye calificación ni evaluación académica oficial."`.
       No proviene del modelo ni puede ser sobreescrito por la salida del proveedor.

  7. **Liberación de Cuota:** Tras completar (éxito, error del proveedor o timeout), el caso de uso invoca `AIQuotaPort.release(userId, projectId, outcome)` para actualizar el estado de la fila de concurrencia en la base de datos.

- **Justificación:** Confinamiento seguro por proyecto, estricto mínimo privilegio de datos expuestos al modelo, salvaguardas éticas verificables en el servidor y defensa ante respuestas malformadas del proveedor.

### 6. Contrato de API y Endpoint HTTP

- **Decisión:** Exponer `POST /api/projects/:projectId/ai/analysis` mediante Hono en `apps/api/src/infrastructure/http/routes/ai-assistant.route.ts`.
- **Esquema de Entrada (`AIAnalysisRequestSchema`):**
  - Parámetro de ruta: `projectId` (UUID válido).
  - Cuerpo opcional (vacío por defecto, no requiere payload para análisis estándar; admite selector opcional de enfoque: `"full"` | `"risks"` | `"progress"`).
- **Esquema de Salida (`AIAnalysisResponseSchema`):**
  ```typescript
  export const AIAnalysisResponseSchema = z.object({
    projectId: z.string().uuid(),
    analysis: z.object({
      progressSummary: z.string(),
      riskSignals: z.array(z.string()),
      nextSteps: z.array(z.string()),
    }),
    meta: z.object({
      model: z.string(),
      generatedAt: z.string().datetime(),
      disclaimer: z.string(), // valor constante inyectado por el servidor, nunca por el modelo
    }),
  });
  ```
- **Códigos de Respuesta:**
  - `200 OK`: Análisis generado exitosamente.
  - `401 Unauthorized`: Sin sesión activa.
  - `403 Forbidden`: Usuario sin membresía ni asignación docente en el proyecto.
  - `404 Not Found`: Proyecto no encontrado.
  - `429 Too Many Requests`: Cuota del proyecto alcanzada (5/10 min) o análisis ya en curso para ese usuario y proyecto.
  - `502 Bad Gateway`: El proveedor respondió con contenido malformado o no parseable.
  - `503 Service Unavailable`: Asistente de IA deshabilitado, proveedor sin créditos o indisponible (con mensaje amigable al usuario).
  - `504 Gateway Timeout`: Tiempo de espera del proveedor agotado (8 s).

| **API (Infraestructura — Cuota)** | `apps/api/src/infrastructure/adapters/ai/postgresql-ai-quota.adapter.ts` | Crear | Adaptador PostgreSQL para `AIQuotaPort` con guard de concurrencia y ventana deslizante. |

### 7. Componentes de Interfaz de Usuario (`apps/web`)

- **Decisión:**
  - En `apps/web/src/components/ProjectDetail.tsx`, agregar un botón accesible: "Asistente IA" (con icono de Sparkles / Lucide) junto a los controles de vista de tareas.
  - Crear `ProjectAIAssistantModal.tsx`:
    - Diálogo modal con `aria-labelledby`, foco accesible y cierre mediante `Escape`.
    - Botón de acción: "Generar Análisis".
    - Estados:
      - *Idle:* Presenta el propósito del asistente y las tres áreas de análisis.
      - *Loading:* Indicador visual de generación (spinner accesible con `aria-live="polite"` y mensaje orientativo).
      - *Success:* Despliega las tarjetas de Resumen de Avance, Señales de Riesgo y Próximos Pasos, acompañadas en la cabecera por un banner visible y contrastado con la advertencia de no vinculación académica.
      - *Error / Degradación:* Si el servicio no está disponible o el proveedor falla, muestra una alerta accesible informando la indisponibilidad temporal sin bloquear ninguna otra acción del tablero.
- **Justificación:** Interacción bajo demanda, limpia, accesible por teclado y con plena transparencia ética hacia los estudiantes.

---

## Archivos y Capas Afectadas

| Capa | Archivo | Acción | Propósito |
|---|---|---|---|
| **Shared (Puertos)** | `packages/shared/src/ports/ai-provider.port.ts` | Crear | Definición de interfaz `AIProviderPort` y tipos. |
| **Shared (Puertos)** | `packages/shared/src/ports/ai-quota.port.ts` | Crear | Definición de interfaz `AIQuotaPort` con `checkAndAcquire` y `release`. |
| **Shared (Contratos)** | `packages/shared/src/contracts/ai-assistant.contract.ts` | Crear | Esquemas Zod de petición, respuesta, metadatos y `AIModelPayloadSchema` interno. |
| **Shared (Testing)** | `packages/shared/src/testing/fake-ai-provider.ts` | Crear | Adaptador fake para pruebas sin red. |
| **Shared (Testing)** | `packages/shared/src/testing/in-memory-ai-quota.adapter.ts` | Crear | Adaptador en memoria de `AIQuotaPort` para tests unitarios. |
| **Shared (Index)** | `packages/shared/src/index.ts` | Modificar | Exportar puertos, contratos y adaptadores de testing. |
| **API (Aplicación)** | `apps/api/src/application/use-cases/generate-project-ai-summary.use-case.ts` | Crear | Caso de uso con validación de membresía, cuota persistente, selección acotada de contexto, salvaguardas éticas y validación JSON. |
| **API (Infraestructura — IA)** | `apps/api/src/infrastructure/adapters/ai/openrouter-ai.adapter.ts` | Crear | Adaptador HTTP hacia OpenRouter usando `fetch` y `AbortController`. |
| **API (Infraestructura — Cuota)** | `apps/api/src/infrastructure/adapters/ai/postgresql-ai-quota.adapter.ts` | Crear | Adaptador PostgreSQL para `AIQuotaPort` con guard de concurrencia y ventana deslizante. |
| **API (Rutas)** | `apps/api/src/infrastructure/http/routes/ai-assistant.route.ts` | Crear | Router Hono para `POST /api/projects/:projectId/ai/analysis`. |
| **API (OpenAPI)** | `apps/api/src/infrastructure/openapi/openapi.contract.ts` | Modificar | Registrar endpoint y esquemas en la especificación OpenAPI. |
| **API (Wiring)** | `apps/api/src/infrastructure/http/app.ts` | Modificar | Inyectar `AIProviderPort`, `AIQuotaPort` y registrar ruta en la app principal. |
| **Web (Servicios)** | `apps/web/src/services/ai-assistant.service.ts` | Crear | Cliente HTTP frontend para invocar el análisis de IA. |
| **Web (Componentes)** | `apps/web/src/components/ProjectAIAssistantModal.tsx` | Crear | Componente modal con estados de carga, error y advertencia. |
| **Web (Integración)** | `apps/web/src/components/ProjectDetail.tsx` | Modificar | Botón disparador del modal en el encabezado de herramientas. |
| **Entorno** | `.env.example` | Modificar | Documentar variables `OPENROUTER_API_KEY` y `OPENROUTER_MODEL`. |

---

## Estrategia de Pruebas y Graduación de Riesgo

1. **Unitarias de Contratos (`packages/shared`):**
   - Validación de esquemas Zod (`ai-assistant.contract.test.ts`): validar respuestas válidas, rechazo de formatos incorrectos, tipado correcto del `AIModelPayloadSchema` y que el campo `disclaimer` es obligatorio y de valor constante.
   - Comportamiento del `InMemoryAIQuotaAdapter`: verificar guard de concurrencia y rechazo tras 5 solicitudes en ventana.
2. **Unitarias de Caso de Uso (`apps/api`):**
   - `generate-project-ai-summary.use-case.test.ts`:
     - Caso exitoso: genera análisis estructurado en tres secciones con `disclaimer` inyectado por el servidor.
     - Caso no autorizado: rechazo con 403 si el usuario no es miembro activo ni docente asignado.
     - Caso proyecto inexistente: 404 Not Found.
     - Sanitización: verificar que en el prompt enviado a `FakeAIProvider` no existen credenciales ni datos externos.
     - Acotación de contexto: verificar que con más de 50 tareas se seleccionan exactamente 50 y se excluyen las completadas hace más de 7 días; verificar que la longitud del prompt no excede 10.000 caracteres.
     - Salvaguarda ética: verificar que el `systemPrompt` incluye la prohibición de emitir calificaciones y que el `disclaimer` del payload es la constante del servidor.
     - Cuota: verificar rechazo 429 cuando `InMemoryAIQuotaAdapter` reporta concurrencia activa o cuota superada; verificar que `release` se llama tanto en éxito como en fallo.
     - Validación JSON: simular respuesta malformada desde `FakeAIProvider` y verificar que se lanza `AIInvalidResponseError` con respuesta 502.
     - Manejo de fallos del proveedor: timeout, proveedor sin saldo (402), rate limit (429) y proveedor no configurado (503).
3. **Unitarias de Adaptador (`apps/api`):**
   - `openrouter-ai.adapter.test.ts`: mock global de `fetch` para verificar serialización de petición, cabeceras (`Authorization`, `HTTP-Referer`), uso de `response_format: { type: "json_object" }`, manejo de `AbortSignal` por timeout y conversión de códigos de estado de OpenRouter a errores tipados.
   - `postgresql-ai-quota.adapter.test.ts`: prueba de integración SQL sobre base de datos de test; verificar inserción atómica de fila en vuelo, rechazo de concurrencia, recuento de ventana deslizante de 10 minutos y limpieza de filas expiradas tras 30 segundos.
4. **Pruebas de Integración y Contrato OpenAPI (`apps/api`):**
   - `ai-assistant.route.test.ts`: integración sobre la aplicación Hono con autenticación simulada, probando códigos 200, 401, 403, 404, 429 (cuota y concurrencia), 502 (payload inválido) y 503.
   - `ai-assistant.openapi.test.ts`: verificación de que la especificación OpenAPI valida correctamente el nuevo path y esquemas.
5. **Pruebas de Componentes Frontend (`apps/web`):**
   - `ProjectAIAssistantModal.test.tsx`:
     - Renderizado de estados inicial, cargando (spinner accesible con `aria-live`), éxito (visualización de secciones y banner de advertencia permanente) y error controlado (429 y 503).
     - Accesibilidad de teclado (cierre con `Escape`, navegación de foco).
     - Validación de que no existen campos de entrada para chat libre ni elementos de calificación académica.
