import type { ProjectRepositoryPort, ProjectListResponse, ProjectResponse } from '@is488/shared';
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
 * Reglas de aislamiento:
 * - Un estudiante solo puede consultar proyectos que haya creado o de los que sea miembro explícito.
 * - El backend no delega la autorización ni confía en filtros del frontend.
 */
export class ListProjectsUseCase {
  constructor(private readonly projectRepository: ProjectRepositoryPort) {}

  /**
   * Ejecuta el listado de proyectos autorizados para el usuario en contexto.
   */
  async execute(query: ListProjectsQuery): Promise<ProjectListResponse> {
    const { userId, role } = query.user;

    if (!userId || userId.trim().length === 0) {
      throw new Error('El identificador de usuario es obligatorio para consultar proyectos');
    }

    const cleanUserId = userId.trim();

    // Aislamiento por rol:
    // Si el rol es 'student' o no está especificado, se restringe estrictamente a los proyectos del usuario.
    // Para roles administrativos o docentes globales en este baseline, se permite findAll si no hay restricción de curso.
    if (role === 'admin' || role === 'teacher') {
      const allProjects = await this.projectRepository.findAll();
      return ProjectListResponseSchema.parse(allProjects);
    }

    // Regla predeterminada y para estudiantes: aislamiento estricto por usuario
    const userProjects = await this.projectRepository.findByUser(cleanUserId);
    return ProjectListResponseSchema.parse(userProjects);
  }
}

/**
 * Caso de uso para consultar un proyecto específico por ID con verificación de autorización.
 * Si el usuario no tiene permiso sobre el proyecto, retorna null para que el adaptador HTTP
 * responda 404 Not Found y no revele la existencia del proyecto (defensa en profundidad).
 */
export class GetProjectByIdUseCase {
  constructor(private readonly projectRepository: ProjectRepositoryPort) {}

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

    // Comprobar autorización: creador o roles elevados
    const isOwner = project.creatorId === cleanUserId;
    const isElevated = user.role === 'admin' || user.role === 'teacher';

    if (!isOwner && !isElevated) {
      // Retorna null para disparar 404 Not Found sin divulgar la existencia del proyecto
      return null;
    }

    return ProjectResponseSchema.parse(project);
  }
}
