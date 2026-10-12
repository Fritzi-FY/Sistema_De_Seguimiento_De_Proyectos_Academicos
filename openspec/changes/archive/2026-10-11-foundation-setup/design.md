## Context

El proyecto IS488 ha establecido su línea base de gobernanza y arquitectura en la documentación y especificaciones canónicas, pero no dispone de un entorno de ejecución, compilación ni pruebas. Se requiere proveer una estructura monorepo limpia, tipada y desacoplada que sirva como cimiento ejecutable para los futuros spikes técnicos (Drizzle ORM, Better Auth, Neon, Hyperdrive) y los EPICs de producto, respetando la arquitectura hexagonal y la política de costo US$0.

Véase [proposal.md](proposal.md) para la motivación y el alcance de alto nivel.

## Goals / Non-Goals

**Goals:**
- Establecer la topología del monorepo mediante npm workspaces (`apps/web`, `apps/api`, `packages/shared`).
- Configurar un backend Cloudflare Workers en TypeScript con Hono exponiendo `GET /api/health`.
- Configurar un frontend SPA en React + Vite + Tailwind CSS consumiendo `/api/health`.
- Implementar la arquitectura hexagonal inicial: un puerto `SystemClockPort`, el caso de uso `GetSystemHealthUseCase` y el adaptador HTTP en Hono.
- Publicar el contrato OpenAPI 3.1 inicial para el endpoint de salud.
- Configurar TypeScript estricto, ESLint, Prettier y Vitest para pruebas unitarias e integración en memoria.
- Proveer scripts raíz unificados para `dev`, `build`, `lint`, `typecheck` y `test`.
- Planificar la ampliación del workflow de CI en GitHub Actions para validar OpenSpec y calidad de código.

**Non-Goals:**
- No conectar bases de datos relacionales activas ni configurar pooling de Hyperdrive en esta fase.
- No instalar ni ejecutar Drizzle ORM (diferido al spike técnico de persistencia).
- No implementar flujos de autenticación (ni Google OAuth ni email/password).
- No implementar entidades ni módulos de negocio (cursos, proyectos, tableros, tareas).
- No invocar APIs de IA (OpenRouter) ni requerir claves de API externas.
- No implementar almacenamiento de archivos binarios ni Cloudflare R2.
- No ejecutar pruebas de carga con k6 ni pruebas E2E con Playwright sobre este incremento.
- No provisionar infraestructura de pago ni desplegar a entornos de producción.

## Decisions

### Decisión 1: Topología de monorepo ligero con npm workspaces
- **Elección:** Monorepo gestionado con npm workspaces nativo de Node.js, estructurado en:
  - `packages/shared`: esquemas Zod de validación, tipos comunes y contrato de API.
  - `apps/api`: aplicación Cloudflare Workers con Hono, Wrangler y adaptadores de infraestructura.
  - `apps/web`: aplicación cliente SPA en React con Vite y Tailwind CSS.
- **Justificación:** Aísla completamente el entorno de tipos del navegador (`DOM`) del runtime de Cloudflare Workers (`@cloudflare/workers-types`), evitando colisiones de tipado global mientras permite compartir contratos fuertemente tipados a través de `packages/shared`.
- **Alternativas consideradas:**
  - *Repositorios separados (Polirepo):* Rechazado por complicar la sincronización de contratos de API y el flujo de trabajo en Git/OpenSpec.
  - *Estructura unificada en raíz única sin workspaces:* Rechazada porque mezclar dependencias de React y Workers en un solo `tsconfig` genera conflictos frecuentes de tipos globales.

### Decisión 2: Enrutador HTTP Hono sobre Cloudflare Workers
- **Elección:** Adoptar **Hono** como framework de enrutamiento HTTP dentro de `apps/api`.
- **Justificación:** Hono es un micro-framework (<15KB) de estándar industrial diseñado específicamente para runtimes de borde (Edge/Workers). Proporciona soporte de Web Standards (`Request`/`Response`), rendimiento extremo y excelente integración con esquemas Zod y especificaciones OpenAPI.
- **Alternativas consideradas:**
  - *Fetch API nativa de Workers sin framework:* Rechazada por requerir enrutamiento manual propenso a errores y código repetitivo para manejo de métodos y cabeceras.
  - *Express / Fastify:* Rechazados por estar fuertemente ligados a APIs nativas de Node.js no soportadas de forma directa en Workers.

### Decisión 3: Arquitectura Hexagonal demostrativa para el diagnóstico
- **Elección:** Estructurar el backend respetando Clean Architecture incluso para el endpoint técnico:
  - Puerto de dominio: `SystemClockPort` (interfaz para obtención de fecha/hora actual).
  - Caso de uso: `GetSystemHealthUseCase` (orquesta el estado del sistema y la versión).
  - Adaptador de entrada: Controlador Hono que valida la respuesta con el esquema Zod de `packages/shared`.
