## Context

La base técnica ejecutable del proyecto IS488 cuenta con proyectos académicos persistidos en memoria y un mecanismo de aislamiento por `creatorId`. Este incremento extiende el Módulo 3 ("Projects & Teams", `docs/03-architecture.md` §3.7) para incorporar la entidad `ProjectMembership` y su ciclo de vida completo, manteniendo estrictamente los principios de Arquitectura Hexagonal establecidos en ADR-001: el núcleo de dominio no depende de React, Hono, Workers ni mecanismos de almacenamiento concretos.

Véase [proposal.md](proposal.md) para el alcance y justificación funcional.

## Goals / Non-Goals

**Goals:**

- Definir la entidad `ProjectMembership` y el puerto `MembershipRepositoryPort` en `@is488/shared`.
- Definir el puerto `ProjectCreationPort` en `@is488/shared` con la operación `createProjectWithOwner` para encapsular la creación coordinada de proyecto y membresía `owner`.
- Implementar esquemas Zod para creación, respuesta y listado de membresías.
- Implementar `AddMemberUseCase`, `RemoveMemberUseCase` y `ListMembersUseCase` desacoplados de Hono.
- Actualizar `CreateProjectUseCase` para delegar la creación coordinada del proyecto y su membresía `owner` al `ProjectCreationPort`, garantizando consistencia todo-o-nada.
- Implementar `InMemoryProjectCreationAdapter` que opera sobre `Map` compartidos con los repositorios individuales (Patrón B.1).
- Actualizar `GetProjectByIdUseCase` y `ListProjectsUseCase` para considerar membresía activa en la autorización.
- Implementar `InMemoryMembershipRepository` para desarrollo y pruebas.
- Exponer tres nuevos endpoints REST documentados en OpenAPI 3.1.
- Implementar la interfaz de gestión de integrantes en `apps/web`.
- Cubrir con pruebas todos los escenarios críticos: propietario, integrante autorizado, usuario ajeno, membresía duplicada, retirada de integrante, identidad no autenticada, y consistencia al crear proyectos.

**Non-Goals:**

- No conectar a PostgreSQL/Drizzle en este incremento (ADR-003, spike pendiente).
- No implementar invitaciones por correo ni notificaciones por membresía.
- No implementar entidades `Team` ni `TeamMember`.
- No implementar paginación de la lista de miembros.
- No implementar roles adicionales (`viewer`, `moderator`) más allá de `owner` y `collaborator`.
- No implementar Google OAuth ni Better Auth real (ADR-004, spike pendiente).

## Decisions

### Decisión 1: Membresía directa usuario–proyecto (aprobada P1)

**Elección:** Relación directa `ProjectMembership` entre `User` y `Project`, sin pasar por una entidad `Team`.

**Justificación:**
- El ERD canónico (`docs/04-data-model.md` L7, L11) define exactamente esta relación: `USER ||--o{ PROJECT_MEMBERSHIP` y `PROJECT ||--o{ PROJECT_MEMBERSHIP`.
- FR-005 establece "crear un proyecto con **miembros**", no "con equipos".
- La entidad `project_memberships` con campos `proyecto, usuario, rol en el proyecto, estado y fecha de incorporación` está definida en `docs/04-data-model.md` L37.
- La implementación de equipos independientes implicaría entidades no contempladas en el ERD actual.

**Alternativa rechazada:** Membresía derivada de `Team` → requeriría rediseño del modelo de datos sin respaldo en requisitos aprobados.

---

### Decisión 2: Quién puede agregar y retirar integrantes (aprobada P2)

**Elección:** Solo el creador original del proyecto (`creatorId`) puede agregar o retirar integrantes en v1.

**Justificación:** Regla simple, verificable mediante una única comprobación en el caso de uso, y alineada con FR-006 ("reglas explícitas de membresía"). Elimina ambigüedad sobre quién tiene autoridad sobre la composición del equipo en este incremento.

**Implicación futura:** Si en un EPIC posterior se requiere que múltiples `owner` puedan gestionar miembros, se añadirá una regla que permita a cualquier miembro con `role === 'owner'` realizar estas operaciones, sin cambiar la interfaz del puerto.

---

### Decisión 3: Política de respuestas HTTP para acceso (aprobada P3)

| Situación | Respuesta | Justificación |
|-----------|-----------|---------------|
| Sin identidad autenticada válida | **401 Unauthorized** | No existe contexto de usuario; el recurso no puede evaluarse |
| Proyecto no encontrado (ID inexistente) | **404 Not Found** | No existe el recurso |
| Proyecto existente sin membresía del solicitante | **404 Not Found** | Defensa en profundidad: no revelar existencia del proyecto |
| Solicitante autenticado intenta agregar miembro sin ser creador | **403 Forbidden** | El recurso existe y el usuario lo conoce; la acción específica no está permitida |
| Membresía duplicada activa | **409 Conflict** | El estado actual impide la operación |
| Intento de retirar al propietario | **422 Unprocessable Entity** | La solicitud es válida en forma pero inválida en negocio |

