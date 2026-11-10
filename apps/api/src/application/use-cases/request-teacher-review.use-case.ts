import type {
  MembershipRepositoryPort,
  ReviewRepositoryPort,
  TeacherReviewRequest,
} from '@is488/shared';

export interface RequestTeacherReviewCommand {
  /** UUID del proyecto sobre el que se solicita la revisión. */
  projectId: string;
  /** ID del usuario que formula la solicitud (obtenido del contexto autenticado). */
  requesterId: string;
  role: string;
  /** Título sintético de la solicitud (3–120 caracteres). */
  title: string;
  /** Descripción del avance alcanzado (10–2000 caracteres). */
  description: string;
  /** Enlace opcional a repositorio o evidencia externa (máx. 500 caracteres, ADR-006). */
  evidenceUrl?: string;
}

/**
 * Caso de uso: Solicitar revisión docente a nivel de proyecto.
 *
 * Reglas de autorización:
 * - El solicitante debe tener membresía activa (status === 'active') en el proyecto.
 *   Si el proyecto no existe o la membresía está retirada → 404 Not Found.
 * - La identidad y el rol del solicitante provienen del contexto autenticado (comando).
 * - El estado inicial de la revisión es siempre PENDING (determinado por el servidor).
 * - id, createdAt y updatedAt son generados por el servidor; el cliente no los provee.
 */
export class RequestTeacherReviewUseCase {
  constructor(
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly reviewRepository: ReviewRepositoryPort,
  ) {}

  async execute(command: RequestTeacherReviewCommand): Promise<TeacherReviewRequest> {
    if (command.role !== 'student') {
      throw Object.assign(new Error('Student role required'), { statusCode: 403 });
    }
    // 1. Verificar membresía activa del solicitante en el proyecto
    //    Si el proyecto no existe, findByProjectAndUser devuelve null → mismo 404.
    const membership = await this.membershipRepository.findByProjectAndUser(
      command.projectId,
      command.requesterId,
    );
    if (!membership) {
      throw Object.assign(
        new Error(
          `El usuario '${command.requesterId}' no tiene membresía activa en el proyecto '${command.projectId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 2. Crear la solicitud con estado inicial PENDING
    return this.reviewRepository.createRequest({
      projectId: command.projectId,
      requesterId: command.requesterId,
      title: command.title,
      description: command.description,
      evidenceUrl: command.evidenceUrl,
    });
  }
}
