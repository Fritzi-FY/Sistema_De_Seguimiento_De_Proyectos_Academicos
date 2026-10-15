## 1. Shared Package — Dominio, Puertos y Contratos (`packages/shared`)

- [x] 1.1 Definir la entidad de dominio `ProjectMembership` y la interfaz del puerto driven
      `MembershipRepositoryPort` en `packages/shared/src/ports/membership-repository.port.ts`.
      Campos de entidad: `id` (UUID v4), `projectId`, `userId`,
      `role` (`'owner' | 'collaborator'`), `status` (`'active' | 'removed'`),
      `joinedAt` (ISO-8601 UTC), `updatedAt` (ISO-8601 UTC).
      Operaciones del puerto: `addMember`, `removeMember`, `findByProject`,
      `findByUser`, `findByProjectAndUser`.

- [x] 1.2 Definir la interfaz del puerto driven `ProjectCreationPort` en
      `packages/shared/src/ports/project-creation.port.ts`.
      - Operación única: `createProjectWithOwner(project: Project, ownerMembership: ProjectMembership): Promise<void>`.
      - Semántica: al retornar sin error, tanto el proyecto como la membresía están
        persistidos; ante cualquier fallo, ninguno de los dos queda persistido.
      - JSDoc del puerto debe documentar la garantía todo-o-nada y la responsabilidad
        del adaptador de implementar el mecanismo de consistencia apropiado.

- [x] 1.3 Definir los esquemas Zod en `packages/shared/src/contracts/membership.contract.ts`:
      - `AddMemberRequestSchema`: `userId` (UUID válido), `role` (literal `'collaborator'`
        únicamente; el rol `owner` se asigna solo internamente).
      - `MembershipResponseSchema`: todos los campos de `ProjectMembership`.
      - `MemberListResponseSchema`: array de `MembershipResponseSchema`.

- [x] 1.4 Exportar los nuevos contratos, tipos y puertos en `packages/shared/src/index.ts`:
      - `MembershipRepositoryPort`, `ProjectMembership` y tipos relacionados.
      - `ProjectCreationPort`.
      - `AddMemberRequestSchema`, `MembershipResponseSchema`, `MemberListResponseSchema`.

- [x] 1.5 Actualizar el comentario JSDoc de `ProjectRepositoryPort.findByUser` para reflejar
      que la semántica de "proyectos del usuario" se amplía mediante coordinación en el
      caso de uso (la firma del método no cambia).

- [x] 1.6 Escribir pruebas unitarias en
      `packages/shared/src/contracts/membership.contract.test.ts`:
      - Aceptación de carga válida con `userId` UUID y `role: 'collaborator'`.
      - Rechazo de `userId` con formato no UUID.
      - Rechazo de `role` con valor fuera del enum (`'owner'`, `'admin'`, cadena vacía).
      - Validación de campos obligatorios de `MembershipResponseSchema`.

## 2. Adaptadores en Memoria (`apps/api` — infraestructura)

- [x] 2.1 Actualizar `InMemoryProjectRepository` en
      `apps/api/src/infrastructure/adapters/repositories/in-memory-project.repository.ts`:
      - El constructor debe aceptar una instancia opcional de `Map<string, Project>` como
        parámetro. Si se proporciona, el repositorio opera sobre ese `Map` compartido;
        si no, crea su propio `Map` interno (compatibilidad retroactiva con tests existentes).
      - El constructor existente con `initialProjects: Project[]` se mantiene como alternativa.
        Se puede implementar con sobrecarga o con un parámetro `storage?: Map<string, Project>`.
      - **No modificar la lógica de negocio** de los métodos existentes (`save`, `findById`,
        `findAll`, `findByUser`, `clear`); solo se modifica la fuente del `Map`.

- [x] 2.2 Implementar `InMemoryMembershipRepository` en
      `apps/api/src/infrastructure/adapters/repositories/in-memory-membership.repository.ts`.
      - El constructor acepta una instancia opcional de `Map<string, ProjectMembership>`.
        Si se proporciona, opera sobre ese `Map` compartido; si no, crea uno propio.
      - `addMember`: generar UUID, verificar que no exista membresía activa para el mismo
        par `projectId + userId`; si existe, lanzar `DuplicateMembershipError`.
      - `removeMember`: cambiar `status` a `'removed'`; si no existe, lanzar `MembershipNotFoundError`.
      - `findByProject`: retornar solo las membresías con `status === 'active'` del proyecto.
      - `findByUser`: retornar solo las membresías con `status === 'active'` del usuario.
      - `findByProjectAndUser`: retornar la membresía activa para el par, o `null`.
      - Método `clear()` para pruebas.

