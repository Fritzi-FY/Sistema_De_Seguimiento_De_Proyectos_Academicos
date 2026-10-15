## 1. Monorepo and Tooling Configuration

- [x] 1.1 Configurar `package.json` raíz con npm workspaces (`apps/*`, `packages/*`), scripts de orquestación y dependencias de desarrollo base, documentando Node.js `>=20.19.0` como requisito mínimo del entorno (compatible con OpenSpec 1.7.0). Dejar las versiones exactas de frameworks/herramientas como decisión técnica sujeta a verificación de compatibilidad durante la instalación. Generar y versionar `package-lock.json` para garantizar que CI y desarrollo utilicen instalaciones deterministas con `npm ci`.
- [x] 1.2 Configurar `tsconfig.json` raíz con modo estricto (`strict: true`, `noImplicitAny: true`, `skipLibCheck: true`) y base para herencia de workspaces.
- [x] 1.3 Configurar reglas de ESLint y Prettier en la raíz para garantizar consistencia estilística y sintáctica en todos los paquetes.
- [x] 1.4 Configurar `.gitignore` completo y `.env.example` con variables de entorno simuladas libres de secretos.

## 2. Shared Package: Contracts and Domain Ports (`packages/shared`)

- [x] 2.1 Inicializar el workspace `packages/shared` con su `package.json`, `tsconfig.json` y exports tipados.
- [x] 2.2 Definir los esquemas Zod para el diagnóstico operativo (`HealthResponseSchema`: status "ok", timestamp ISO-8601, versión) y exportar los tipos TypeScript inferidos.
- [x] 2.3 Definir la interfaz del puerto de dominio `SystemClockPort` para desacoplar la provisión de marcas temporales.
- [x] 2.4 Escribir pruebas unitarias con Vitest en `packages/shared` para validar los esquemas Zod ante cargas válidas e inválidas.

## 3. Backend Worker Implementation (`apps/api`)

- [x] 3.1 Inicializar el workspace `apps/api` con `package.json`, `tsconfig.json`, dependencias de Hono y `@cloudflare/workers-types`, y configuración base de `wrangler.jsonc`.
- [x] 3.2 Implementar el caso de uso `GetSystemHealthUseCase` en la capa de aplicación dependiendo exclusivamente de la abstracción `SystemClockPort`.
- [x] 3.3 Escribir prueba unitaria hexagonal aislada en Vitest para `GetSystemHealthUseCase`, inyectando una implementación de prueba `FakeSystemClock` a través de `SystemClockPort` para verificar comportamiento determinista sin dependencias HTTP.
- [x] 3.4 Implementar la infraestructura de entrada con Hono montando la ruta `GET /api/health` e inyectando la implementación concreta `SystemClock`.
- [x] 3.5 Configurar cabeceras de respuesta seguras (`Cache-Control: no-cache, no-store, must-revalidate`) y manejo estricto de métodos HTTP no soportados (405 Method Not Allowed).
- [x] 3.6 Declarar el contrato OpenAPI 3.1 para el endpoint `GET /api/health` garantizando coincidencia con el esquema Zod.
- [x] 3.7 Escribir pruebas de integración HTTP independientes en memoria con Vitest (`app.request('/api/health')`) validando código de estado 200, payload JSON, cabeceras de seguridad y rechazo de métodos POST/DELETE sobre la aplicación Hono.

## 4. Frontend SPA Baseline (`apps/web`)

- [x] 4.1 Inicializar el workspace `apps/web` con React, Vite, TypeScript, `package.json` y `tsconfig.json`.
- [x] 4.2 Configurar Tailwind CSS, PostCSS y variables de color institucionales en `tailwind.config.js` e `index.css`.
- [x] 4.3 Configurar proxy inverso en `vite.config.ts` para reenviar peticiones relativas `/api/*` a `http://localhost:8787` durante el desarrollo local.
- [x] 4.4 Implementar el componente shell accesible de la aplicación que consuma `GET /api/health` y muestre el estado de conexión operativa del backend.
- [x] 4.5 Escribir prueba unitaria básica con Vitest para validar el renderizado del shell y el manejo del estado de salud.

## 5. Lifecycle Scripts, CI Pipeline and Acceptance Verification

- [x] 5.1 Enlazar y verificar los scripts del ciclo de vida en la raíz (`dev`, `build`, `lint`, `typecheck`, `test`) asegurando ejecución recursiva en workspaces.
- [x] 5.2 Actualizar el flujo de GitHub Actions en `.github/workflows/ci.yml` (que actualmente solo valida especificaciones OpenSpec) para incorporar con `npm ci` las nuevas compuertas de calidad planificadas: `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- [x] 5.3 Redactar la guía de inicio rápido y comandos de desarrollo local en `README.md` o documentación técnica de soporte.
- [x] 5.4 Ejecutar localmente todos los comandos de verificación empírica y comprobar que finalizan con código 0 y sin advertencias antes de solicitar revisión humana.
