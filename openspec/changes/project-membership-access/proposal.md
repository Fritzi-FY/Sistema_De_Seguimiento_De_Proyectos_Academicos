## Why

El incremento `projects-management-baseline` estableció la creación y listado de proyectos académicos, pero el acceso quedó restringido al creador del proyecto (`creatorId`). Todas las especificaciones canónicas y los requisitos funcionales (FR-005, FR-006) establecen que el acceso a un proyecto debe estar determinado por **membresía explícita**, no solo por la propiedad del registro.

Sin membresía implementada:

1. Un integrante de equipo invitado a colaborar en un proyecto que no creó no puede verlo ni trabajar en él, lo que hace inoperables los EPICs de tableros, entregables y revisiones docentes.
2. La spec canónica `projects-teams` establece *"the response payload SHALL contain ONLY projects where `user-student-A` is the creator or an **explicit member**"*, pero el código actual ignora la cláusula "or an explicit member".
3. Los criterios globales de aceptación (`docs/02-requirements.md` L53) exigen que un estudiante no acceda a proyectos de los que no es miembro, pero la verificación de membresía nunca se aplica porque el mecanismo no existe.
4. Las specs de `boards-tasks`, `collaboration-reviews` e `identity-access` presuponen "authorized member" como prerequisito de todos sus flujos; sin este incremento dichos flujos no pueden verificarse correctamente.

Este incremento cierra la brecha identificada en la auditoría del PR #2 (informe `auditoria_alcance_pr2.md`) y habilita la colaboración controlada entre integrantes de un mismo proyecto, sin la cual los EPICs posteriores no pueden funcionar.

## What Changes

- **Nuevo tipo de dominio `ProjectMembership`** en `packages/shared`:
  campos `id` (UUID v4), `projectId`, `userId`, `role` (`'owner' | 'collaborator'`),
  `status` (`'active' | 'removed'`), `joinedAt` (ISO-8601 UTC), `updatedAt` (ISO-8601 UTC).
- **Nuevo puerto driven `MembershipRepositoryPort`** en `packages/shared`:
  operaciones `addMember`, `removeMember`, `findByProject`, `findByUser`, `findByProjectAndUser`.
- **Nuevo puerto driven `ProjectCreationPort`** en `packages/shared`:
  operación `createProjectWithOwner(project, ownerMembership)` que encapsula la creación
  coordinada del proyecto y su membresía `owner` con semántica todo-o-nada. El caso de uso
  delega la garantía de consistencia al adaptador; en memoria, las mutaciones se ejecutan
  sin `await` intercalado y con validación previa de precondiciones; en PostgreSQL, se
  envuelven en `BEGIN`/`COMMIT`/`ROLLBACK`.
- **Nuevos esquemas Zod** en `packages/shared`:
  `AddMemberRequestSchema`, `MembershipResponseSchema`, `MemberListResponseSchema`.
- **Coordinación de acceso por membresía en la capa de aplicación**: `ProjectRepositoryPort.findByUser`
  **conserva su firma y semántica original** (retorna proyectos cuyo `creatorId` coincide con el usuario).
  La unión con proyectos accesibles por membresía se realiza exclusivamente en `ListProjectsUseCase`,
  que coordina `ProjectRepositoryPort` y `MembershipRepositoryPort` sin modificar los contratos de
  ninguno de los dos puertos.
- **Nuevos casos de uso** en `apps/api`:
  - `AddMemberUseCase`: valida que el solicitante es el creador, previene duplicados activos y persiste el registro.
  - `RemoveMemberUseCase`: valida permisos, rechaza la retirada del propietario, cambia `status` a `'removed'`.
  - `ListMembersUseCase`: retorna los miembros activos del proyecto solo a usuarios con membresía activa.
- **Actualización de `CreateProjectUseCase`**: delega la creación coordinada del proyecto y su
  membresía `owner` al `ProjectCreationPort`. Ya no invoca dos repositorios independientes;
  la garantía de consistencia es responsabilidad del adaptador inyectado.