- **Justificación:** Garantiza que el código no nazca acoplado al framework HTTP, facilitando pruebas unitarias deterministas sin mocks complejos ni dependencias de red.
- **Alternativas consideradas:**
  - *Handler HTTP directo inline:* Rechazado por vulnerar el ADR-001 y sentar un precedente negativo de acoplamiento.

### Decisión 4: Pruebas unitarias e integración en memoria con Vitest
- **Elección:** Configurar Vitest como motor de pruebas unificado en el monorepo.
- **Justificación:** Vitest se integra nativamente con Vite y módulos ESM de TypeScript. Permite probar casos de uso como pruebas unitarias puras y probar rutas de Hono mediante `app.request('/api/health')` en memoria a velocidad de milisegundos, sin abrir puertos de red.
- **Alternativas consideradas:**
  - *Jest:* Rechazado por requerir transformaciones complejas de ESM y configuración adicional para Vite.

### Decisión 5: Comunicación de desarrollo local mediante proxy de Vite
- **Elección:** Configurar el servidor de desarrollo de Vite (`apps/web`) para reenviar solicitudes `/api/*` al servidor local de Wrangler (`http://localhost:8787`).
- **Justificación:** Evita problemas de CORS durante el desarrollo local y permite que el cliente consuma endpoints relativos (`/api/health`) idénticos a los del entorno de despliegue en Cloudflare.

### Decisión 6: Relación entre el delta de especificación y los requisitos canónicos de calidad
- **Análisis de solapamiento:** El delta spec en `specs/platform-quality/spec.md` introduce `### Requirement: Executable baseline CI gates`, el cual se complementa con el requisito canónico preexistente `### Requirement: Automated tests` de `openspec/specs/platform-quality/spec.md`. Mientras que el requisito canónico establece genéricamente la ejecución de pruebas unitarias e integración en CI, el requisito añadido formaliza de manera explícita y verificable las compuertas ejecutables completas (linting, tipado estricto TypeScript, pruebas y compilación de producción).
- **Tratamiento:** Se mantienen como requisitos complementarios durante este incremento. La decisión de consolidar o refactorizar ambos requisitos en una única formulación dentro de la especificación canónica se difiere para el momento de la sincronización y archivado (`/opsx-sync` o `/opsx-archive`), sujeto a autorización humana explícita previa.

## Risks / Trade-offs

- **[Riesgo] Conflicto de configuración de TypeScript entre cliente y Worker:**  
  *Mitigación:* Se utilizará un `tsconfig.json` base en la raíz con opciones comunes estrictas (`strict: true`, `noImplicitAny: true`, `skipLibCheck: true`), extendido por `tsconfig.json` especializados en `apps/web` (con `lib: ["DOM", "DOM.Iterable", "ESNext"]`) y `apps/api` (con tipos de Cloudflare Workers).

- **[Riesgo] Uso accidental de APIs de Node.js en Cloudflare Workers:**  
  *Mitigación:* Se configurará el tipado estricto con `@cloudflare/workers-types` y se validará el empaquetado del worker con `wrangler build` en el pipeline de CI.

- **[Riesgo] Fricción en el inicio simultáneo de servidores locales:**  
  *Mitigación:* Se incorporará una herramienta de ejecución concurrente estándar (como `concurrently` o `npm run dev --workspaces`) en los scripts de la raíz para iniciar frontend y backend con un solo comando.

## Migration / Deployment Plan

1. **Entorno local:**
   - `npm install` en la raíz instala y enlaza los workspaces automáticamente.
   - `npm run dev` levanta el servidor de desarrollo del frontend (Vite en puerto 5173) y el backend (Wrangler dev en puerto 8787).
2. **Compilación reproducible:**
   - `npm run build` construye `packages/shared`, seguido del bundle de `apps/web` (`dist/`) y la verificación de build de `apps/api`.
3. **Integración Continua (Estado actual vs. compuertas planificadas):**
   - El workflow actual en `.github/workflows/ci.yml` únicamente valida especificaciones canónicas de OpenSpec (`openspec validate --specs --strict`).
   - Las compuertas de verificación de código ejecutable (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`) son compuertas planificadas que se introducirán mediante la tarea correspondiente en el pull request de este incremento, utilizando `npm ci` sobre el `package-lock.json` versionado. No se consideran operativas hasta que dicha tarea se implemente y verifique empíricamente en CI.

## Open Questions

- **Spike de Persistencia (EPIC posterior):** La validación de Drizzle ORM sobre Hyperdrive y PostgreSQL se ejecutará en una propuesta OpenSpec dedicada tras consolidar esta base técnica.
- **Spike de Autenticación (EPIC posterior):** La verificación de Better Auth y Google OAuth institucional se realizará una vez aprobada la infraestructura básica.
