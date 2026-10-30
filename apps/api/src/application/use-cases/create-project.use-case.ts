import type {
  Project,
  ProjectMembership,
  ProjectCreationPort,
  SystemClockPort,
  CreateProjectRequest,
  ProjectResponse,
} from '@is488/shared';
import { CreateProjectRequestSchema, ProjectResponseSchema } from '@is488/shared';

export interface CreateProjectCommand extends CreateProjectRequest {
  creatorId: string;
}

/**
 * Caso de uso para la creación de un nuevo proyecto académico.
 *
 * Cumple con la Arquitectura Hexagonal:
 * - Depende de interfaces de puertos (ProjectCreationPort, SystemClockPort).
 * - No depende de frameworks HTTP (Hono), base de datos concreta ni librerías de UI.
 * - No depende directamente de MembershipRepositoryPort; la coordinación de la
 *   persistencia de la membresía es responsabilidad exclusiva del adaptador de
 *   ProjectCreationPort.
 *
 * Un COMMIT sin confirmación tiene resultado incierto y no debe reintentarse automáticamente.
 */
export class CreateProjectUseCase {
  constructor(
    private readonly projectCreationPort: ProjectCreationPort,
    private readonly clock: SystemClockPort,
    private readonly idGenerator: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Ejecuta la creación del proyecto validando la entrada y persistiendo el proyecto
   * junto con su membresía owner de forma coordinada (todo-o-nada).
   */
  async execute(command: CreateProjectCommand): Promise<ProjectResponse> {
    if (!command.creatorId || command.creatorId.trim().length === 0) {
      throw new Error('El identificador del creador es obligatorio');
    }

    // Validación estricta con el esquema compartido Zod
    const validatedData = CreateProjectRequestSchema.parse({
      title: command.title,
      description: command.description,
      courseCode: command.courseCode,
      startDate: command.startDate,
      targetDate: command.targetDate,
    });

    const now = this.clock.isoString();
    const projectId = this.idGenerator();
    const membershipId = this.idGenerator();
    const cleanCreatorId = command.creatorId.trim();

    const newProject: Project = {
      id: projectId,
      title: validatedData.title,
      description: validatedData.description,
      courseCode: validatedData.courseCode,
      status: 'active',
      startDate: validatedData.startDate,
      targetDate: validatedData.targetDate,
      creatorId: cleanCreatorId,
      createdAt: now,
      updatedAt: now,
    };

    const ownerMembership: ProjectMembership = {
      id: membershipId,
      projectId,
      userId: cleanCreatorId,
      role: 'owner',
      status: 'active',
      removedAt: null,
      joinedAt: now,
      updatedAt: now,
    };

    await this.projectCreationPort.createProjectWithOwner(newProject, ownerMembership);

    return ProjectResponseSchema.parse(newProject);
  }
}