**Justificación de 404 vs 403 para acceso a proyecto:** La spec `identity-access/spec.md` L34 exige "deny without disclosing private project data". La spec `projects-teams/spec.md` L60 permite "404 or 403". Se elige 404 para que un atacante no pueda enumerar proyectos existentes probando IDs.

**Orden de comprobaciones en `RemoveMemberUseCase` y su implicación de seguridad:**
El orden acordado es: (1) verificar existencia del proyecto → 404, (2) verificar que el requestor
es el creador → 403, (3) verificar membresía activa del target → 404, (4) rechazar si target es
owner → 422.

La comprobación (2) emite un 403 *después* de confirmar que el proyecto existe. Esto implica que
un solicitante que recibe 403 sabe que el proyecto con ese ID existe. Esta es la **política acordada
explícitamente en P3**: el 403 se usa cuando "el recurso existe y el usuario lo conoce; la acción
específica no está permitida". La premisa es que un colaborador que intenta gestionar miembros ya
conoce el ID del proyecto (le fue compartido por el creador). Para solicitudes de usuarios
totalmente ajenos que llegan a `GET /api/projects/:id` o `GET /api/projects/:id/members`,
se usa 404, preservando la opacidad del sistema.

---

### Decisión 4: Consistencia al crear proyecto + membresía `owner` mediante `ProjectCreationPort` (aprobada P4, revisada P4-R1)

**Elección:** Introducir un puerto dedicado `ProjectCreationPort` con una única operación
`createProjectWithOwner(project, ownerMembership)` que encapsula la creación coordinada del
proyecto y su membresía `owner`. `CreateProjectUseCase` deja de invocar dos repositorios
independientes y delega la operación compuesta en este puerto.

**Contrato del puerto (`packages/shared/src/ports/project-creation.port.ts`):**

```typescript
import type { Project } from './project-repository.port.js';
import type { ProjectMembership } from './membership-repository.port.js';

/**
 * Puerto driven (secundario) para la creación coordinada de un proyecto
 * y su membresía owner. Encapsula la garantía de consistencia:
 * al retornar sin error, tanto el proyecto como la membresía están persistidos;
 * ante cualquier fallo, ninguno de los dos queda persistido.
 */
export interface ProjectCreationPort {
  createProjectWithOwner(
    project: Project,
    ownerMembership: ProjectMembership,
  ): Promise<void>;
}
```

**Responsabilidades del puerto:**
1. Validar precondiciones antes de mutar estado (e.g., que no exista ya un proyecto con el
   mismo `id`, que no exista una membresía activa duplicada).
2. Persistir proyecto y membresía de forma que, ante cualquier fallo, ninguno de los dos
   quede persistido (semántica de todo-o-nada).
3. El caso de uso no conoce el mecanismo de consistencia; solo invoca una operación.

**Adaptador en memoria — `InMemoryProjectCreationAdapter`:**

```
InMemoryProjectCreationAdapter.createProjectWithOwner(project, ownerMembership):
  1. Validar precondiciones (ninguna mutación ocurre si alguna falla):
     - projectMap.has(project.id) === false        → lanzar ProjectAlreadyExistsError
     - membershipMap no contiene membresía activa
       para (project.id, ownerMembership.userId)   → lanzar DuplicateMembershipError
     Nota: la comprobación de membresía duplicada recorre linealmente los valores de
     membershipMap. Esto es aceptable para el adaptador de desarrollo en memoria; el
     adaptador PostgreSQL lo reemplazará por una consulta con índice compuesto.
  2. Mutar estado (síncronamente, sin await intercalado):
     projectMap.set(project.id, { ...project })     // primera mutación
     try {
       membershipMap.set(ownerMembership.id, { ...ownerMembership })  // segunda mutación
     } catch (mutationError) {
       // Compensación: revertir la primera mutación.
       // Esto NO es una transacción ACID; es una compensación best-effort.
       projectMap.delete(project.id)
       throw mutationError  // propagar siempre — nunca ocultar el fallo
     }
```

**Aclaración sobre la garantía de consistencia en memoria:**
Dos llamadas consecutivas a `Map.set()` **no son una transacción atómica** en sentido ACID.
La garantía real que ofrece este adaptador es de naturaleza estructural:
- **Sin interleaving:** No se introduce ningún `await`, `setTimeout` ni operación asíncrona
  entre las dos mutaciones. En el entorno single-threaded de JavaScript esto elimina la
  posibilidad de que otra tarea del event loop observe un estado parcial entre ambas
  mutaciones exitosas.