- [x] 2.3 Implementar `InMemoryProjectCreationAdapter` en
      `apps/api/src/infrastructure/adapters/repositories/in-memory-project-creation.adapter.ts`.
      - Constructor: recibe `projectMap: Map<string, Project>` y
        `membershipMap: Map<string, ProjectMembership>` — **las mismas instancias** que
        `InMemoryProjectRepository` e `InMemoryMembershipRepository` (Patrón B.1).
      - Implementa `ProjectCreationPort.createProjectWithOwner(project, ownerMembership)`:
        1. **Validar precondiciones** (antes de mutar cualquier `Map`):
           - `projectMap.has(project.id) === false` → lanzar `ProjectAlreadyExistsError` si ya existe.
           - No existe membresía activa para `(project.id, ownerMembership.userId)` en
             `membershipMap` → lanzar `DuplicateMembershipError` si duplicada.
        2. **Mutar estado (síncronamente, sin `await` intercalado):**
           ```
           projectMap.set(project.id, { ...project })
           try {
             membershipMap.set(ownerMembership.id, { ...ownerMembership })
           } catch (error) {
             projectMap.delete(project.id)  // rollback de la primera mutación
             throw error
           }
           ```
        3. **Nota:** No se introduce `await`, `setTimeout` ni ninguna operación asíncrona
           entre las dos mutaciones de `Map`. Esto es intencional y obligatorio.

- [x] 2.4 Escribir pruebas unitarias en
      `apps/api/src/infrastructure/adapters/repositories/in-memory-membership.repository.test.ts`:
      - `addMember` exitoso retorna membresía con `id` UUID y `status: 'active'`.
      - `addMember` con par duplicado activo lanza `DuplicateMembershipError`.
      - `removeMember` exitoso cambia `status` a `'removed'`.
      - `removeMember` de membresía inexistente lanza `MembershipNotFoundError`.
      - `findByProject` retorna solo miembros activos (excluye los removidos).
      - `findByUser` retorna solo membresías activas del usuario.
      - `findByProjectAndUser` retorna `null` si no hay membresía activa.
      - **[H3]** Ciclo de re-adición: tras `addMember`, `removeMember` y un segundo
        `addMember` para el mismo par (`projectId` + `userId`), el repositorio contiene
        **dos registros** para ese par (el primero con `status: 'removed'`, el segundo con
        `status: 'active'`). `findByProjectAndUser` retorna únicamente el registro `active`.
        `findByProject` excluye el registro `removed` y solo incluye el nuevo `active`.

- [x] 2.5 Escribir pruebas unitarias en
      `apps/api/src/infrastructure/adapters/repositories/in-memory-project-creation.adapter.test.ts`:
      - **Caso exitoso:** tras `createProjectWithOwner`, tanto `projectMap` como `membershipMap`
        contienen los registros esperados. Una lectura a través de `InMemoryProjectRepository`
        (construido con el mismo `projectMap`) retorna el proyecto.
      - **Fallo en precondición — proyecto duplicado:** si `projectMap` ya contiene un proyecto
        con el mismo `id`, lanza `ProjectAlreadyExistsError` y ni `projectMap` ni `membershipMap`
        se modifican.
      - **Fallo en precondición — membresía duplicada:** si ya existe membresía activa para
        el par `(projectId, userId)`, lanza `DuplicateMembershipError` y ningún `Map` se modifica.
      - **Fallo en segunda mutación (Map instrumentado):**
        - Construir un `Map` proxy/subclase cuyo `set()` lance un error al ser invocado.
        - Inyectarlo **exclusivamente como `membershipMap`** (segundo parámetro del constructor).
          `projectMap` es un `Map` normal; su `set()` se completa sin error.
        - Ejecutar `createProjectWithOwner` y verificar que:
          - `projectMap` **no contiene** el proyecto (la compensación `delete` fue invocada).
          - `membershipMap` **no contiene** la membresía (el `set` falló antes de insertar).
          - El adaptador propaga el error original sin modificarlo.
        - **Nota de alcance:** este test no cubre el caso en que la propia compensación
          (`projectMap.delete`) falle. Ese escenario es patológico y está documentado como
          limitación en `design.md`; no se requiere una prueba automatizada para él.
      - **Integración con composición correcta (mismas instancias de `Map`):**
        - Crear `projectMap` y `membershipMap`.
        - Construir `InMemoryProjectRepository(projectMap)`,
          `InMemoryMembershipRepository(membershipMap)` e
          `InMemoryProjectCreationAdapter(projectMap, membershipMap)` — las tres clases
          reciben las **mismas** referencias.
        - Invocar `createProjectWithOwner(project, ownerMembership)`.
        - Verificar comportamiento observable a través de la API de los repositorios:
          - `projectRepository.findById(project.id)` retorna el proyecto con los campos
            correctos (no `null`, no `undefined`).
          - `membershipRepository.findByProjectAndUser(project.id, ownerMembership.userId)`
            retorna la membresía con `role: 'owner'` y `status: 'active'` (no `null`).
        - Esta prueba verifica que la composición de `app.ts` produce un sistema observable
          coherente, no solo que las dependencias están presentes.

