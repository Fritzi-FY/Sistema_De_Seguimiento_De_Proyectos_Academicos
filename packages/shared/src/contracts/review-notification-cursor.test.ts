import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareReviewNotificationPositions } from '../ports/review-notification-reader.port.js';
import {
  decodeReviewNotificationCursor,
  encodeReviewNotificationCursor,
  InvalidReviewNotificationCursorError,
  ReviewNotificationCursorSchema,
  ReviewNotificationTimestampSchema,
} from './review-notification-cursor.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const createdAt = '2026-11-12T15:20:30.123456Z';
const position = { createdAt, id };
const token = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

afterEach(() => vi.restoreAllMocks());

describe('Review notification cursor v1', () => {
  it('round-trips exactly six fractional digits and the UUID without Date conversion', () => {
    const date = vi.spyOn(globalThis, 'Date').mockImplementation(() => {
      throw new Error('Date must not be used for cursor precision');
    });
    const cursor = encodeReviewNotificationCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor.length).toBeLessThanOrEqual(256);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
      v: 1,
      ...position,
    });
    expect(decodeReviewNotificationCursor(cursor)).toEqual(position);
    expect(ReviewNotificationCursorSchema.parse(cursor)).toBe(cursor);
    expect(date).not.toHaveBeenCalled();
  });

  it.each(['000000', '000001', '123100', '123900', '999999'])(
    'preserves fractional digits %s including trailing zeros',
    (fraction) => {
      const input = { ...position, createdAt: `2026-11-12T15:20:30.${fraction}Z` };
      expect(decodeReviewNotificationCursor(encodeReviewNotificationCursor(input))).toEqual(input);
    },
  );

  it('orders distinct microseconds before UUID and UUID as a deterministic tie breaker', () => {
    const older = { createdAt: '2026-11-12T15:20:30.123100Z', id };
    const newer = {
      createdAt: '2026-11-12T15:20:30.123900Z',
      id: '11111111-1111-4111-8111-111111111111',
    };
    expect(compareReviewNotificationPositions(older, newer)).toBe(-1);
    expect(compareReviewNotificationPositions(newer, older)).toBe(1);
    expect(compareReviewNotificationPositions(older, { ...older, id: newer.id })).toBe(1);
    expect(compareReviewNotificationPositions({ ...older, id: newer.id }, older)).toBe(-1);
    expect(compareReviewNotificationPositions(older, { ...older })).toBe(0);
  });

  it.each([
    '',
    'a',
    'a'.repeat(257),
    'not+base64',
    'not/base64',
    'e30=',
    ' e30',
    Buffer.from('not JSON').toString('base64url'),
    Buffer.from('{"v":').toString('base64url'),
    Buffer.from([0xff, 0xfe]).toString('base64url'),
  ])('rejects invalid encoding, size, JSON or UTF-8: %s', (cursor) => {
    expect(() => decodeReviewNotificationCursor(cursor)).toThrow(
      InvalidReviewNotificationCursorError,
    );
    expect(ReviewNotificationCursorSchema.safeParse(cursor).success).toBe(false);
  });

  it('rejects noncanonical base64url padding bits rather than silently accepting an alias', () => {
    let json = JSON.stringify({ v: 1, ...position });
    while (Buffer.byteLength(json) % 3 === 0) json += ' ';
    const canonical = Buffer.from(json).toString('base64url');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const index = alphabet.indexOf(canonical.at(-1)!);
    const alias = canonical.slice(0, -1) + alphabet[index + 1];
    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(canonical, 'base64url'));
    expect(() => decodeReviewNotificationCursor(alias)).toThrow(
      InvalidReviewNotificationCursorError,
    );
  });

  it.each([
    null,
    [],
    'string',
    { v: 2, ...position },
    { v: '1', ...position },
    { ...position },
    { v: 1, createdAt },
    { v: 1, id },
    { v: 1, ...position, studentId: 'another-user' },
    { v: 1, ...position, id: 'not-a-uuid' },
    { v: 1, ...position, id: id.toUpperCase() },
    { v: 1, ...position, createdAt: null },
  ])('rejects an invalid version, shape, identity or timestamp type: %j', (payload) => {
    const cursor = token(payload);
    expect(() => decodeReviewNotificationCursor(cursor)).toThrow(
      expect.objectContaining({ statusCode: 400, message: 'Invalid review notification cursor' }),
    );
    expect(ReviewNotificationCursorSchema.safeParse(cursor).success).toBe(false);
  });

  it.each([
    '2026-02-29T15:20:30.123456Z',
    '1900-02-29T15:20:30.123456Z',
    '2100-02-29T15:20:30.123456Z',
    '2026-04-31T15:20:30.123456Z',
    '2026-13-01T15:20:30.123456Z',
    '2026-01-00T15:20:30.123456Z',
    '2026-11-12T24:20:30.123456Z',
    '2026-11-12T15:60:30.123456Z',
    '2026-11-12T15:20:60.123456Z',
    '2026-11-12T15:20:30.123Z',
    '2026-11-12T15:20:30.12345Z',
    '2026-11-12T15:20:30.1234567Z',
    '2026-11-12T15:20:30.123456+00:00',
    '2026-11-12T15:20:30.123456',
    '0000-01-01T00:00:00.000000Z',
    'Infinity',
  ])('rejects an unreal or noncanonical calendar timestamp: %s', (timestamp) => {
    expect(ReviewNotificationTimestampSchema.safeParse(timestamp).success).toBe(false);
    expect(() => encodeReviewNotificationCursor({ ...position, createdAt: timestamp })).toThrow(
      InvalidReviewNotificationCursorError,
    );
    expect(() =>
      decodeReviewNotificationCursor(token({ v: 1, ...position, createdAt: timestamp })),
    ).toThrow(InvalidReviewNotificationCursorError);
  });

  it.each(['2000-02-29T00:00:00.000000Z', '2024-02-29T23:59:59.999999Z'])(
    'accepts a real Gregorian leap date without normalizing it: %s',
    (timestamp) => {
      const input = { ...position, createdAt: timestamp };
      expect(decodeReviewNotificationCursor(encodeReviewNotificationCursor(input))).toEqual(input);
    },
  );

  it('treats arbitrary valid positions only as positions, without recipient claims', () => {
    const input = { ...position, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    expect(decodeReviewNotificationCursor(token({ v: 1, ...input }))).toEqual(input);
    const withExtraIdentity = { ...input, studentId: 'not-serialized' };
    expect(encodeReviewNotificationCursor(withExtraIdentity)).toBe(
      encodeReviewNotificationCursor(input),
    );
  });
});
