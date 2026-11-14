import { z } from 'zod';
import type { ReviewNotificationPosition } from '../ports/review-notification-reader.port.js';

export const ReviewNotificationTimestampSchema = z
  .string()
  .datetime({ precision: 6 })
  .refine((value) => !value.startsWith('0000-'), 'Timestamp year must be between 0001 and 9999');

export const ReviewNotificationUuidSchema = z
  .string()
  .uuid()
  .regex(/^[0-9a-f-]+$/, 'UUID must be canonical lowercase');

const payloadSchema = z
  .object({
    v: z.literal(1),
    createdAt: ReviewNotificationTimestampSchema,
    id: ReviewNotificationUuidSchema,
  })
  .strict();

const encodingSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export class InvalidReviewNotificationCursorError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('Invalid review notification cursor');
    this.name = 'InvalidReviewNotificationCursorError';
  }
}

function base64url(binary: string): string {
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function encodeReviewNotificationCursor(position: ReviewNotificationPosition): string {
  const payload = payloadSchema.safeParse({
    v: 1,
    createdAt: position.createdAt,
    id: position.id,
  });
  if (!payload.success) throw new InvalidReviewNotificationCursorError();
  return base64url(JSON.stringify(payload.data));
}

export function decodeReviewNotificationCursor(cursor: string): ReviewNotificationPosition {
  try {
    encodingSchema.parse(cursor);
    const padded =
      cursor.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (cursor.length % 4)) % 4);
    const binary = atob(padded);
    if (base64url(binary) !== cursor) throw new InvalidReviewNotificationCursorError();
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = payloadSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return { createdAt: payload.createdAt, id: payload.id };
  } catch {
    throw new InvalidReviewNotificationCursorError();
  }
}

export const ReviewNotificationCursorSchema = encodingSchema.refine((cursor) => {
  try {
    decodeReviewNotificationCursor(cursor);
    return true;
  } catch {
    return false;
  }
}, 'Invalid review notification cursor');
