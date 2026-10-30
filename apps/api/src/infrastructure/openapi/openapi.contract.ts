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
    '/api/projects/{projectId}/tasks/{taskId}/activity': {
      get: {
        operationId: 'getTaskActivity',
        summary: 'Historial real de una tarea',
        description:
          'Autenticación existente y acceso contextual. 404 uniforme para recursos inexistentes o ajenos. Orden createdAt descendente, id ascendente. Lectura sin efectos.',
        security: [{ DevAuthUserId: [] }],
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Eventos; lista vacía si no existen eventos.',
            headers: { 'Cache-Control': { schema: { type: 'string', example: 'no-store' } } },
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TaskActivityResponse' },
                },
              },
            },
          },
          '400': { description: 'Identificadores inválidos' },
          '401': { description: 'No autenticado' },
          '404': { description: 'Recurso no encontrado o sin acceso' },
          '405': {
            description: 'Método no permitido',
            headers: { Allow: { schema: { type: 'string', example: 'GET' } } },
          },
          '500': { description: 'Error interno' },
        },
      },
    },
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
                      description: 'Marca temporal UTC en formato ISO-8601.',
                    },
                    version: {
                      type: 'string',
                      minLength: 1,
                      description: 'Versión semántica del sistema backend.',
                    },
                  },
                  required: ['status', 'timestamp', 'version'],
                },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido para este endpoint.',
            headers: {
              Allow: {
                description: 'Métodos HTTP permitidos para este recurso.',
                schema: {
                  type: 'string',
                  example: 'GET',
                },
              },
              'Cache-Control': {
                description: 'Directivas de caché obligatorias.',
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
                    error: {
                      type: 'string',
                      const: 'Method Not Allowed',
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
        summary: 'Listar proyectos autorizados',
        description:
          'Retorna la lista de proyectos en los cuales el usuario autenticado participa como creador o miembro activo.',
        operationId: 'listProjects',
        responses: {
          '200': {
            description: 'Lista de proyectos retornada exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-cache, no-store, must-revalidate' },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Project' },
                },
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
            description: 'Método HTTP no permitido.',
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
      post: {
        summary: 'Crear un nuevo proyecto',
        description:
          'Crea un nuevo proyecto académico. El usuario creador se asigna automáticamente como miembro propietario (owner).',
        operationId: 'createProject',
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
            description: 'Datos de solicitud inválidos o error de validación.',
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
            description: 'Método HTTP no permitido.',
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
        summary: 'Consultar detalle de un proyecto',
        description:
          'Retorna el detalle completo de un proyecto si el solicitante es creador o miembro activo. Si no tiene acceso, responde 404 para no revelar la existencia del proyecto.',
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
            description: 'Detalle del proyecto retornado exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-cache, no-store, must-revalidate' },
              },
            },
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
            description: 'Proyecto no encontrado o acceso denegado.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-cache, no-store, must-revalidate' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
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
        summary: 'Agregar un colaborador a un proyecto',
        description:
          'Agrega un colaborador al proyecto especificado. Solo el creador del proyecto puede agregar miembros.',
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
            description:
              'Datos de solicitud inválidos (p. ej., userId no es UUID, role no es collaborator).',
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
            name: 'membershipId',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
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
          '400': { description: 'membershipId UUID requerido o inv?lido.' },
          '200': {
            description:
              'Colaborador retirado exitosamente. Retorna la membresía actualizada con status "removed".',
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
    '/api/projects/{projectId}/board': {
      get: {
        summary: 'Consultar tablero de un proyecto',
        description:
          'Obtiene el tablero Kanban del proyecto con sus columnas ordenadas por orderIndex. Si el tablero aún no existe, se inicializa de forma perezosa e idempotente con las columnas predeterminadas (TODO, IN_PROGRESS, DONE). Solo accesible para miembros activos o creador del proyecto.',
        operationId: 'getProjectBoard',
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
            description: 'Tablero del proyecto retornado exitosamente.',
            headers: {
              'Cache-Control': {
                description: 'Directivas de cach? para evitar almacenamiento en cach?.',
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BoardResponse' },
              },
            },
          },
          '400': {
            description: 'Identificador de proyecto inválido (no es UUID).',
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
          '404': {
            description: 'Proyecto no encontrado o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'GET' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/board/columns': {
      post: {
        summary: 'Crear una nueva columna en el tablero',
        description:
          'Crea una nueva columna en el tablero Kanban del proyecto. Valida límite máximo de 10 columnas y categoría semántica válida.',
        operationId: 'createBoardColumn',
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
              schema: { $ref: '#/components/schemas/CreateBoardColumnRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Columna creada exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BoardColumnResponse' },
              },
            },
          },
          '400': {
            description: 'Datos de columna inválidos o límite máximo de 10 columnas alcanzado.',
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
          '404': {
            description: 'Proyecto no encontrado o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'POST' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/board/columns/{columnId}': {
      patch: {
        summary: 'Actualizar o reordenar una columna del tablero',
        description:
          'Actualiza metadatos (nombre, categoría, color) o reordena contiguamente (orderIndex) una columna existente en el tablero. Exige al menos un campo a modificar.',
        operationId: 'updateBoardColumn',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'columnId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID de la columna.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateBoardColumnRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Columna actualizada exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BoardColumnResponse' },
              },
            },
          },
          '400': {
            description: 'Datos inválidos, UUIDs inválidos o cuerpo de actualización vacío.',
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
          '404': {
            description: 'Proyecto o columna no encontrados, o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'PATCH, DELETE' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        summary: 'Eliminar una columna del tablero',
        description:
          'Elimina una columna de forma atómica. Si la columna contiene tareas activas, exige targetColumnId en query params para migración atómica (409 Conflict si falta). Rechaza con 400 Bad Request si es la última columna restante o si el destino es inválido.',
        operationId: 'deleteBoardColumn',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'columnId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID de la columna a eliminar.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'targetColumnId',
            in: 'query',
            required: false,
            description:
              'UUID de la columna destino para migración atómica de tareas si la columna origen no está vacía.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Columna eliminada exitosamente y tareas migradas de forma atómica.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeleteBoardColumnResponse' },
              },
            },
          },
          '400': {
            description:
              'Identificador inválido, columna destino inválida o intento de eliminar la última columna del tablero.',
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
          '404': {
            description: 'Proyecto o columna no encontrados, o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description:
              'La columna contiene tareas activas y no se especificó targetColumnId para migración.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'PATCH, DELETE' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/tasks': {
      get: {
        summary: 'Listar tareas autorizadas del proyecto',
        description:
          'Retorna la lista paginada y filtrada de tareas del proyecto Kanban. Requiere membresía activa o docente asignado.',
        operationId: 'listTasks',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Número de página a consultar (base 1). Valor por defecto: 1.',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description:
              'Cantidad máxima de tareas por página. Valor por defecto: 20 (máximo 100).',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'columnId',
            in: 'query',
            required: false,
            description: 'Filtra tareas que pertenezcan a la columna especificada.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'priority',
            in: 'query',
            required: false,
            description: 'Filtra tareas por nivel de prioridad.',
            schema: { $ref: '#/components/schemas/TaskPriority' },
          },
          {
            name: 'assigneeId',
            in: 'query',
            required: false,
            description: 'Filtra tareas que contengan al responsable especificado.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'label',
            in: 'query',
            required: false,
            description: 'Filtra tareas que contengan la etiqueta especificada.',
            schema: { type: 'string', minLength: 1, maxLength: 30 },
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            description:
              'Búsqueda por subcadena sin distinción de mayúsculas en título o descripción.',
            schema: { type: 'string', maxLength: 100 },
          },
        ],
        responses: {
          '200': {
            description: 'Lista paginada de tareas devuelta exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedTasksResponse' },
              },
            },
          },
          '400': {
            description: 'Parámetros de consulta o identificador de proyecto inválidos.',
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
          '404': {
            description: 'Proyecto no encontrado o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'GET, POST' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      post: {
        summary: 'Crear una nueva tarea en el tablero',
        description:
          'Crea una nueva tarea en una columna del tablero del proyecto y registra el evento inmutable de auditoría CREATED. Requiere membresía activa en el proyecto.',
        operationId: 'createTask',
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
              schema: { $ref: '#/components/schemas/CreateTaskRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Tarea creada exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TaskResponse' },
              },
            },
          },
          '400': {
            description:
              'Datos inválidos en el cuerpo de la petición o responsables sin membresía activa.',
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
          '404': {
            description: 'Proyecto o columna no encontrados, o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'GET, POST' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/tasks/{taskId}': {
      patch: {
        summary: 'Actualizar campos editables de una tarea',
        description:
          'Actualiza campos editables (título, descripción, prioridad, fecha límite, etiquetas, responsables) y registra evento de auditoría UPDATED. Rechaza estrictamente la inclusión de campos protegidos o de movimiento.',
        operationId: 'updateTask',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'taskId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID de la tarea a actualizar.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateTaskRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tarea actualizada exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TaskResponse' },
              },
            },
          },
          '400': {
            description:
              'Campos protegidos presentes, cuerpo vacío, datos inválidos o responsables sin membresía activa.',
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
          '404': {
            description: 'Proyecto o tarea no encontrados, o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'PATCH' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/projects/{projectId}/tasks/{taskId}/move': {
      post: {
        summary: 'Mover una tarea de columna o posición',
        description:
          'Mueve una tarea a otra columna o altera su posición contigua dentro de la misma columna, registrando evento inmutable de auditoría MOVED. Clampea índices fuera de rango al final de la columna destino.',
        operationId: 'moveTask',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID del proyecto.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'taskId',
            in: 'path',
            required: true,
            description: 'Identificador único UUID de la tarea a mover.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MoveTaskRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tarea movida exitosamente.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string', example: 'no-store' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TaskResponse' },
              },
            },
          },
          '400': {
            description: 'Columna destino inválida o parámetros de movimiento erróneos.',
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
          '404': {
            description: 'Proyecto o tarea no encontrados, o solicitante sin membresía activa.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '405': {
            description: 'Método HTTP no permitido.',
            headers: {
              Allow: { schema: { type: 'string', example: 'POST' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
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
    securitySchemes: {
      DevAuthUserId: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Dev-User-Id',
        description: 'Solo development/test; no es autenticación de producción.',
      },
    },
    schemas: {
      TaskActivityResponse: {
        type: 'object',
        required: ['id', 'taskId', 'projectId', 'actorId', 'action', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          taskId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          actorId: { type: 'string', minLength: 1 },
          action: {
            type: 'string',
            enum: ['CREATED', 'UPDATED', 'MOVED', 'COLUMN_DELETED_REALLOCATION', 'DELETED'],
          },
          fromColumnId: { type: 'string', format: 'uuid' },
          toColumnId: { type: 'string', format: 'uuid' },
          details: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
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
          removedAt: { type: ['string', 'null'], format: 'date-time' },
          joinedAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: [
          'id',
          'projectId',
          'userId',
          'role',
          'status',
          'joinedAt',
          'updatedAt',
          'removedAt',
        ],
      },
      MemberListResponse: {
        type: 'array',
        items: { $ref: '#/components/schemas/MembershipResponse' },
      },
      ColumnCategory: {
        type: 'string',
        enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
        description: 'Categoría semántica estandarizada de columna Kanban.',
      },
      CreateBoardColumnRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          color: {
            type: 'string',
            pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
            description: 'Código de color hexadecimal válido (ej. #3b82f6).',
          },
          category: { $ref: '#/components/schemas/ColumnCategory' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      UpdateBoardColumnRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          color: {
            type: 'string',
            pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
            description: 'Código de color hexadecimal válido (ej. #3b82f6).',
          },
          category: { $ref: '#/components/schemas/ColumnCategory' },
          orderIndex: {
            type: 'integer',
            minimum: 0,
            description: 'Índice de orden contiguo en el tablero.',
          },
        },
        additionalProperties: false,
        minProperties: 1,
      },
      BoardColumnResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          boardId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 50 },
          orderIndex: { type: 'integer', minimum: 0 },
          category: { $ref: '#/components/schemas/ColumnCategory' },
          color: {
            type: 'string',
            pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'boardId', 'name', 'orderIndex', 'category', 'createdAt', 'updatedAt'],
      },
      BoardResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          columns: {
            type: 'array',
            items: { $ref: '#/components/schemas/BoardColumnResponse' },
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'projectId', 'columns', 'createdAt', 'updatedAt'],
      },
      DeleteBoardColumnResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: true },
          deletedColumnId: { type: 'string', format: 'uuid' },
          migratedTasksCount: { type: 'integer', minimum: 0 },
        },
        required: ['success', 'deletedColumnId', 'migratedTasksCount'],
      },
      TaskPriority: {
        type: 'string',
        enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
        description: 'Nivel de prioridad de la tarea.',
      },
      CreateTaskRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 140 },
          description: { type: 'string', maxLength: 2000 },
          columnId: { type: 'string', format: 'uuid' },
          priority: { $ref: '#/components/schemas/TaskPriority' },
          dueDate: { type: 'string', format: 'date-time' },
          labels: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 30 },
            maxItems: 5,
          },
          assigneeIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
        },
        required: ['title', 'columnId'],
        additionalProperties: false,
      },
      UpdateTaskRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 140 },
          description: { type: 'string', maxLength: 2000 },
          priority: { $ref: '#/components/schemas/TaskPriority' },
          dueDate: {
            type: ['string', 'null'],
            format: 'date-time',
          },
          labels: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 30 },
            maxItems: 5,
          },
          assigneeIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
        },
        additionalProperties: false,
        minProperties: 1,
      },
      MoveTaskRequest: {
        type: 'object',
        properties: {
          destinationColumnId: { type: 'string', format: 'uuid' },
          destinationIndex: { type: 'integer', minimum: 0 },
        },
        required: ['destinationColumnId', 'destinationIndex'],
        additionalProperties: false,
      },
      TaskResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          columnId: { type: 'string', format: 'uuid' },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          priority: { $ref: '#/components/schemas/TaskPriority' },
          orderIndex: { type: 'integer', minimum: 0 },
          dueDate: { type: 'string', format: 'date-time' },
          labels: { type: 'array', items: { type: 'string' } },
          creatorId: { type: 'string', minLength: 1 },
          assigneeIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: [
          'id',
          'projectId',
          'columnId',
          'title',
          'priority',
          'orderIndex',
          'labels',
          'creatorId',
          'assigneeIds',
          'createdAt',
          'updatedAt',
        ],
      },
      PaginatedTasksResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/TaskResponse' },
          },
          totalItems: { type: 'integer', minimum: 0 },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1 },
          totalPages: { type: 'integer', minimum: 0 },
        },
        required: ['items', 'totalItems', 'page', 'limit', 'totalPages'],
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
