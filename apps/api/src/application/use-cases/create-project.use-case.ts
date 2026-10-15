import type {
  Project,
  ProjectRepositoryPort,
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
 * - Depende de interfaces de puertos (ProjectRepositoryPort, SystemClockPort).
 * - No depende de frameworks HTTP (Hono), base de datos concreta ni librerías de UI.
 */
export class CreateProjectUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly clock: SystemClockPort,
    private readonly idGenerator: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Ejecuta la creación del proyecto validando la entrada y persistiendo la entidad.
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

    const newProject: Project = {
      id: projectId,
      title: validatedData.title,
      description: validatedData.description,
      courseCode: validatedData.courseCode,
      status: 'active',
      startDate: validatedData.startDate,
      targetDate: validatedData.targetDate,
      creatorId: command.creatorId.trim(),
      createdAt: now,
      updatedAt: now,
    };

    await this.projectRepository.save(newProject);

    return ProjectResponseSchema.parse(newProject);
  }
}
