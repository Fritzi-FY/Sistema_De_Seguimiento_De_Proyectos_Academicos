> Estado D local (sesión 2026-10-26–27): D-P y D-S autorizados posteriormente por el usuario e implementados/verificados en el worktree existente, sin crear ramas, mover cambios ni Git de escritura. La evidencia de preparación y SQL local no acepta cloud ni cierra EPIC-002. Recursos/SQL remoto/E siguen pendientes. Los textos de C anteriores se conservan como historial de planificación.
## Context

Teacher scope canónico limita acceso docente por asignación o autorización explícita. El bypass está en apps/api/src/application/use-cases/list-projects.use-case.ts (ambas clases), no en PostgreSQL. ListMembersUseCase exige membresía activa; GetProjectBoardUseCase creador/membresía. No extrapolar el defecto a todos los endpoints ni declarar corregida seguridad productiva completa.

Nivel C aprobado con política del proposal; fuente institucional final pendiente. No se crean ramas/worktrees, mueven cambios ni implementa en esta fase.

## Goals / Non-Goals

Aplicar política aprobada de consulta sin perder permisos de creador/colaborador. Denegación por defecto y 404 ajeno, listado filtrado en servidor, asignación sin mutaciones implícitas. Mantener dominio/aplicación sin pg/React/Hono/SDK. No diseñar gestión institucional completa, UI de asignaciones, API de autoconcesión, permisos administrativos nuevos, autenticación académica ni nuevo estado de tareas/revisiones.

## Decisions

### 1. Relación antes de privilegio por rol

ListProjectsUseCase conserva unión de creados y membresías activas. Para identidad teacher confiable añade solo proyectos de TeacherProjectScopePort y deduplica por ID. Teacher sin asignaciones conserva sus proyectos propios/membresías, nunca findAll() por teacher. GetProjectByIdUseCase conserva acceso por creatorId y membresía activa y añade consulta por asignación docente explícita; ajeno null→404. Revocar colaborador elimina solo ese permiso: una asignación/propiedad independiente continúa válida.

La asignación aporta consulta/detalle y revisión del proyecto en operaciones de revisión ya autorizadas por sus especificaciones; no crea endpoints de revisión inexistentes ni habilita listar/gestionar integrantes, escribir tareas/columnas o retirar/añadir miembros. Esas operaciones mantienen sus reglas previas de relación. Un docente owner conserva gestión que tenía como owner; docente collaborator conserva exactamente sus permisos de collaborator. Asignación sola nunca atraviesa una política de mutación. Administrador autenticado mantiene solo políticas existentes: no se crea ni amplía un permiso admin por este cambio.

### 2. Puerto y fuente de operador

Nuevo packages/shared/src/ports/teacher-project-scope.port.ts: interfaz read-only listAssignedProjectIds(teacherId) e isAssigned(teacherId,projectId), sin framework/SQL ni métodos de autoconcesión. Export en shared index.ts. InMemoryTeacherProjectScopeAdapter sirve fixtures deterministas; PostgresqlTeacherProjectScopeAdapter consulta public.teacher_project_assignments mediante SqlSession del producto. Ausencia de fuente/asignaciones devuelve conjunto vacío o denegación; error de consulta falla cerrado, sin bypass global/fallback permisivo. No introducir falsos grants de pruebas en producción.

Registro técnico intermedio propuesto: public.teacher_project_assignments con teacher_user_id text no vacío y project_id UUID FK a public.projects (sin tabla usuarios inventada), clave única del par. Operador autorizado mantiene altas/retiros con SQL explícitamente aprobado y evidencia saneada; no endpoint público ni autorización por cabecera. No asumir fuente universitaria ni sincronización de cursos. Importación institucional exige otro alcance y aprobación.

### 3. Migración, permisos y acoplamiento controlado

Nueva 0002_teacher_project_assignments.sql/manifest en catálogo producto, sin editar 0001. Tabla e inscripción de ledger en la misma transacción de versión; usa mismo lock/checksum/baseline/COMMIT incierto que el migrador producto. D-P de EPIC-002 prepara política ACL general; D-S añade entrada de versión 2 con runtime SELECT solo en asignaciones, migrador propietario. Nada de INSERT/UPDATE/DELETE runtime ni grants globales/defaults; observer SELECT solo si aprobado. Sin SQL al arranque ni si falta el perfil/destino aprobado.

Migración prepara tabla vacía, no asigna privilegios de negocio automáticamente. Fixture de operador que T→P1 requiere autorización SQL separada, no va en SQL v1 ni se interpreta como fuente institucional. Retiro de asignación exige mismo control operador; no cambia membresía de colaborador ni puede eliminar dueño. No se introducen borrados destructivos/restore automáticos.

