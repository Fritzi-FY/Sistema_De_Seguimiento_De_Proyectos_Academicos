## Context

El proyecto IS488 cuenta con un andamiaje técnico inicial comprobado (`foundation-setup`), pero requiere incorporar el primer flujo funcional de negocio: la gestión de proyectos académicos. 

Este diseño establece la arquitectura técnica para la creación y consulta de proyectos, respetando rigurosamente los principios de **Clean Architecture / Arquitectura Hexagonal** fijados en el ADR-001 y la Constitución del proyecto. Se garantiza que el núcleo de dominio no dependa de frameworks HTTP (Hono), librerías de UI (React) ni mecanismos de almacenamiento concretos. Asimismo, distingue taxativamente las decisiones de arquitectura confirmadas de las tecnologías provisionales sujetas a spike posterior (PostgreSQL/Hyperdrive con Drizzle ORM, Better Auth y Google OAuth UNSCH).

Véase [proposal.md](proposal.md) para el alcance y justificación funcional.

## Goals / Non-Goals

**Goals:**
- Definir la entidad de dominio `Project` y el puerto `ProjectRepositoryPort` en `@is488/shared`.
- Proveer esquemas de validación Zod para creación y listado de proyectos con reglas estrictas de cadenas y fechas.
- Implementar los casos de uso `CreateProjectUseCase` y `ListProjectsUseCase` en `apps/api` totalmente desacoplados de Hono.
- Implementar el adaptador de persistencia volátil `InMemoryProjectRepository` para desarrollo y pruebas locales.
- Implementar el middleware de identidad de desarrollo condicionado estrictamente a `NODE_ENV === 'development'` con rechazo en producción.
- Exponer rutas Hono `/api/projects` con especificación OpenAPI 3.1 actualizada en `openapi.contract.ts`.
- Implementar interfaz React accesible en `apps/web` con vista de proyectos, estados de carga, lista vacía y formulario de creación.
- Desarrollar pruebas unitarias, de integración HTTP, de autorización y de componentes UI con Vitest.

**Non-Goals:**
- No conectar bases de datos relacionales reales (Neon/PostgreSQL) ni instalar Drizzle ORM en este incremento (sujeto a spike técnico específico de ADR-003).
- No implementar Google OAuth ni Better Auth real (diferido a spike institucional de ADR-004).
- No implementar tableros Kanban, columnas dinámicas ni gestión de tareas (pertenecientes a EPICs posteriores).
- No integrar llamadas a OpenRouter ni proveedores de IA.
- No implementar subida de archivos ni almacenamiento binario.

## Decisions

### Decisión 1: Entidad de Dominio y Contratos Zod en `@is488/shared`
- **Elección:** Ubicar la entidad `Project` y los contratos de validación en el paquete compartido.
- **Campos alineados con [docs/04-data-model.md](../../../docs/04-data-model.md):**
  - `id`: string (UUID v4 público generado por el servidor).
  - `title`: string (min 3, max 120 caracteres, trim obligatorio).
  - `description`: string opcional (max 500 caracteres).
  - `courseCode`: string (min 2, max 20 caracteres, e.g., "IS-488", mayúsculas normalizadas).
  - `status`: enum literal (`"active"` | `"archived"`), inicializado siempre como `"active"`.
  - `startDate`: string en formato ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - `targetDate`: string en formato ISO-8601 UTC. Regla de refinamiento: `targetDate >= startDate`.
  - `creatorId`: string (identificador del usuario creador).
  - `createdAt`: string (marca de tiempo ISO-8601 UTC).
  - `updatedAt`: string (marca de tiempo ISO-8601 UTC).
- **Justificación:** Centralizar contratos en `@is488/shared` asegura que tanto la API como el frontend compartan exactamente las mismas reglas de tipado y validación en tiempo de compilación y ejecución.

### Decisión 2: Puerto Driven `ProjectRepositoryPort` e Implementación en Memoria
- **Elección:** Definir la interfaz abstracta `ProjectRepositoryPort`:
  ```typescript
  export interface ProjectRepositoryPort {
    save(project: Project): Promise<void>;
    findById(id: string): Promise<Project | null>;
    findAll(): Promise<Project[]>;
    findByUser(userId: string): Promise<Project[]>;
  }
  ```
- **Implementación Inicial:** `InMemoryProjectRepository` almacena las entidades en un `Map<string, Project>` en memoria.
- **Transitoriedad y Aislamiento:** Se documenta expresamente que los datos son volátiles y se reinician al detener el proceso. La interfaz `ProjectRepositoryPort` está diseñada de modo que la futura incorporación del adaptador `DrizzlePostgresProjectRepository` (tras el spike de ADR-003) no requerirá ninguna modificación en los casos de uso ni en el núcleo de dominio.

