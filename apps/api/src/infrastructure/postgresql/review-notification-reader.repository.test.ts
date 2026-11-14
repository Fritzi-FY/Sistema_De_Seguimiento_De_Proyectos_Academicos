import { describe, expect, it, vi } from 'vitest';
import { PostgresqlReviewNotificationReader } from './review-notification-reader.repository.js';
import { SqlSession } from './session.js';

describe('PostgreSQL inbox query construction (no connection)', () => {
  it.each([
    undefined,
    { createdAt: '2026-11-12T15:20:30.123456Z', id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  ])('uses one parameterized scoped SELECT, including exact position %j', async (before) => {
    const session = new SqlSession({});
    const query = vi
      .spyOn(session, 'query')
      .mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });
    const studentId = "student' OR TRUE --";
    const reader = new PostgresqlReviewNotificationReader(() => session);
    expect(await reader.listAuthorizedForStudent({ studentId, before, take: 21 })).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).not.toContain(studentId);
    expect(parameters).toEqual(
      before ? [studentId, before.createdAt, before.id, 21] : [studentId, 21],
    );
    expect(sql).toContain('r.requester_id = n.recipient_user_id');
    expect(sql).toContain('n.recipient_user_id = $1');
    expect(sql).toContain("n.kind = 'TEACHER_REVIEW_COMPLETED'");
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('ORDER BY n.created_at DESC, n.id DESC');
    expect(sql).toContain('HH24:MI:SS.US');
    expect(sql).not.toMatch(/FOR (UPDATE|SHARE)|INSERT|DELETE|UPDATE public/);
    expect(sql).not.toContain('teacher_project_assignments');
    if (before) expect(sql).toContain('(n.created_at, n.id) < ($2::timestamptz, $3::uuid)');
  });

  it('rejects malformed rows without exposing SQL details or returning a partial list', async () => {
    const session = new SqlSession({});
    const query = vi.spyOn(session, 'query').mockResolvedValue({
      rows: [{ private: 'details' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    const reader = new PostgresqlReviewNotificationReader(() => session);
    await expect(
      reader.listAuthorizedForStudent({ studentId: 'student', take: 2 }),
    ).rejects.toMatchObject({ statusCode: 500, message: 'Unable to read review notifications' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