## 3. Casos de Uso — Aplicación (`apps/api` — application)

- [x] 3.1 Actualizar `CreateProjectUseCase` en
      `apps/api/src/application/use-cases/create-project.use-case.ts`:
      - **Contrato de dependencias del constructor:**
        - Depende de `ProjectCreationPort` como mecanismo de persistencia coordinada.
        - Conserva `SystemClockPort` para generar timestamps y `idGenerator` para UUID.
        - **No recibe `MembershipRepositoryPort` como dependencia directa.** La
          coordinación de la persistencia de la membresía es responsabilidad exclusiva del
          adaptador de `ProjectCreationPort`, no del caso de uso.
      - **Reemplazar** `ProjectRepositoryPort` por `ProjectCreationPort` como dependencia
        para la operación de creación. El caso de uso ya no invoca `projectRepository.save()`
        seguido de `membershipRepository.addMember()` por separado.
      - El flujo actualizado es:
        1. Validar entradas (Zod).
        2. Generar `projectId`, `membershipId`, timestamps (usando `idGenerator` y `clock`).
        3. Construir el objeto `Project` y el objeto `ProjectMembership` con
           `role: 'owner'`, `status: 'active'`.
        4. Invocar `projectCreationPort.createProjectWithOwner(project, ownerMembership)`.
        5. Si `createProjectWithOwner` lanza, propagar el error (el puerto garantiza
           que ni el proyecto ni la membresía quedan persistidos).
        6. Retornar `ProjectResponseSchema.parse(project)`.
      - Documentar con JSDoc:
        `@throws {Error} Si createProjectWithOwner falla, ni el proyecto ni la membresía
        quedan persistidos. La garantía de consistencia es responsabilidad del adaptador
        inyectado (en memoria: sin interleaving + compensación best-effort; en PostgreSQL:
        transacción SQL con BEGIN/COMMIT/ROLLBACK).`

- [x] 3.2 Actualizar las pruebas unitarias de `CreateProjectUseCase`
      (`create-project.use-case.test.ts`):
      - Verificar que tras la creación exitosa del proyecto, el `ProjectCreationPort` fake
        recibió tanto el proyecto como la membresía `owner` con los campos correctos
        (`role: 'owner'`, `status: 'active'`, `userId === creatorId`).
      - Verificar que si el `ProjectCreationPort` fake lanza, el caso de uso propaga el
        error correctamente (no retorna el proyecto).
      - **[Atomicidad]** Verificar que ante un fallo del `ProjectCreationPort`, ni el
        proyecto ni la membresía quedan persistidos. Esto se demuestra usando un
        `FakeProjectCreationPort` que lanza, y verificando que los `Map` subyacentes
        (o el fake) permanecen vacíos.
      - Nota: las pruebas existentes de `CreateProjectUseCase` que verifican validación
        de entrada, generación de UUID, timestamps, etc. se mantienen sin cambios,
        adaptando solo la inyección de dependencias al nuevo constructor.

- [x] 3.3 Implementar `AddMemberUseCase` en
      `apps/api/src/application/use-cases/add-member.use-case.ts`:
      - Dependencias: `ProjectRepositoryPort`, `MembershipRepositoryPort`, `SystemClockPort`.
      - Validar que `command.requesterId` es el `creatorId` del proyecto (403 si no).
      - Verificar que el proyecto existe (404 si no).
      - Verificar ausencia de membresía activa para `userId` en el proyecto (409 si existe).
      - Persistir membresía con `role: 'collaborator'` y `status: 'active'`.
      - Retornar `MembershipResponseSchema.parse(membership)`.