- **Validación antes de mutación:** Todas las precondiciones se verifican *antes* de la
  primera llamada a `Map.set()`. Si alguna falla, ningún `Map` se modifica.
- **Compensación ante fallo en la segunda mutación:** Si `membershipMap.set()` lanzara,
  el bloque `catch` ejecuta `projectMap.delete(project.id)` como operación de compensación
  y propaga el error original sin ocultarlo.
- **Límites de la compensación:** La compensación (`projectMap.delete`) **puede fallar**
  en escenarios patológicos (p. ej., si se sustituye `projectMap` por un `Map` instrumentado
  que lanza también en `delete`). Si la compensación falla, el adaptador **no debe afirmar
  que el estado quedó restaurado**; debe propagar la excepción y permitir que el llamador
  (el adaptador HTTP) responda con 500. El estado del almacén en ese caso es inconsistente
  y observable. Esto es una limitación documentada y aceptada del adaptador en memoria.
  El adaptador PostgreSQL elimina esta limitación mediante una transacción SQL real.

**Inyección compartida de `Map` desde `app.ts` (Patrón B.1) — contrato obligatorio:**

`createApp` **debe** crear exactamente **una instancia** de `projectMap` y **una instancia** de
`membershipMap`, e inyectar esas mismas referencias — no copias — en los tres adaptadores que
las requieren. Esta unicidad es la condición que hace que la garantía todo-o-nada del
`InMemoryProjectCreationAdapter` sea observable desde los repositorios individuales.

```
createApp(options):
  // ── UNA SOLA instancia de cada Map ──────────────────────────────────────
  const projectMap    = new Map<string, Project>()
  const membershipMap = new Map<string, ProjectMembership>()

  // ── Repositorios individuales: reciben la misma referencia ───────────────
  const projectRepository = options.projectRepository
    ?? new InMemoryProjectRepository(projectMap)        // ← misma ref que el adaptador
  const membershipRepository = options.membershipRepository
    ?? new InMemoryMembershipRepository(membershipMap)  // ← misma ref que el adaptador

  // ── Adaptador de creación coordinada: recibe las mismas referencias ──────
  const projectCreationPort = options.projectCreationPort
    ?? new InMemoryProjectCreationAdapter(projectMap, membershipMap)
    //                                    ↑ misma ref   ↑ misma ref
```

**Por qué esta unicidad es necesaria:**
Si `InMemoryProjectRepository` opera sobre un `Map` distinto al que usa
`InMemoryProjectCreationAdapter`, `projectRepository.findById()` no encontrará el proyecto
recién creado, aunque `createProjectWithOwner` haya retornado sin error. La garantía
todo-o-nada del adaptador quedaría intacta internamente, pero sería invisible para el resto
del sistema. Esta invariante de composición no puede expresarse en el tipo del puerto; debe
verificarse mediante pruebas de integración sobre `createApp` (ver tareas 2.5 y 4.2).

Este requisito de unicidad **no aplica** a las pruebas unitarias de los adaptadores
individuales, donde cada test crea sus propios `Map` frescos para aislamiento.

**Compatibilidad con PostgreSQL (ADR-003) — transacción real:**

El futuro `PostgresProjectCreationAdapter` implementará `ProjectCreationPort` envolviendo
ambas inserciones en una transacción SQL con semántica ACID:

```sql
BEGIN;
  INSERT INTO projects   (id, ...) VALUES (:projectId, ...);
  INSERT INTO project_memberships (id, project_id, ...) VALUES (:membershipId, :projectId, ...);
COMMIT;
-- Si cualquier INSERT falla:
ROLLBACK;
```

El caso de uso no cambia; solo se sustituye el adaptador inyectado. La garantía pasa de
ser estructural (sin interleaving en el event loop + compensación best-effort) a ser
transaccional (con `BEGIN`/`COMMIT`/`ROLLBACK` del motor SQL).

**Nota sobre identificadores (UUID generados antes de invocar el puerto):**
Los identificadores de proyecto (`project.id`) y de membresía (`ownerMembership.id`) son
generados por `CreateProjectUseCase` **antes** de invocar `createProjectWithOwner`. El
adaptador recibe objetos ya construidos con sus `id` definitivos. El `PostgresProjectCreationAdapter`
debe persistir los `id` recibidos en los parámetros y **no debe depender de que la base de
datos genere los identificadores** (p. ej., mediante `SERIAL`, `BIGSERIAL` o `RETURNING id`
sin usar el valor recibido). El patrón de UUID generado en aplicación es consistente con la
arquitectura hexagonal: el dominio controla su identidad, el adaptador solo persiste.

---

### Decisión 5: Coordinación entre repositorios en el caso de uso (aprobada P5)

