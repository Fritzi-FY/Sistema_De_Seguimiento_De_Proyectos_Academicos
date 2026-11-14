import { describe, expect, it, vi } from 'vitest';
import {
  decodeReviewNotificationCursor,
  encodeReviewNotificationCursor,
  ReviewNotificationReadError,
  type ReviewNotificationListItem,
  type ReviewNotificationReaderPort,
} from '@is488/shared';
import { ListStudentReviewNotificationsUseCase } from './list-student-review-notifications.use-case.js';

const student = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'student' };
const lowId = '11111111-1111-4111-8111-111111111111';
const highId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const timestamp = '2026-11-12T15:20:30.123456Z';

function row(id = lowId, createdAt = timestamp): ReviewNotificationListItem {
  return {
    id,
    createdAt,
    projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reviewId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    responseActionId: id,
    status: 'CHANGES_REQUESTED',
  };
}

function fixture(rows: ReviewNotificationListItem[] = []) {
  const reader = {
    listAuthorizedForStudent: vi
      .fn<ReviewNotificationReaderPort['listAuthorizedForStudent']>()
      .mockResolvedValue(rows),
    notifyReviewCompleted: vi.fn(),
    persistAuthorized: vi.fn(),
    findById: vi.fn(),
  };
  return { reader, useCase: new ListStudentReviewNotificationsUseCase(reader) };
}