- [x] 3.4 Escribir pruebas unitarias para `AddMemberUseCase`
      (`add-member.use-case.test.ts`):
      - Éxito: membresía creada y retornada correctamente.
      - 403: solicitante no es el creador del proyecto.
      - 404: proyecto no encontrado.
      - 409: membresía duplicada activa.
      - Fallo si `userId` es cadena vacía o inválida.

- [x] 3.5 Implementar `RemoveMemberUseCase` en
      `apps/api/src/application/use-cases/remove-member.use-case.ts`:
      - Dependencias: `ProjectRepositoryPort`, `MembershipRepositoryPort`, `SystemClockPort`.
      - Verificar que el proyecto existe (404 si no).
      - Validar que `command.requesterId` es el `creatorId` del proyecto (403 si no).
      - Verificar que la membresía activa del `targetUserId` existe (404 si no).
      - Rechazar si `targetUserId === project.creatorId` con error semántico (422).
      - Invocar `membershipRepository.removeMember(membershipId)`.

- [x] 3.6 Escribir pruebas unitarias para `RemoveMemberUseCase`
      (`remove-member.use-case.test.ts`):
      - Éxito: membresía cambia a `status: 'removed'`.
      - 403: solicitante no es el creador.
      - 404: proyecto no encontrado.
      - 404: membresía del target no encontrada.
      - 422: intento de retirar al propietario.

- [x] 3.7 Implementar `ListMembersUseCase` en
      `apps/api/src/application/use-cases/list-members.use-case.ts`:
      - Dependencias: `ProjectRepositoryPort`, `MembershipRepositoryPort`.
      - Verificar que el proyecto existe (404 si no).
      - Verificar que el solicitante tiene membresía activa en el proyecto (404 si no,
        siguiendo política de no revelar existencia).
      - Retornar `MemberListResponseSchema.parse(members)`.

- [x] 3.8 Escribir pruebas unitarias para `ListMembersUseCase`
      (`list-members.use-case.test.ts`):
      - Éxito: lista de miembros activos retornada correctamente.
      - 404: proyecto no encontrado.
      - 404: solicitante sin membresía activa.
      - Lista vacía si el único miembro es el owner que fue consultado.

- [x] 3.9 Actualizar `GetProjectByIdUseCase` en
      `apps/api/src/application/use-cases/list-projects.use-case.ts`:
      - Añadir `MembershipRepositoryPort` como segunda dependencia inyectada.
      - La verificación de acceso pasa de solo `creatorId` a:
        `isOwner = project.creatorId === cleanUserId`
        `isMember = (await membershipRepo.findByProjectAndUser(id, cleanUserId)) !== null`
        `isElevated = role === 'admin' || role === 'teacher'`
        Acceso concedido si `isOwner || isMember || isElevated`.

- [x] 3.10 Actualizar `ListProjectsUseCase` en
       `apps/api/src/application/use-cases/list-projects.use-case.ts`:
       - Añadir `MembershipRepositoryPort` como segunda dependencia.
       - Flujo estudiante: obtener `projectIds` de `membershipRepo.findByUser(userId)`,
         obtener proyectos creados con `projectRepo.findByUser(userId)`,
         unir y deduplicar por `id`.

- [x] 3.11 Actualizar pruebas de `GetProjectByIdUseCase`
       (`list-projects.use-case.test.ts`):
       - Acceso concedido al miembro no creador (`collaborator`).
       - Acceso denegado (null → 404) al usuario sin membresía.
       - Acceso concedido al creador aunque no tenga entrada explícita de membresía
         en el repositorio fake (compatibilidad retroactiva).

- [x] 3.12 Actualizar pruebas de `ListProjectsUseCase`:
       - Escenario P1-P2-P3: estudiante-A es creador de P1, collaborator en P2 (creado
         por estudiante-B), sin membresía en P3 → lista retorna solo P1 y P2.
       - Deduplicación: si estudiante-A es creador Y tiene membresía, aparece una sola vez.

## 4. Infraestructura HTTP y OpenAPI (`apps/api` — infraestructura)

