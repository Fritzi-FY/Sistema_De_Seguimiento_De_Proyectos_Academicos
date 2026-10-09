# 11. Preparación del entorno

## 11.1 Herramientas

- Git para Windows y Git CLI.
- Node.js LTS compatible con las versiones fijadas en `package.json`; OpenSpec requiere Node.js 20.19.0 o superior según su documentación actual.
- npm (incluido con Node.js) o el package manager acordado por el repositorio; no mezclar managers sin necesidad.
- Google Antigravity como IDE/agente principal.
- OpenSpec CLI.
- GitHub account y permisos sobre el repositorio.
- Cuenta Cloudflare.
- Cuenta del proveedor PostgreSQL seleccionado.
- Google Cloud Console para configurar OAuth.
- OpenRouter API key (solo cuando se implemente la integración real; para tests se usa mock).
- Docker Desktop opcional para PostgreSQL local y pruebas reproducibles.

## 11.2 Verificar el repositorio

En PowerShell:

```powershell
git --version
node --version
npm --version
git clone https://github.com/Fritzi-FY/Sistema_De_Seguimiento_De_Proyectos_Academicos.git
cd Sistema_De_Seguimiento_De_Proyectos_Academicos
git status
```

Si el repositorio contiene cambios desde que se preparó este paquete, revisar primero `git status` y el contenido actual; no sobrescribir trabajo existente.

## 11.3 Instalar OpenSpec

```powershell
npm install -g @fission-ai/openspec@latest
openspec --version
```

Luego, desde la raíz del repositorio:

```powershell
openspec init --tools antigravity
```

Si la versión instalada no reconoce el identificador o la integración, ejecutar `openspec init` interactivo, elegir Antigravity si aparece, y revisar la lista de herramientas soportadas de la versión instalada. No borrar archivos de agente existentes sin revisarlos.

## 11.4 Variables de entorno

Crear `.env.local` solo para desarrollo local, incluirlo en `.gitignore` y usar `.env.example` sin valores reales. Los secretos productivos deben guardarse en Cloudflare/GitHub, no en archivos versionados.

Ejemplos de nombres (no valores):

```text
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_SECRET=
OPENROUTER_API_KEY=
EMAIL_PROVIDER_API_KEY=
APP_BASE_URL=http://localhost:5173
```

El esquema real de variables dependerá de la biblioteca de autenticación y de Wrangler. No copiar variables de producción al entorno local.

## 11.5 Primeros pasos del repositorio

1. Revisar `README.md`, ADR, requisitos y `openspec/config.yaml`.
2. Crear rama `feature/epic-001-foundation`.
3. Ejecutar lint/typecheck/tests/build a medida que se configuren.
4. Crear la propuesta OpenSpec del primer EPIC antes de implementar funcionalidad.
5. Hacer un spike corto que compruebe React/Vite + Worker TypeScript + PostgreSQL/Hyperdrive + una consulta real.
6. Solo después de superar el spike, fijar las bibliotecas de ORM y autenticación.

## 11.6 Configuración de OAuth

Registrar URI de callback exacta para desarrollo y producción. No usar comodines. Confirmar si la universidad permite Google OAuth con el dominio institucional y si el correo expone la señal de verificación esperada. Si la cuenta institucional no está administrada por Google Workspace o no permite el flujo, documentar la limitación y mantener la alternativa de correo verificado.
