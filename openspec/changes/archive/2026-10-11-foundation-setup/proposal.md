## Why

El proyecto IS488 cuenta actualmente con un marco de gobernanza, documentación arquitectónica y especificaciones canónicas de alta calidad, pero carece de una base técnica ejecutable. Sin una estructura de monorepo inicializada, sin configuración de compilación, linters ni herramientas de prueba, no es posible validar empíricamente ningún comportamiento ni comenzar los spikes técnicos requeridos por la Constitución (Drizzle ORM, Better Auth, Neon, Hyperdrive).

Establecer ahora la base técnica ejecutable (`foundation-setup`) resuelve esta brecha de manera controlada y sin coste directo de infraestructura en esta fase. Proporciona el andamiaje del monorepo (`apps/web`, `apps/api`, `packages/shared`), configura el entorno de desarrollo y pruebas en TypeScript estricto, expone un endpoint técnico de diagnóstico (`GET /api/health`) y prepara el pipeline de CI para verificar linting, tipado, pruebas y compilación antes de que se introduzca cualquier lógica de negocio.

## What Changes

- **Estructura de monorepo:** Configuración raíz con npm workspaces articulando `apps/web` (frontend), `apps/api` (backend Worker) y `packages/shared` (contratos y esquemas).
- **Backend Worker con Hono:** Inicialización de Cloudflare Worker en TypeScript con Hono como enrutador HTTP ligero y configuración de Wrangler local.
- **Frontend SPA con React y Vite:** Inicialización de la aplicación web en React con Vite, TypeScript y configuración inicial de Tailwind CSS respetando el sistema de diseño institucional.
- **Paquete compartido (`packages/shared`):** Esquemas de validación con Zod y tipos TypeScript desacoplados para contratos de API y salud operativa.
- **Endpoint técnico de salud (`GET /api/health`):** Endpoint que expone el estado del servicio (`status: "ok"`, versión y timestamp ISO) validado mediante Zod, sin requerir autenticación ni acceso a base de datos.
- **Contrato OpenAPI inicial:** Especificación OpenAPI 3.1 generada o declarada para documentar y validar el endpoint `/api/health`.
- **Arnés de calidad y pruebas:** Configuración estricta de TypeScript (`tsconfig.json`), ESLint, Prettier y Vitest para pruebas unitarias e integración en memoria.
- **Scripts del ciclo de vida:** Comandos raíz estandarizados (`dev`, `build`, `lint`, `typecheck`, `test`).
- **Ampliación planificada de CI:** Estructuración de GitHub Actions para ejecutar validación de OpenSpec, lint, typecheck, tests unitarios/integración y build.
- **Exclusiones estrictas:** No se incluye base de datos activa, ni autenticación, ni lógica de negocio, ni llamadas a proveedores de IA, ni almacenamiento de archivos binarios. Para este incremento el coste de desarrollo local es nulo, sin aprovisionamiento de servicios en la nube ni costes recurrentes inmediatos.

## Capabilities

### New Capabilities

*(Ninguna nueva capacidad canónica en este cambio; las capacidades funcionales están formalizadas en las especificaciones canónicas existentes).*

### Modified Capabilities

- `platform-quality`: Incorpora requisitos verificables de diagnóstico operativo mediante el endpoint de salud `GET /api/health` conforme al contrato OpenAPI, y formaliza las compuertas mínimas de CI para la base ejecutable (lint, typecheck, unit/integration tests y build).

## Impact

- **Código y estructura:** Creación de `apps/web/`, `apps/api/`, `packages/shared/`, `package.json` raíz y configuraciones compartidas de TypeScript/linters.
- **APIs:** Publicación del primer endpoint técnico `/api/health` y su esquema OpenAPI.
- **Dependencias:** Incorporación de dependencias de desarrollo y producción estrictamente de código abierto y gratuitas (React, Vite, Hono, Zod, Vitest, Wrangler, Tailwind CSS, TypeScript, ESLint).
- **CI/CD:** Ampliación del flujo en `.github/workflows/ci.yml` para incorporar validaciones de código ejecutable.
- **Presupuesto y operaciones:** El desarrollo y pruebas locales de este incremento operan de forma 100% autónoma sin costes de infraestructura ni provisionamiento en la nube. Esto se distingue del presupuesto operativo del proyecto en fases futuras (estimado en US$0 con tolerancia de hasta US$10 para consumos residuales indispensables según el Artículo VIII de la Constitución), cuyos costes reales dependerán de los servicios en la nube y cuotas definitivas que se seleccionen tras los spikes técnicos obligatorios.