- [x] 4.1 Implementar `project-members.route.ts` en
      `apps/api/src/infrastructure/http/routes/project-members.route.ts` con:
      - `POST /:projectId/members` → `AddMemberUseCase` (201, 400, 401, 403, 404, 409).
      - `DELETE /:projectId/members/:userId` → `RemoveMemberUseCase` (200, 401, 403, 404, 422).
      - `GET /:projectId/members` → `ListMembersUseCase` (200, 401, 404).
      - Manejador de métodos no soportados (405 con cabecera `Allow`).
      - Aplicar `devAuthMiddleware` a todas las rutas.

- [x] 4.2 Actualizar `apps/api/src/infrastructure/http/app.ts` (Patrón B.1):
      - Ampliar `AppOptions` con:
        - `membershipRepository?: MembershipRepositoryPort`
        - `projectCreationPort?: ProjectCreationPort`
      - Crear las instancias de `Map` una sola vez en `createApp`:
        ```
        const projectMap = new Map<string, Project>()
        const membershipMap = new Map<string, ProjectMembership>()
        ```
      - Inyectar los `Map` compartidos en los repositorios individuales:
        ```
        const projectRepository = options.projectRepository
          ?? new InMemoryProjectRepository(projectMap)
        const membershipRepository = options.membershipRepository
          ?? new InMemoryMembershipRepository(membershipMap)
        ```
      - Inyectar los mismos `Map` en el adaptador de creación coordinada:
        ```
        const projectCreationPort = options.projectCreationPort
          ?? new InMemoryProjectCreationAdapter(projectMap, membershipMap)
        ```
      - Pasar `projectCreationPort` a `CreateProjectUseCase`.
      - Pasar `membershipRepository` a `GetProjectByIdUseCase`, `ListProjectsUseCase`,
        `AddMemberUseCase`, `RemoveMemberUseCase`, `ListMembersUseCase`.
      - **[H6]** La misma instancia de `clock` (ya instanciada en `createApp`) se pasa a
        `AddMemberUseCase` y `RemoveMemberUseCase`. No crear una segunda instancia del reloj.
      - Montar el enrutador de miembros bajo `/api/projects` siguiendo el patrón de
        `createProjectsRouter(projectRepository, clock, { nodeEnv })`. El nuevo enrutador
        deberá llamarse `createProjectMembersRouter(membershipRepository, projectRepository, clock, { nodeEnv })`
        o equivalente, recibiendo las dependencias como parámetros.

- [x] 4.3 Actualizar `apps/api/src/infrastructure/openapi/openapi.contract.ts`
      con los tres nuevos endpoints y sus esquemas de request/response/error.
      - **[H12]** Registrar los schemas `AddMemberRequest`, `MembershipResponse` y
        `MemberListResponse` en la sección `components/schemas` del objeto `openApiSpec`,
        siguiendo el patrón existente (todos los schemas actuales están en `components/schemas`
        y se referencian desde los paths con `$ref: '#/components/schemas/...'`).
      - No usar schemas inline en las definiciones de paths.
      - `MembershipResponse` debe incluir todos los campos de `ProjectMembership`:
        `id`, `projectId`, `userId`, `role`, `status`, `joinedAt`, `updatedAt`.
      - El body de la respuesta 200 del `DELETE` debe referenciar `MembershipResponse`.

- [x] 4.4 Escribir pruebas de integración HTTP en
      `apps/api/src/infrastructure/http/routes/project-members.route.test.ts`:
      - `POST /api/projects/:id/members`: éxito 201, duplicado 409,
        solicitante sin ser creador 403, proyecto inexistente 404, sin auth 401.
      - **[Nuevo — H7]** `POST /api/projects/:id/members` con body
        `{ "userId": "<uuid>", "role": "owner" }` → 400 con error de validación en el
        campo `role` (el schema solo acepta `'collaborator'`; no debe crearse ningún
        registro de membresía).
      - `DELETE /api/projects/:id/members/:userId`: éxito 200 con body de membresía
        actualizada (`status: "removed"`), owner 422, no autorizado 403,
        proyecto inexistente 404, sin membresía del target 404, sin auth 401.
      - `GET /api/projects/:id/members`: éxito 200 con lista, sin membresía 404, sin auth 401.
      - Métodos no soportados 405 con cabecera `Allow` correcta.
      - **[Nuevo — H8]** Ciclo completo `POST`→`DELETE`→`POST` para el mismo colaborador:
        - `POST` agrega al colaborador U → 201.
        - `DELETE` retira al colaborador U → 200 con `status: "removed"`.
        - Segundo `POST` agrega al mismo U → **201** (no 409): el colaborador retirado puede
          volver a ser agregado. Verificar que `GET /api/projects/:id/members` retorna U
          como activo.

