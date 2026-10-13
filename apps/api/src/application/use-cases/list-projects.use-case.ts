import type {
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  ProjectListResponse,
  ProjectResponse,
} from '@is488/shared';
import { ProjectListResponseSchema, ProjectResponseSchema } from '@is488/shared';

export interface UserContext {
  userId: string;
  role?: string;
}

export interface ListProjectsQuery {
  user: UserContext;
}

export interface GetProjectByIdQuery {
  id: string;
  user: UserContext;
}

/**
 * Caso de uso para consultar proyectos aplicando reglas estrictas de autorización
 * y aislamiento en el backend.
 *
 * Reglas de aislamiento actualizadas (project-membership-access):
 * - Un estudiante puede consultar proyectos que haya creado O en los que tenga membresía activa.
 * - La unión de ambos conjuntos se deduplica por `id` para evitar duplicados si el usuario
 *   es creador Y colaborador (invariante garantizada por CreateProjectUseCase, pero se defiende).
 * - El backend no delega la autorización ni confía en filtros del frontend.
 */
export class ListProjectsUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  /**
   * Ejecuta el listado de proyectos autorizados para el usuario en contexto.
   */
  async execute(query: ListProjectsQuery): Promise<ProjectListResponse> {
    const { userId, role } = query.user;

    if (!userId || userId.trim().length === 0) {
      throw new Error('El identificador de usuario es obligatorio para consultar proyectos');
    }

    const cleanUserId = userId.trim();

    // Roles administrativos o docentes: acceso completo
    if (role === 'admin' || role === 'teacher') {
      const allProjects = await this.projectRepository.findAll();
      return ProjectListResponseSchema.parse(allProjects);
    }

    // Regla para estudiantes: unión de proyectos creados + proyectos con membresía activa
    const [createdProjects, activeMemberships] = await Promise.all([
      this.projectRepository.findByUser(cleanUserId),
      this.membershipRepository.findByUser(cleanUserId),
    ]);

    // Obtener proyectos donde el usuario es colaborador (no creador) a través de membresías
    const memberProjectIds = activeMemberships.map((m) => m.projectId);
    const memberProjects = await Promise.all(
      memberProjectIds.map((id) => this.projectRepository.findById(id)),
    );
    const validMemberProjects = memberProjects.filter(
      (p): p is NonNullable<typeof p> => p !== null,
    );

    // Unión deduplicada por id
    const projectsById = new Map(createdProjects.map((p) => [p.id, p]));
    for (const p of validMemberProjects) {
      if (!projectsById.has(p.id)) {
        projectsById.set(p.id, p);
      }
    }

    return ProjectListResponseSchema.parse(Array.from(projectsById.values()));
  }
}

/**
 * Caso de uso para consultar un proyecto específico por ID con verificación de autorización.
 *
 * Reglas de acceso actualizadas (project-membership-access):
 * - Creador del proyecto (creatorId): acceso garantizado.
 *   Nota: esta comprobación es una optimización válida en tanto la invariante de propietario
 *   esté garantizada (CreateProjectUseCase siempre crea la membresía owner). Se mantiene
 *   porque evita una consulta al repositorio de membresías para el caso más frecuente.
 *   Si la invariante se rompe (bug), el acceso por creatorId sigue siendo correcto.
 *   NUNCA eliminar esta comprobación creyendo que `isMember` es suficiente.
 * - Miembro con membresía activa (collaborator): acceso concedido.
 * - Roles elevados (admin, teacher): acceso concedido.
 * - Cualquier otro caso: null → adaptador HTTP responde 404 (sin revelar existencia).
 */
export class GetProjectByIdUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  async execute(query: GetProjectByIdQuery): Promise<ProjectResponse | null> {
    const { id, user } = query;
    if (!user.userId || user.userId.trim().length === 0) {
      throw new Error('El identificador de usuario es obligatorio');
    }

    const project = await this.projectRepository.findById(id);
    if (!project) {
      return null;
    }

    const cleanUserId = user.userId.trim();

    // Comprobación 1: creador directo (optimización — evita consulta a membresías para el caso más común)
    const isOwner = project.creatorId === cleanUserId;
    // Comprobación 2: roles elevados (admin, teacher)
    const isElevated = user.role === 'admin' || user.role === 'teacher';

    if (isOwner || isElevated) {
      return ProjectResponseSchema.parse(project);
    }

    // Comprobación 3: membresía activa como colaborador
    const membership = await this.membershipRepository.findByProjectAndUser(id, cleanUserId);
    const isMember = membership !== null;

    if (!isMember) {
      // Retorna null para disparar 404 Not Found sin divulgar la existencia del proyecto
      return null;
    }

    return ProjectResponseSchema.parse(project);
  }
}
