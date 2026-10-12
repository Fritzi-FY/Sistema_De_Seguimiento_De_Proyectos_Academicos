## Why

El proyecto IS488 ha establecido exitosamente su base técnica ejecutable (`foundation-setup`), con un monorepo modular, herramientas de tipado y calidad, y un endpoint técnico de diagnóstico. No obstante, el sistema aún no implementa ninguna entidad de negocio académica ni permite realizar seguimiento de proyectos reales.

Para avanzar hacia el primer flujo vertical demostrable fijado en el Roadmap institucional ([docs/09-epic-roadmap.md](../../../docs/09-epic-roadmap.md) §9.2), es indispensable materializar la entidad raíz del dominio: el **Proyecto Académico**. Sin proyectos registrados en el sistema, resulta imposible crear tableros Kanban, organizar tareas, registrar avances o emitir revisiones docentes.

Implementar la gestión base de proyectos (`projects-management-baseline`) resuelve esta necesidad de forma controlada y segura:
1. Proporciona valor académico inmediato al permitir que los estudiantes registren proyectos con título, descripción, curso y cronograma estimado, y consulten sus proyectos activos.
2. Consolida la arquitectura hexagonal estableciendo el primer puerto de persistencia de dominio (`ProjectRepositoryPort`), respaldado inicialmente por un adaptador en memoria (`InMemoryProjectRepository`) que permite verificar la lógica sin costes de infraestructura ni dependencias externas.
3. Prepara el diseño para la posterior integración de PostgreSQL/Drizzle ORM tras completar el spike técnico estipulado en el ADR-003.
4. Introduce un mecanismo explícito de contexto de identidad de desarrollo (`X-Dev-User-Id`, `X-Dev-User-Role`) restringido al entorno local, permitiendo simular sesiones estudiantiles y docentes sin bloquear el desarrollo a la espera de credenciales institucionales de Google OAuth.

## What Changes

- **Contratos y Dominio en `@is488/shared`:**
  - Definición de la entidad de dominio `Project` con campos requeridos por el modelo de datos ([docs/04-data-model.md](../../../docs/04-data-model.md)): `id` (UUID v4), `title`, `description`, `courseCode`, `status` (`active` | `archived`), `startDate`, `targetDate`, `creatorId`, `createdAt`, `updatedAt`.
  - Definición de la interfaz del puerto driven `ProjectRepositoryPort` (`save`, `findById`, `findAll`, `findByUser`).
  - Esquemas Zod estrictos de validación: `CreateProjectRequestSchema`, `ProjectResponseSchema`, `ProjectListResponseSchema`, con reglas rigurosas para longitud de textos y coherencia de fechas ISO-8601 UTC.
- **Lógica de Aplicación y Persistencia en `apps/api`:**
  - Implementación de casos de uso desacoplados: `CreateProjectUseCase` (valida negocio, asigna creador y persiste) y `ListProjectsUseCase` (aplica reglas de aislamiento y alcance por usuario).
  - Implementación del adaptador de persistencia en memoria `InMemoryProjectRepository`, documentando que opera como almacén transitorio y volátil de desarrollo.
  - Middleware de identidad de desarrollo que lee `X-Dev-User-Id` y `X-Dev-User-Role` únicamente si `NODE_ENV === 'development'`. Si se detecta un intento de uso en producción, se rechaza inmediatamente con HTTP 401 Unauthorized.
  - Endpoints HTTP en Hono: `POST /api/projects` (creación) y `GET /api/projects` (listado con aislamiento de usuario), con manejo estricto de errores (400 Bad Request, 401 Unauthorized, 405 Method Not Allowed).
  - Ampliación de la especificación OpenAPI 3.1 en [openapi.contract.ts](../../../apps/api/src/infrastructure/openapi/openapi.contract.ts) documentando los nuevos endpoints y respuestas.
- **Interfaz de Usuario en `apps/web`:**
  - Cliente de consumo `ProjectService` tipado a través de `@is488/shared` y enrutado mediante el proxy de Vite.
  - Componente de interfaz de proyectos: visualización de proyectos en tarjetas, estados de carga, estado vacío guiado y diálogo/formulario de creación con validación reactiva de campos y fechas.
- **Exclusiones estrictas:**
  - No incluye Google OAuth real ni Better Auth (diferido a spike).
  - No incluye conexión a base de datos externa ni provisionamiento en la nube (diferido a spike de ADR-003).
  - No incluye tableros Kanban, tareas, columnas dinámicas ni invocaciones a modelos de IA (OpenRouter).

## Capabilities

### New Capabilities

*(Ninguna nueva capacidad canónica; el cambio implementa requisitos dentro de la capacidad existente `projects-teams`).*

### Modified Capabilities

- `projects-teams`: Incorpora especificaciones formales y escenarios ejecutables para el registro de proyectos, validaciones de coherencia temporal de fechas, aislamiento de acceso entre usuarios (estudiante vs. docente), y salvaguardas de seguridad para el contexto de identidad simulada en entornos de desarrollo.

## Impact

- **Código y estructura:** Ampliación de `@is488/shared` (dominio y esquemas), `apps/api` (casos de uso, repositorio en memoria y rutas Hono) y `apps/web` (servicio y componentes de UI).
- **APIs y Contratos:** Nuevos endpoints expuestos bajo `/api/projects` documentados en OpenAPI 3.1.
- **Seguridad y Privacidad:** Reglas de aislamiento a nivel de servidor (un estudiante solo accede a sus proyectos; un docente solo a su ámbito asignado; rechazo de cabeceras de depuración en producción).
- **Presupuesto y Operaciones:** Coste directo de US$0. El incremento opera 100% de manera autónoma y local en memoria sin dependencias de servicios externos ni costes de infraestructura.