- [x] 4.5 Actualizar `apps/api/src/infrastructure/http/routes/projects.route.test.ts`:
      - Nuevo escenario de aislamiento P1-P2-P3 a nivel HTTP.
      - Verificar que `GET /api/projects/:id` retorna 200 para un `collaborator`.
      - Verificar que `GET /api/projects/:id` retorna 404 para un usuario sin membresía.

- [x] 4.6 Actualizar `apps/api/src/infrastructure/openapi/openapi.contract.test.ts`
      para verificar presencia de las tres nuevas rutas de miembros.

## 5. Frontend (`apps/web`)

- [x] 5.1 Implementar `MembershipService` en
      `apps/web/src/services/membership.service.ts`:
      - `getMembers(projectId)`: `GET /api/projects/:id/members`.
      - `addMember(projectId, body)`: `POST /api/projects/:id/members`.
      - `removeMember(projectId, userId)`: `DELETE /api/projects/:id/members/:userId`.
      - Tipado con schemas de `@is488/shared`; manejo de errores 403, 404, 409, 422.

- [x] 5.2 Escribir pruebas unitarias en
      `apps/web/src/services/membership.service.test.ts`:
      - Respuestas exitosas simuladas para los tres métodos.
      - Manejo correcto de errores HTTP (403, 404, 409, 422).

- [x] 5.3 Implementar `ProjectMembersList` en
      `apps/web/src/components/ProjectMembersList.tsx`:
      - Lista de miembros activos con userId, rol y fecha de incorporación.
      - Estado de carga (skeleton) y estado vacío.
      - Botón de retirar integrante visible solo para el creador del proyecto.

- [x] 5.4 Implementar `AddMemberModal` en
      `apps/web/src/components/AddMemberModal.tsx`:
      - Campo de `userId`, selector de rol (solo `'collaborator'` disponible).
      - Validación reactiva del formato UUID del `userId`.
      - Bloqueo de envío doble y mensaje de error accesible.
      - Visible y operable solo para el creador del proyecto.

- [x] 5.5 Crear un nuevo componente `ProjectDetail.tsx` en
      `apps/web/src/components/ProjectDetail.tsx` que actuará como vista de detalle
      de proyecto e integrará `ProjectMembersList` y `AddMemberModal`:
      - Recibir el proyecto seleccionado como prop (`project: ProjectResponse`).
      - Mostrar el título, descripción, código de curso y cronograma del proyecto.
      - Renderizar `ProjectMembersList` y (condicionalmente para el creador) `AddMemberModal`.
      - **No integrar `ProjectMembersList` ni `AddMemberModal` directamente en `AppShell.tsx`**:
        `AppShell` es la vista de lista y no tiene estado de proyecto seleccionado.
      - Conectar `ProjectDetail` desde `ProjectList` o `AppShell` mediante un estado
        `selectedProject: ProjectResponse | null`:
        - Cuando `selectedProject === null`: mostrar la vista de lista (`ProjectList`).
        - Cuando `selectedProject !== null`: mostrar `ProjectDetail` con el proyecto seleccionado.
      - Añadir botón de volver ("Volver a la lista") en `ProjectDetail` para restablecer
        `selectedProject` a `null`.

- [x] 5.6 Escribir pruebas de componentes con Vitest y React Testing Library:
      - `ProjectMembersList.test.tsx`: renderizado de lista, estado vacío, botón de retirar.
      - `AddMemberModal.test.tsx`: renderizado del modal, validación de campo, envío exitoso,
        presentación de error 409.

## 6. Verificación de Calidad y OpenSpec

- [x] 6.1 Ejecutar la suite completa de pruebas del monorepo (`npm test`) y verificar
      que todas las pruebas pasan con código de salida 0.
- [x] 6.2 Ejecutar las compuertas de análisis estático: `npm run lint`,
      `npm run typecheck` y `npm run format:check`, garantizando 0 errores y 0 advertencias.
- [x] 6.3 Ejecutar la compilación de producción (`npm run build`) y verificar la generación
      limpia de artefactos en los tres workspaces.
- [x] 6.4 Validar formalmente las especificaciones con
      `npx openspec validate --specs --strict` y `npx openspec validate --all --strict`.
- [x] 6.5 Ejecutar `git diff --check` y verificar que el árbol de trabajo se encuentra
      en estado limpio y listo para revisión humana.
