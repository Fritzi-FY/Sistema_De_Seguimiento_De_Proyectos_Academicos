/**
 * Especificación OpenAPI 3.1 declarada para el contrato de la API del sistema IS488.
 * Garantiza total coincidencia con los esquemas Zod de @is488/shared.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Sistema de Seguimiento de Proyectos Académicos IS488 - API',
    version: '0.1.0',
    description:
      'API técnica y de negocio del Sistema de Seguimiento de Proyectos Académicos (UNSCH IS488).',
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Diagnóstico de salud operativa',
        description:
          'Retorna el estado de disponibilidad operativa, versión activa y marca de tiempo del servidor.',
        operationId: 'getSystemHealth',
        responses: {
          '200': {
            description: 'Servicio operativo y disponible.',
            headers: {
              'Cache-Control': {
                description: 'Directivas de caché obligatorias para evitar almacenamiento erróneo.',
                schema: {
                  type: 'string',
                  example: 'no-cache, no-store, must-revalidate',
                },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      const: 'ok',
                      description: 'Estado de operatividad del sistema.',
                    },
                    timestamp: {
                      type: 'string',
                      format: 'date-time',
                      description: 'Marca de tiempo actual del servidor en formato ISO-8601 UTC.',
                    },
                    version: {
                      type: 'string',
                      minLength: 1,
                      description: 'Versión técnica del sistema en ejecución.',
                    },
                  },
                  required: ['status', 'timestamp', 'version'],
                  additionalProperties: false,
                },
              },
            },
          },
          '405': {
            description: 'Método HTTP no admitido sobre el endpoint de diagnóstico.',
            headers: {
              Allow: {
                description: 'Métodos HTTP permitidos para este recurso.',
                schema: {
                  type: 'string',
                  example: 'GET',
                },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string',
                      example: 'Method Not Allowed',
                    },
                  },
                  required: ['error'],
                },
              },
            },
          },
        },
      },
    },
    '/api/projects': {
      get: {
        summary: 'Listado de proyectos autorizados',
        description:
          'Retorna la lista de proyectos académicos a los que el usuario en sesión tiene acceso (como creador o colaborador activo).',
        operationId: 'listProjects',
        parameters: [
          {
            name: 'X-Dev-User-Id',
            in: 'header',
            required: false,
            description: 'Identificador del usuario simulado para desarrollo local.',
            schema: { type: 'string', example: 'dev-student-01' },
          },
          {
            name: 'X-Dev-User-Role',
            in: 'header',
            required: false,
            description: 'Rol del usuario simulado (student | teacher | admin).',
            schema: { type: 'string', enum: ['student', 'teacher', 'admin'], default: 'student' },
          },
        ],
        responses: {
          '200': {
            description: 'Lista de proyectos consultada exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-cache, no-store, must-revalidate' },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Project',
                  },
                },
              },
            },
          },
          '401': {
            description:
              'No autorizado o contexto de identidad simulada ausente/rechazado en producción.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no admitido sobre /api/projects.',
            headers: {
              Allow: {
                schema: { type: 'string', example: 'GET, POST' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      post: {
        summary: 'Creación de proyecto académico',
        description:
          'Registra un nuevo proyecto validando título, código de curso, cronograma y creador. Crea además la membresía owner del creador de forma atómica.',
        operationId: 'createProject',
        parameters: [
          {
            name: 'X-Dev-User-Id',
            in: 'header',
            required: false,
            description: 'Identificador del usuario creador en desarrollo.',
            schema: { type: 'string', example: 'dev-student-01' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateProjectRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Proyecto creado exitosamente.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Project' },
              },
            },
          },
          '400': {
            description: 'Datos de proyecto inválidos o cronología de fechas inconsistente.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'No autorizado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método no admitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'GET, POST' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}': {
      get: {
        summary: 'Detalle de proyecto académico',
        description:
          'Consulta un proyecto por ID. Si el usuario no tiene permisos o no existe, retorna 404.',
        operationId: 'getProjectById',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Proyecto encontrado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Project' },
              },
            },
          },
          '401': {
            description: 'No autorizado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Proyecto no encontrado o no accesible para el usuario.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'GET' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/members': {
      post: {
        summary: 'Agregar colaborador a un proyecto',
        description:
          'Agrega un usuario como colaborador activo del proyecto. Solo el creador del proyecto puede realizar esta operación.',
        operationId: 'addProjectMember',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AddMemberRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Colaborador agregado exitosamente.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MembershipResponse' },
              },
            },
          },
          '400': {
            description: 'Datos de solicitud inválidos (p. ej., userId no es UUID, role no es collaborator).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'No autorizado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'El solicitante no es el creador del proyecto.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Proyecto no encontrado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description: 'El usuario ya tiene una membresía activa en el proyecto.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      get: {
        summary: 'Listar miembros activos de un proyecto',
        description:
          'Retorna la lista de membresías activas del proyecto. Solo accesible para miembros activos (owner o collaborator).',
        operationId: 'listProjectMembers',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Lista de miembros activos retornada exitosamente.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemberListResponse' },
              },
            },
          },
          '401': {
            description: 'No autorizado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Proyecto no encontrado o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/members/{userId}': {
      delete: {
        summary: 'Retirar un colaborador de un proyecto',
        description:
          'Cambia el estado de la membresía del colaborador a "removed". Solo el creador puede retirar miembros. El propietario (owner) no puede ser retirado.',
        operationId: 'removeProjectMember',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'userId',
            in: 'path',
            required: true,
            description: 'Identificador del usuario a retirar.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Colaborador retirado exitosamente. Retorna la membresía actualizada con status "removed".',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MembershipResponse' },
              },
            },
          },
          '401': {
            description: 'No autorizado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'El solicitante no es el creador del proyecto.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Proyecto no encontrado o el usuario no tiene membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '422': {
            description: 'No se puede retirar al propietario del proyecto.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      CreateProjectRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 120 },
          description: { type: 'string', maxLength: 500 },
          courseCode: { type: 'string', minLength: 2, maxLength: 20 },
          startDate: { type: 'string', format: 'date-time' },
          targetDate: { type: 'string', format: 'date-time' },
        },
        required: ['title', 'courseCode', 'startDate', 'targetDate'],
        additionalProperties: false,
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          courseCode: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['active', 'archived'] },
          startDate: { type: 'string', format: 'date-time' },
          targetDate: { type: 'string', format: 'date-time' },
          creatorId: { type: 'string', minLength: 1 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: [
          'id',
          'title',
          'courseCode',
          'status',
          'startDate',
          'targetDate',
          'creatorId',
          'createdAt',
          'updatedAt',
        ],
      },
      AddMemberRequest: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid', description: 'UUID del usuario a agregar.' },
          role: {
            type: 'string',
            enum: ['collaborator'],
            description: 'Solo se acepta "collaborator". El rol "owner" es asignado internamente.',
          },
        },
        required: ['userId', 'role'],
        additionalProperties: false,
      },
      MembershipResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          userId: { type: 'string', minLength: 1 },
          role: { type: 'string', enum: ['owner', 'collaborator'] },
          status: { type: 'string', enum: ['active', 'removed'] },
          joinedAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'projectId', 'userId', 'role', 'status', 'joinedAt', 'updatedAt'],
      },
      MemberListResponse: {
        type: 'array',
        items: { $ref: '#/components/schemas/MembershipResponse' },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['error'],
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