**Elección:** El caso de uso `ListProjectsUseCase` coordina `ProjectRepositoryPort` y `MembershipRepositoryPort`; los puertos permanecen desacoplados entre sí.

**Flujo:**
```
ListProjectsUseCase.execute(query):
  1. membershipRepo.findByUser(userId)  → lista de projectIds donde el usuario es miembro activo
  2. projectRepo.findByUser(userId)     → proyectos donde es creatorId
  3. Unión de los dos conjuntos (deduplicada por projectId)
  4. Validar y retornar con ProjectListResponseSchema
```

**Ventaja:** `ProjectRepositoryPort.findByUser` mantiene su semántica de "proyectos creados por el usuario" sin modificar su firma ni introducir dependencias hacia `MembershipRepositoryPort`. La composición ocurre solo en la capa de aplicación.

---

### Decisión 6: Campo `role` en `ProjectMembership` (aprobada P6)

**Elección:** `ProjectMembership.role` es un literal de tipo string con valores `'owner' | 'collaborator'`.

**Definición de valores:**

| Valor | Asignado automáticamente por | Quién lo tiene | Permisos en v1 |
|-------|------------------------------|----------------|----------------|
| `'owner'` | `CreateProjectUseCase` al crear el proyecto | Exactamente el `creatorId` | Ver proyecto, listar miembros, agregar/retirar miembros |
| `'collaborator'` | `AddMemberUseCase` al agregar un integrante | Cualquier usuario invitado | Ver proyecto, listar miembros (sin agregar/retirar) |

**Coherencia con `creatorId`:** La invariante es: *siempre existe exactamente una membresía activa con `role === 'owner'` cuyo `userId === project.creatorId`*. Se verificará en las pruebas unitarias de `CreateProjectUseCase`.

**Protección contra inconsistencias:** `RemoveMemberUseCase` rechaza con 422 cualquier intento de retirar al `owner`. No existe endpoint para cambiar el `role` de una membresía en esta versión.

**Por qué `GetProjectByIdUseCase` usa `creatorId` directamente (sin consultar `MembershipRepositoryPort`):**
Esta comprobación es una optimización válida en tanto la invariante de propietario esté garantizada:
- Si `project.creatorId === userId`, el usuario tiene acceso por definición (es el creador).
- `CreateProjectUseCase` garantiza que siempre existe una membresía `owner` para `creatorId`,
  pero la comprobación de `creatorId` directa evita una consulta al repositorio de membresías
  para el caso más frecuente.
- Si la invariante se rompe (e.g., bug en `CreateProjectUseCase`), el acceso por `creatorId`
  sigue funcionando correctamente para el propietario real.
- **Comentario JSDoc obligatorio:** la implementación debe documentar este razonamiento en
  `GetProjectByIdUseCase` para que futuros colaboradores no eliminen la comprobación creyendo
  que `isMember` es suficiente.

---

### Decisión 7: Interfaz de gestión de integrantes incluida en este incremento (aprobada P7)

**Elección:** El componente de gestión de miembros se incluye en `apps/web` para hacer el incremento verticalmente completo.

**Componentes UI:**
- `ProjectMembersList`: visible para todos los miembros activos del proyecto.
- `AddMemberModal`: visible y operable solo para el creador del proyecto; incluye campo de `userId`, selector de rol (`collaborator`), validación reactiva y bloqueo de envío doble.

**Restricción de alcance:** No se incluyen funcionalidades de búsqueda de usuarios por nombre, autocompletado ni gestión de invitaciones.

## Risks / Trade-offs

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Fallo teórico en segunda mutación de `Map.set()` dentro de `InMemoryProjectCreationAdapter` | Proyecto insertado sin membresía owner | El adaptador ejecuta `projectMap.delete(project.id)` como rollback manual; se verifica con test de `Map` instrumentado para lanzar en `set` |
| Tareas asignadas a miembros retirados | Asignados no elegibles al ejecutar futuros flujos de boards | Documentado como restricción conocida; se resolverá en el EPIC de boards/tasks |
| Dos repositorios en memoria con estado independiente | Riesgo de tests acoplados por estado compartido | Cada test usa `beforeEach` para inicializar repositorios frescos; en `app.ts` los `Map` se crean una sola vez y se inyectan en todos los adaptadores (Patrón B.1) |
| `findByUser` retorna unión: posible proyecto duplicado si el usuario es creador Y miembro | Lista con duplicados | `ListProjectsUseCase` deduplica por `id` antes de retornar |
| Migración a PostgreSQL requiere transacciones reales | Sin `BEGIN`/`COMMIT`/`ROLLBACK` se pierde la semántica todo-o-nada | El `PostgresProjectCreationAdapter` implementará `ProjectCreationPort` con transacción SQL; el caso de uso no cambia |