describe('ListStudentReviewNotificationsUseCase (simulated reader, no SQL or HTTP)', () => {
  it('takes the student identifier only from session context, with authorized lookahead and no writes', async () => {
    const setup = fixture([row()]);
    const command = {
      session: { ...student },
      studentId: 'forged-student',
      recipientUserId: 'forged-recipient',
      userId: 'forged-user',
    };
    const result = await setup.useCase.execute(command);
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledWith({
      studentId: student.userId,
      before: undefined,
      take: 21,
    });
    expect(result).toEqual({ items: [row()], nextCursor: null });
    expect(setup.reader.notifyReviewCompleted).not.toHaveBeenCalled();
    expect(setup.reader.persistAuthorized).not.toHaveBeenCalled();
    expect(setup.reader.findById).not.toHaveBeenCalled();
    expect(command.session).toEqual(student);
  });

  it.each(['teacher', 'admin', 'Student', '', 'unknown'])(
    'rejects session role %s with 403 before reading or cursor validation',
    async (role) => {
      const setup = fixture();
      await expect(
        setup.useCase.execute({ session: { ...student, role }, query: { cursor: 'invalid' } }),
      ).rejects.toMatchObject({ statusCode: 403, message: 'Forbidden' });
      expect(setup.reader.listAuthorizedForStudent).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty session identity instead of querying an unscoped inbox', async () => {
    const setup = fixture();
    await expect(
      setup.useCase.execute({ session: { ...student, userId: ' ' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(setup.reader.listAuthorizedForStudent).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { cursor: '' },
    { cursor: 'e30' },
    { cursor: 'a'.repeat(257) },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: true },
    { studentId: 'another-user' },
    { recipientUserId: 'another-user' },
    { userId: 'another-user' },
    { projectId: 'another-project' },
  ])('rejects invalid query %j with 400 and zero store calls', async (query) => {
    const setup = fixture();
    await expect(setup.useCase.execute({ session: student, query })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Bad Request',
    });
    expect(setup.reader.listAuthorizedForStudent).not.toHaveBeenCalled();
  });

  it('rejects malformed cursor payloads without looking up their UUIDs or querying a page', async () => {
    const setup = fixture();
    for (const payload of [
      { v: 2, createdAt: timestamp, id: lowId },
      { v: 1, createdAt: '2026-11-12T15:20:30.123Z', id: lowId },
      { v: 1, createdAt: timestamp, id: 'not-a-uuid' },
      { v: 1, createdAt: timestamp, id: lowId, studentId: 'foreign' },
    ]) {
      const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      await expect(
        setup.useCase.execute({ session: student, query: { cursor } }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(setup.reader.listAuthorizedForStudent).not.toHaveBeenCalled();
    expect(setup.reader.findById).not.toHaveBeenCalled();
  });

  it('uses a valid absent or foreign cursor only as a strict position within the current session scope', async () => {
    const setup = fixture([row(lowId, '2026-11-12T15:20:30.123100Z')]);
    const before = { createdAt: timestamp, id: highId };
    const cursor = encodeReviewNotificationCursor(before);
    const result = await setup.useCase.execute({ session: student, query: { cursor, limit: '1' } });
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledWith({
      studentId: student.userId,
      before,
      take: 2,
    });
    expect(result).toEqual({
      items: [row(lowId, '2026-11-12T15:20:30.123100Z')],
      nextCursor: null,
    });
    expect(setup.reader.findById).not.toHaveBeenCalled();
  });

  it('keeps distinct responses of the same status across microsecond boundaries without Date or UUID misordering', async () => {
    const newer = row(lowId, '2026-11-12T15:20:30.123900Z');
    const older = row(highId, '2026-11-12T15:20:30.123100Z');
    const setup = fixture();
    setup.reader.listAuthorizedForStudent
      .mockResolvedValueOnce([newer, older])
      .mockResolvedValueOnce([older]);
    const first = await setup.useCase.execute({ session: student, query: { limit: 1 } });
    expect(first.items).toEqual([newer]);
    expect(decodeReviewNotificationCursor(first.nextCursor!)).toEqual({
      createdAt: newer.createdAt,
      id: newer.id,
    });
    const second = await setup.useCase.execute({
      session: student,
      query: { limit: 1, cursor: first.nextCursor },
    });
    expect(second).toEqual({ items: [older], nextCursor: null });
    expect(setup.reader.listAuthorizedForStudent.mock.calls[1]![0].before).toEqual({
      createdAt: newer.createdAt,
      id: newer.id,
    });
    expect([first.items[0]!.responseActionId, second.items[0]!.responseActionId]).toEqual([
      lowId,
      highId,
    ]);
  });

  it('preserves descending UUID ties and creates the cursor from the returned item, not lookahead', async () => {
    const setup = fixture();
    setup.reader.listAuthorizedForStudent
      .mockResolvedValueOnce([row(highId), row(lowId)])
      .mockResolvedValueOnce([row(lowId)]);
    const first = await setup.useCase.execute({ session: student, query: { limit: 1 } });
    expect(first.items).toEqual([row(highId)]);
    expect(decodeReviewNotificationCursor(first.nextCursor!)).toEqual({
      createdAt: timestamp,
      id: highId,
    });
    const second = await setup.useCase.execute({
      session: student,
      query: { limit: 1, cursor: first.nextCursor },
    });
    expect(second).toEqual({ items: [row(lowId)], nextCursor: null });
  });

  it('returns a genuine empty page without creating, repairing or retrying notifications', async () => {
    const setup = fixture();
    expect(await setup.useCase.execute({ session: student, query: { limit: 100 } })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledWith({
      studentId: student.userId,
      take: 101,
      before: undefined,
    });
    expect(setup.reader.persistAuthorized).not.toHaveBeenCalled();
    expect(setup.reader.notifyReviewCompleted).not.toHaveBeenCalled();
  });

  it('sanitizes lookup failure as 500, never an empty success or partial result, without retrying', async () => {
    const setup = fixture();
    setup.reader.listAuthorizedForStudent.mockRejectedValue(
      Object.assign(new Error('Private SQL details and credentials'), { statusCode: 404 }),
    );
    await expect(setup.useCase.execute({ session: student })).rejects.toMatchObject({
      name: 'ReviewNotificationReadError',
      statusCode: 500,
      message: 'Unable to read review notifications',
    });
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
    expect(setup.reader.notifyReviewCompleted).not.toHaveBeenCalled();
    expect(setup.reader.persistAuthorized).not.toHaveBeenCalled();
  });

  it.each([
    ['ascending', [row(lowId), row(highId)]],
    ['duplicate', [row(lowId), row(lowId)]],
    ['excess rows', [row(highId), row(lowId), row(lowId)]],
    ['truncated timestamp', [row(lowId, '2026-11-12T15:20:30.123Z')]],
    ['extra private data', [{ ...row(), observation: 'private' }]],
    ['invalid status', [{ ...row(), status: 'PENDING' }]],
  ])('fails closed for a malformed reader result: %s', async (_scenario, rows) => {
    const setup = fixture();
    setup.reader.listAuthorizedForStudent.mockResolvedValue(rows as ReviewNotificationListItem[]);
    await expect(
      setup.useCase.execute({ session: student, query: { limit: 1 } }),
    ).rejects.toBeInstanceOf(ReviewNotificationReadError);
    expect(setup.reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
  });

  it.each([timestamp, '2026-11-12T15:20:30.123457Z'])(
    'rejects a reader that violates the strict cursor boundary: %s',
    async (createdAt) => {
      const setup = fixture([row(lowId, createdAt)]);
      const cursor = encodeReviewNotificationCursor({ id: lowId, createdAt: timestamp });
      await expect(
        setup.useCase.execute({ session: student, query: { cursor } }),
      ).rejects.toBeInstanceOf(ReviewNotificationReadError);
    },
  );

  it('returns copies without mutating query, supplied rows or notification history', async () => {
    const original = Object.freeze(row());
    const rows = [original];
    Object.freeze(rows);
    const setup = fixture(rows);
    const query = Object.freeze({ limit: 1 });
    const result = await setup.useCase.execute({ session: student, query });
    result.items[0]!.status = 'APPROVED';
    expect(original.status).toBe('CHANGES_REQUESTED');
    expect(query).toEqual({ limit: 1 });
    expect(rows).toEqual([row()]);
  });
});