- **Nuevo adaptador `InMemoryProjectCreationAdapter`** implementando `ProjectCreationPort`:
  recibe las mismas instancias de `Map` que `InMemoryProjectRepository` e
  `InMemoryMembershipRepository` (Patrón B.1), creadas una sola vez en `app.ts`.
- **Actualización de `GetProjectByIdUseCase`**: verifica `creatorId` **o** membresía activa para autorizar el acceso.
- **Actualización de `ListProjectsUseCase`**: coordina `ProjectRepositoryPort` y `MembershipRepositoryPort` para retornar proyectos accesibles como creador o miembro.
- **Nuevo repositorio `InMemoryMembershipRepository`** implementando `MembershipRepositoryPort`.
- **Actualización de `InMemoryProjectRepository.findByUser`**: semántica actualizada para incluir proyectos accesibles por membresía, coordinada desde el caso de uso.
- **Nuevos endpoints HTTP** en `apps/api`:
  - `POST /api/projects/:id/members` — Agregar integrante (201, 403, 404, 409).
  - `DELETE /api/projects/:id/members/:userId` — Retirar integrante (200, 403, 404, 422).
  - `GET /api/projects/:id/members` — Listar integrantes (200, 401, 404).
- **Actualización del contrato OpenAPI 3.1** con los tres nuevos endpoints y sus esquemas.
- **Frontend** (`apps/web`): `MembershipService`, componente `ProjectMembersList` y `AddMemberModal` integrados en la vista de detalle de proyecto.

### Exclusiones estrictas

- No se implementa invitación por correo electrónico.
- No se implementan notificaciones por cambio de membresía (EPIC posterior).
- No se conecta a PostgreSQL/Drizzle (diferido al spike ADR-003).
- No se implementan entidades `Team` ni `TeamMember` (membresía derivada de equipos diferida).
- No se implementa paginación de la lista de miembros en esta versión.
- No se implementan roles adicionales distintos de `owner` y `collaborator`.

## Capabilities

### New Capabilities

*(Ninguna nueva capacidad canónica; el cambio implementa requisitos dentro de la capacidad existente `projects-teams`).*

### Modified Capabilities

- `projects-teams`: Incorpora el mecanismo de membresía explícita usuario–proyecto, los endpoints de gestión de integrantes, la creación automática de membresía `owner` al crear un proyecto, y la actualización de las reglas de aislamiento de acceso para considerar membresía activa además de propiedad del registro.

## Impact

- **Código y estructura:** Ampliación de `packages/shared` (entidad, puertos `MembershipRepositoryPort` y `ProjectCreationPort`, esquemas), `apps/api` (nuevos casos de uso, adaptadores en memoria incluyendo `InMemoryProjectCreationAdapter` con `Map` compartidos, rutas Hono, OpenAPI) y `apps/web` (servicio y componentes de UI).
- **APIs y Contratos:** Tres nuevos endpoints bajo `/api/projects/:id/members` documentados en OpenAPI 3.1.
- **Seguridad y Privacidad:** El aislamiento de acceso pasa de verificación de `creatorId` a verificación de membresía activa. Las pruebas de acceso horizontal cubren propietario, integrante autorizado, usuario ajeno e identidad no autenticada.
- **Deuda técnica generada por diseño:** Al migrar a PostgreSQL (ADR-003), `InMemoryMembershipRepository` e `InMemoryProjectCreationAdapter` deberán reemplazarse por adaptadores Drizzle. `ProjectCreationPort` se implementará con transacciones SQL (`BEGIN`/`COMMIT`/`ROLLBACK`). Los casos de uso y el dominio no requerirán cambios.
- **Presupuesto:** Coste directo US$0. Implementación 100% local en memoria, sin dependencias de servicios externos.
