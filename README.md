# Sistema de Seguimiento de Proyectos Académicos IS488

**Paquete de documentación base — 2026-II**  
Autor: Fritz Brenner Flores Yarasca  
Repositorio previsto: https://github.com/Fritzi-FY/Sistema_De_Seguimiento_De_Proyectos_Academicos

## Propósito

Este paquete fija las decisiones de producto, arquitectura, seguridad, calidad, pruebas, despliegue y flujo Spec-Driven Development (SDD) con OpenSpec. Está basado en la propuesta académica y el sílabo IS488, actualizado con las decisiones confirmadas por el propietario del proyecto.

## Decisiones resumidas

- **Producto:** aplicación web para seguimiento de proyectos académicos, con UX de tablero Kanban inspirada en Trello, no una copia de su marca o interfaz.
- **Arquitectura:** monolito modular, arquitectura hexagonal/Clean Architecture, API REST y contratos OpenAPI.
- **Frontend:** React + TypeScript + Vite; Tailwind CSS + shadcn/ui; componentes de terceros solo cuando aporten valor.
- **Backend preferido:** TypeScript sobre Cloudflare Workers, organizado por módulos y puertos/adaptadores.
- **Persistencia:** PostgreSQL gestionado externamente; conexión desde Workers mediante Cloudflare Hyperdrive.
- **Autenticación:** Google OAuth institucional y alternativa de correo/contraseña con verificación; roles con privilegio mínimo. La viabilidad final depende de configurar OAuth y proveedor de correo.
- **IA:** OpenRouter detrás de una interfaz `AIProvider`; proveedor/modelo intercambiable, cuotas y modo simulado para pruebas.
- **Archivos:** primera versión solo metadatos y enlaces; no persistir archivos subidos en el filesystem de Workers.
- **Entrega:** Cloudflare Workers/Static Assets, DNS/HTTPS, GitHub Actions para CI/CD, observabilidad y pruebas de carga controladas.
- **Costo:** objetivo de costo operativo mensual mínimo, idealmente US$0; se acepta que los planes gratuitos tienen límites y que IA/correo/base de datos pueden requerir un gasto pequeño.
- **Git:** una rama por EPIC y PR hacia `main`; correcciones independientes en ramas `fix/*`.
- **SDD:** OpenSpec como fuente de verdad de los requisitos de cada cambio; no implementar cambios funcionales significativos sin propuesta/specs/design/tasks revisados.

## Orden recomendado de trabajo

1. Confirmar el repositorio y crear una rama de trabajo.
2. Instalar Node.js LTS compatible, Git, Antigravity y OpenSpec.
3. Incorporar estos documentos y validar los artefactos de OpenSpec.
4. Crear la primera propuesta de implementación (fundación y flujo vertical).
5. Hacer un spike técnico pequeño para validar Workers + PostgreSQL/Hyperdrive + autenticación.
6. Implementar por EPIC con pruebas, PR y despliegues progresivos.

## Inicio rápido y desarrollo local

### Requisitos previos

- **Node.js:** `>=20.19.0` (LTS recomendado).
- **npm:** `>=10.0.0`.
- **Git** y **OpenSpec CLI** (`@fission-ai/openspec@1.7.0`).

### Instalación de dependencias

Instalación limpia y determinista basada en el `package-lock.json` versionado:

```bash
npm ci
```

### Ejecución en desarrollo

Inicia de manera coordinada el Worker de API (`apps/api` en `http://localhost:8787`) y la aplicación web SPA (`apps/web` en `http://localhost:5173` con proxy hacia `/api/*`):

```bash
npm run dev
```

### Compuertas de calidad y verificación

Ejecución de las verificaciones automatizadas locales del monorepo:

```bash
# Pruebas automatizadas en todos los workspaces (Vitest)
npm test

# Comprobación estricta de tipos TypeScript
npm run typecheck

# Análisis estático de código (ESLint)
npm run lint

# Verificación de estilo y formato de código (Prettier)
npm run format:check

# Compilación de producción (shared, Worker y frontend)
npm run build

# Validación estricta de especificaciones OpenSpec
npx openspec validate --specs --strict
```

## Índice

- `docs/01-product-vision-and-scope.md`: visión, actores, alcance y reglas.
- `docs/02-requirements.md`: requisitos funcionales, no funcionales y criterios de aceptación.
- `docs/03-architecture.md`: arquitectura, componentes, módulos y vistas C4 textuales.
- `docs/04-data-model.md`: modelo de dominio y esquema relacional inicial.
- `docs/05-security-and-privacy.md`: seguridad, roles, OAuth, privacidad e IA.
- `docs/06-test-strategy.md`: pirámide de pruebas, carga y umbrales iniciales.
- `docs/07-deployment-and-operations.md`: Cloudflare, CI/CD, SSL, caché y observabilidad.
- `docs/08-git-and-openspec-workflow.md`: ramas, PR, OpenSpec y trabajo con agentes.
- `docs/09-epic-roadmap.md`: secuencia de implementación por EPIC.
- `docs/10-ui-ux-system.md`: dirección visual y librerías recomendadas.
- `docs/11-environment-setup.md`: entorno local y primeros comandos.
- `docs/12-open-questions-and-risks.md`: decisiones verificables y riesgos que no deben ocultarse.
- `openspec/config.yaml` y `openspec/specs/*`: contexto y especificaciones iniciales.

## Regla de mantenimiento

No se necesita reescribir toda la documentación ante cada cambio. Si cambia el comportamiento del sistema, crear un cambio OpenSpec, actualizar la especificación afectada y registrar ADR si cambia una decisión arquitectónica. Las especificaciones representan el comportamiento aprobado; el código y las pruebas deben demostrarlo.

## Desarrollo integrado con PostgreSQL local

El entorno reutilizable y aislado se inicia con `npm.cmd run dev:local`. Consulta [inicio, parada, datos sintéticos y límites de persistencia](docs/development-local.md). En modo postgres, tablero, tareas e historial persisten en SQL; Maps permanece como alternativa para pruebas.
