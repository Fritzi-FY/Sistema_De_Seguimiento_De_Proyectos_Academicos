## 1. Shared Package: Domain Models, Ports, and Schemas (`packages/shared`)

- [x] 1.1 Definir la entidad de dominio `Project` y la interfaz del puerto driven `ProjectRepositoryPort` en `packages/shared/src/ports/project-repository.port.ts`, incluyendo operaciones `save`, `findById`, `findAll` y `findByUser`.
- [x] 1.2 Definir los esquemas Zod en `packages/shared/src/contracts/project.contract.ts`: `CreateProjectRequestSchema`, `ProjectResponseSchema` y `ProjectListResponseSchema`, incorporando validaciones de longitud (título 3-120 caracteres, descripción máx. 500), curso normalizado y regla de refinamiento de fechas ISO-8601 UTC (`targetDate >= startDate`).
- [x] 1.3 Exportar los nuevos contratos y tipos en `packages/shared/src/index.ts`.
- [x] 1.4 Escribir pruebas unitarias en `packages/shared/src/contracts/project.contract.test.ts` para verificar la aceptación de cargas válidas y el rechazo estricto de títulos inválidos, campos faltantes y cronologías de fechas invertidas.

## 2. Backend Application Layer and In-Memory Persistence (`apps/api`)

- [x] 2.1 Implementar el adaptador de persistencia volátil `InMemoryProjectRepository` en `apps/api/src/infrastructure/adapters/repositories/in-memory-project.repository.ts`, documentando su naturaleza transitoria de desarrollo basada en memoria.
- [x] 2.2 Implementar el caso de uso `CreateProjectUseCase` en `apps/api/src/application/use-cases/create-project.use-case.ts`, inyectando `ProjectRepositoryPort` y `SystemClockPort` para asignar UUID v4, timestamps y creador inicial.
- [x] 2.3 Escribir pruebas unitarias con Vitest para `CreateProjectUseCase` en `apps/api/src/application/use-cases/create-project.use-case.test.ts`, utilizando implementaciones fake para garantizar determinismo sin dependencias HTTP.
- [x] 2.4 Implementar el caso de uso `ListProjectsUseCase` en `apps/api/src/application/use-cases/list-projects.use-case.ts`, aplicando reglas de aislamiento de alcance (estudiantes solo visualizan proyectos donde son creadores/miembros; docentes según su ámbito de curso).
- [x] 2.5 Escribir pruebas unitarias para `ListProjectsUseCase` en `apps/api/src/application/use-cases/list-projects.use-case.test.ts`, comprobando que un estudiante no puede acceder a proyectos creados por otros estudiantes.

## 3. Backend HTTP Infrastructure and OpenAPI Specification (`apps/api`)

- [x] 3.1 Implementar el middleware `devAuthMiddleware` en `apps/api/src/infrastructure/http/middleware/dev-auth.middleware.ts`, habilitando `X-Dev-User-Id` y `X-Dev-User-Role` únicamente si `NODE_ENV === 'development'` y rechazando peticiones con HTTP 401 Unauthorized si se invocan en `production`.
- [x] 3.2 Implementar el enrutador de proyectos en `apps/api/src/infrastructure/http/routes/projects.route.ts` montando los manejadores para `POST /` (201 Created, 400 Bad Request) y `GET /` (200 OK con `Cache-Control: no-cache, no-store, must-revalidate`), y montarlo bajo `/api/projects` en `apps/api/src/infrastructure/http/app.ts`.
- [x] 3.3 Documentar los endpoints `/api/projects` en la especificación OpenAPI 3.1 en `apps/api/src/infrastructure/openapi/openapi.contract.ts`, incluyendo esquemas de request, respuestas 201, 200, 400, 401 y 405 Method Not Allowed con cabecera `Allow`.
- [x] 3.4 Escribir pruebas de integración HTTP en memoria con Vitest (`app.request`) en `apps/api/src/infrastructure/http/routes/projects.route.test.ts`, validando creación de proyectos, aislamiento entre usuarios, rechazo de métodos no soportados y coincidencia estricta con OpenAPI.
- [x] 3.5 Actualizar `apps/api/src/infrastructure/openapi/openapi.contract.test.ts` para verificar la presencia de las nuevas rutas de proyectos en el contrato OpenAPI publicado.

## 4. Frontend Client and User Interface (`apps/web`)

- [x] 4.1 Implementar el cliente HTTP `ProjectService` en `apps/web/src/services/project.service.ts` para consumir `/api/projects` a través del proxy de Vite, tipado con esquemas de `@is488/shared`.
- [x] 4.2 Escribir pruebas unitarias para `ProjectService` en `apps/web/src/services/project.service.test.ts` simulando respuestas exitosas y errores HTTP.
- [x] 4.3 Implementar el componente visual `ProjectList` en `apps/web/src/components/ProjectList.tsx`, renderizando tarjetas de proyectos con título, curso, estado, fechas de entrega, badges de rol y estados de carga/vacío.
- [x] 4.4 Implementar el componente `CreateProjectModal` (o formulario integrado) en `apps/web/src/components/CreateProjectModal.tsx`, con validación reactiva de campos y fechas antes del envío, y bloqueo de envíos múltiples.
- [x] 4.5 Integrar los componentes de proyectos dentro de `apps/web/src/components/AppShell.tsx`, manteniendo la visualización del diagnóstico operativo y permitiendo al usuario crear y consultar proyectos en vivo.
- [x] 4.6 Escribir pruebas de componentes con Vitest y React Testing Library en `apps/web/src/components/ProjectList.test.tsx` y `apps/web/src/components/CreateProjectModal.test.tsx` verificando el renderizado de proyectos, interacción del formulario y presentación de errores.

## 5. Quality Verification and OpenSpec Validation

- [x] 5.1 Ejecutar la suite completa de pruebas del monorepo (`npm test`) y verificar que todas las pruebas (unitarias, integración HTTP y UI) pasan con código 0.
- [x] 5.2 Ejecutar las compuertas de análisis estático: `npm run lint`, `npm run typecheck` y `npm run format:check`, garantizando 0 errores y 0 advertencias.
- [x] 5.3 Ejecutar la compilación de producción del monorepo (`npm run build`) verificando la generación limpia de artefactos en los tres workspaces.
- [x] 5.4 Validar formalmente las especificaciones con `npx openspec validate --specs --strict` y `npx openspec validate --all --strict`.
- [x] 5.5 Ejecutar `git diff --check` y verificar que el árbol de trabajo se encuentra en estado limpio y listo para revisión humana.
