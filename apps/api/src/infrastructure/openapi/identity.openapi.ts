import { z } from 'zod';
import {
  LoginRequestSchema,
  CurrentUserSchema,
  VerificationRequestSchema,
  VerificationConfirmSchema,
} from '@is488/shared';
const success = {
  description: 'Confirmed success',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['success'],
        properties: { success: { const: true } },
        additionalProperties: false,
      },
    },
  },
};
const body = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: z.toJSONSchema(schema) } },
});
const errors = {
  '400': { description: 'Invalid request or proof' },
  '403': { description: 'Access or origin denied' },
  '429': { description: 'Attempt limit reached' },
  '503': { description: 'Required configuration unavailable' },
};
export const identityPaths = {
  '/api/auth/me': {
    get: {
      operationId: 'getCurrentUser',
      responses: {
        '200': {
          description: 'Current UUID and server role, private/no-store',
          content: { 'application/json': { schema: z.toJSONSchema(CurrentUserSchema) } },
        },
        '401': { description: 'Session absent, expired, revoked or account disabled' },
        '503': errors['503'],
      },
    },
  },
  '/api/auth/sign-in/email': {
    post: {
      operationId: 'signIn',
      security: [],
      description:
        'Preauthorized verified accounts only. Exact Origin required. Secure HttpOnly session cookie; maximum eight hours, no refresh or remember-me.',
      requestBody: body(LoginRequestSchema),
      responses: { '200': success, ...errors },
    },
  },
  '/api/auth/sign-out': {
    post: {
      operationId: 'signOut',
      description:
        'Exact Origin required. Revoke server session and expire cookie; transport failure does not confirm logout.',
      responses: { '200': success, ...errors },
    },
  },
  '/api/auth/verification/request': {
    post: {
      operationId: 'requestVerification',
      security: [],
      requestBody: body(VerificationRequestSchema),
      responses: {
        '200': { description: 'Generic response without account enumeration' },
        ...errors,
      },
    },
  },
  '/api/auth/verification/confirm': {
    post: {
      operationId: 'confirmVerification',
      security: [],
      description:
        'Explicit confirmation; opening the email landing page does not consume a token.',
      requestBody: body(VerificationConfirmSchema),
      responses: { '200': success, ...errors },
    },
  },
};