### Decisión 3: Middleware de Identidad de Desarrollo Protegida
- **Elección:** Implementar un middleware en Hono (`devAuthMiddleware`) que extrae la identidad del usuario a partir de cabeceras HTTP:
  - `X-Dev-User-Id`: identificador de usuario simulado (e.g. `dev-student-01`).
  - `X-Dev-User-Role`: rol simulado (`student` | `teacher` | `admin`).
- **Salvaguardas de Seguridad Obligatorias:**
  - El middleware evalúa la variable de entorno `NODE_ENV`. Si `NODE_ENV === 'production'`, el middleware descarta las cabeceras simuladas y rechaza la petición con `HTTP 401 Unauthorized` si no existe un token de sesión legítimo.
  - En desarrollo, si la cabecera no se proporciona, asigna un contexto predeterminado seguro (`dev-student-01`, rol `student`).
  - Esta solución es transitoria para posibilitar el desarrollo desacoplado y no sustituye la autenticación institucional con Google OAuth.

### Decisión 4: Reglas de Autorización y Aislamiento de Consultas
- **Regla Estudiantil:** Cuando un usuario con rol `student` ejecuta `GET /api/projects`, el caso de uso `ListProjectsUseCase` invoca `repository.findByUser(studentId)`. Un estudiante **únicamente visualiza proyectos donde es creador o miembro**.
- **Regla Docente:** Cuando un usuario con rol `teacher` ejecuta `GET /api/projects`, se devuelven proyectos de su ámbito asignado (en esta fase base, proyectos del curso correspondiente).
- **Protección de Detalle:** El acceso por ID a un proyecto donde el usuario no tiene membresía retorna `HTTP 404 Not Found` (o `403 Forbidden` sin filtrar títulos ni datos privados).

### Decisión 5: Alineación con OpenAPI 3.1
- **Elección:** Declarar las rutas `/api/projects` en [apps/api/src/infrastructure/openapi/openapi.contract.ts](../../../apps/api/src/infrastructure/openapi/openapi.contract.ts):
  - `POST /api/projects`: Entrada validada con `CreateProjectRequestSchema`, respuesta 201 Created con `ProjectResponseSchema`, respuesta 400 Bad Request estructurada, respuesta 401 Unauthorized.
  - `GET /api/projects`: Respuesta 200 OK con array de proyectos (`ProjectListResponseSchema`) y cabeceras `Cache-Control: no-cache, no-store, must-revalidate`.
  - Manejo de métodos no soportados (405 Method Not Allowed con cabecera `Allow`).

### Decisión 6: Interfaz de Usuario React en `apps/web`
- **Elección:** Construir una vista modular en React con Tailwind CSS:
  - `ProjectService`: Cliente HTTP que consume `/api/projects` mediante el proxy de Vite y adjunta las cabeceras de identidad de desarrollo.
  - `ProjectList`: Cuadrícula responsiva que presenta título, curso, estado, fechas de entrega y creador. Maneja estados explícitos: cargando (skeletons), lista vacía amigable y error de red con botón de reintento.
  - `CreateProjectDialog` (o formulario accesible): Diálogo modal con campos validados, mensajes de error accesibles y bloqueo de envío doble.

## Risks / Trade-offs

- **[Riesgo] Pérdida de datos al reiniciar el servidor:**  
  *Impacto:* Los proyectos creados en memoria se pierden al reiniciar Wrangler o Vite.  
  *Mitigación:* Se documenta explícitamente en la UI y en la especificación que el almacenamiento es volátil durante este incremento previo al spike de base de datos.
- **[Riesgo] Exposición de cabeceras de depuración (`X-Dev-User-Id`):**  
  *Impacto:* Riesgo de suplantación de identidad si se habilitara accidentalmente en producción.  
  *Mitigación:* Validación estricta en el servidor: si `NODE_ENV === 'production'`, el middleware rechaza de forma incondicional el uso de cabeceras de desarrollo y emite HTTP 401.
- **[Riesgo] Desfase en validación de fechas entre cliente y servidor:**  
  *Impacto:* Diferencias de zona horaria al registrar fechas de entrega.  
  *Mitigación:* Estandarización de todas las marcas temporales en ISO-8601 UTC (`.toISOString()`), con validación semántica en Zod (`startDate <= targetDate`).
