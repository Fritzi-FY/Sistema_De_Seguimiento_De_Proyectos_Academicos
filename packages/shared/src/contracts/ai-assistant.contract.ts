import { z } from 'zod';

export const AI_ASSISTANT_DISCLAIMER =
  'Orientación formativa generada por IA. No constituye calificación ni evaluación académica oficial.';

export const AIAnalysisFocusSchema = z.enum(['full', 'risks', 'progress'], {
  message: "El enfoque debe ser 'full', 'risks' o 'progress'",
});
export type AIAnalysisFocus = z.infer<typeof AIAnalysisFocusSchema>;

/**
 * Esquema de solicitud para análisis de proyecto.
 * Admite enfoque opcional (por defecto 'full').
 */
export const AIAnalysisRequestSchema = z
  .object({
    focus: AIAnalysisFocusSchema.optional().default('full'),
  })
  .strict();
export type AIAnalysisRequest = z.infer<typeof AIAnalysisRequestSchema>;

/**
 * Esquema interno para validar la respuesta JSON cruda generada por el modelo de IA.
 * Rechaza respuestas incompletas o sin los campos estructurales esperados.
 */
export const AIModelPayloadSchema = z
  .object({
    progressSummary: z
      .string()
      .trim()
      .min(1, { message: 'El resumen de avance no puede estar vacío' }),
    riskSignals: z.array(z.string().trim().min(1)),
    nextSteps: z.array(z.string().trim().min(1)),
  })
  .strict();
export type AIModelPayload = z.infer<typeof AIModelPayloadSchema>;

/**
 * Secciones estructuradas del análisis entregado al cliente.
 */
export const AIAnalysisSectionsSchema = z.object({
  progressSummary: z.string().trim().min(1),
  riskSignals: z.array(z.string().trim()),
  nextSteps: z.array(z.string().trim()),
});
export type AIAnalysisSections = z.infer<typeof AIAnalysisSectionsSchema>;

/**
 * Metadatos de auditoría y descargo de responsabilidad del análisis.
 */
export const AIAnalysisMetaSchema = z.object({
  model: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
  disclaimer: z.literal(AI_ASSISTANT_DISCLAIMER),
});
export type AIAnalysisMeta = z.infer<typeof AIAnalysisMetaSchema>;

/**
 * Contrato de respuesta final enviado por la API para un análisis de proyecto.
 */
export const AIAnalysisResponseSchema = z
  .object({
    projectId: z.string().uuid(),
    analysis: AIAnalysisSectionsSchema,
    meta: AIAnalysisMetaSchema,
  })
  .strict();
export type AIAnalysisResponse = z.infer<typeof AIAnalysisResponseSchema>;

/**
 * Contrato de respuesta para consultar si el usuario autenticado
 * tiene permiso efectivo para utilizar el asistente de IA en un proyecto.
 */
export const ProjectAICapabilitiesResponseSchema = z
  .object({
    projectId: z.string().uuid(),
    canUseAIAssistant: z.boolean(),
  })
  .strict();
export type ProjectAICapabilitiesResponse = z.infer<typeof ProjectAICapabilitiesResponseSchema>;