### 4. Identidad y dependencias con EPIC-002

Solo userId/role de contexto autenticado confiable; rol o asignación enviados por cliente no dan permisos. Access/JWT/mapeo de actores y refactor de auth corresponden a [EPIC-002 remoto](../postgresql-projects-memberships/design.md); sus tokens representan máquinas sintéticas, no académicos reales. No usar dev-auth remoto. SEC-01 debe ser correcto independientemente de Maps/SQL o proveedor auth.

Orden propuesto: D-P EPIC-002 prepara pooling/auth/perfil/ACL sin semántica docente ni exposición; D-S implementa este cambio y migración; ambos se verifican antes de recursos/SQL remoto/E. Dependencia de código ACL no autoriza mezclar cambios en rama ni importar spikes. Antes de D-S acordar estrategia separada de rama/worktree y permisos Git, o excepción humana explícita para coexistencia; hoy no se crea ni cambia rama ni se mueve WIP.

## Pruebas y recuperación

Unitarias de casos de uso: teacher global bloqueado, sin asignaciones, asignado/ajeno, creator/collaborator con/sin asignación, deduplicación, retirada de membresía con asignación conservada y error de fuente fail-closed. No debilitar aserciones válidas: actualizar solo expectativas que codificaban bypass teacher, con escenarios negativos nuevos.

HTTP: listado filtrado, detalle ajeno 404 sin metadatos, identidad falsa/roles cliente no otorgan, asignación sola no altera add/remove members ni otras mutaciones; owner/collaborator docentes conservan reglas. Integración SQL nueva (solo con permiso cluster exclusivo): migración aditiva conserva projects/memberships, asignaciones persistentes entre sesiones, PK/FK, SELECT runtime y DML/DDL/ledger denegados. Fixtures sintéticos no son validación remota. No repetir suites históricas por esta planificación.

Fallo de fuente niega acceso, no activa findAll(). Error migración usa confirmación/rollback/unknown del producto, sin down destructivo. Si ocurre incertidumbre, detener y reconciliar bajo lock en sesión nueva autorizada. No eliminar asignaciones/datos confirmados para maquillar pruebas.

## Inventario D-S (propuesto, no autorizado por C)

Sin dependencias npm nuevas; conservar versiones del lock del producto. Sin recursos remotos/SQL/instalaciones/Git por inferencia. D-S se solicita separado de D-P.

Modificar: packages/shared/src/index.ts; apps/api/src/application/use-cases/list-projects.use-case.ts y list-projects.use-case.test.ts; apps/api/src/infrastructure/http/routes/projects.route.ts y projects.route.test.ts; apps/api/src/infrastructure/http/app.ts; apps/api/migrations/manifest.json y runtime-privileges.ts (este último creado por D-P); cuatro artefactos de este cambio. SQL v1 intocado. Si D-S precede D-P, rediseñar/revisar propiedad del archivo ACL antes de programar, sin introducir cambios implícitos.

Crear: packages/shared/src/ports/teacher-project-scope.port.ts; apps/api/src/infrastructure/adapters/repositories/in-memory-teacher-project-scope.adapter.ts y .test.ts; apps/api/src/infrastructure/postgresql/teacher-project-scope.adapter.ts y .test.ts; apps/api/migrations/sql/0002_teacher_project_assignments.sql; apps/api/migrations/teacher-project-scope.node-test.ts para casos SQL opt-in; evidence/teacher-project-scope/<run-id>/ solo tras D-S con permiso de salidas saneadas. Tests SQL opt-in no se ejecutan sin autorización específica de cluster exclusivo/dataset/limpieza.

Checks locales propuestos D-S: tests nuevos de aplicación/adaptadores/HTTP, lint/tipos/formato, contrato y build afectados, validación OpenSpec. Registrar comandos/resultados reales antes de marcar tasks. Ningún resultado concede E ni prueba fuente institucional. Salida D-S: revisión de diff y trazabilidad a política aprobada; STOP antes de cloud.
## Evidencia de implementación local

SQL D-S y límites (evidencia histórica local excluida de esta publicación; no acredita aceptación remota). Política implementada con puerto de lectura, fuente de operador en Maps/SQL y v2 aditiva. No se añadió dependencia npm por D-S ni autoconcesión; SQL v1 intacto. Coexistencia de cambios locales autorizada al conceder ambos alcances sin operaciones Git, manteniendo sus artefactos separados. La fuente institucional y validación remota siguen pendientes.
