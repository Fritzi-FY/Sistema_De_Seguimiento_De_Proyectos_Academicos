import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeReviewNotificationCursor } from '@is488/shared';
import { ListStudentReviewNotificationsUseCase } from '../../../application/use-cases/list-student-review-notifications.use-case.js';
import { InMemoryReviewNotificationRepository } from './in-memory-review-notification.repository.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import { InMemoryMembershipRepository } from './in-memory-membership.repository.js';

const newer = '2026-11-12T15:20:30.123900Z';
const older = '2026-11-12T15:20:30.123100Z';
const low = '11111111-1111-4111-8111-111111111111';
const middle = '88888888-8888-4888-8888-888888888888';
const high = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function fixture() {
  const reviews = new InMemoryReviewRepository();
  const memberships = new InMemoryMembershipRepository();
  let timestamp = newer;
  const repository = new InMemoryReviewNotificationRepository(reviews, memberships, {
    now: () => new Date(),
    isoString: () => timestamp,
  });
  async function add(
    student: string,
    id: string,
    createdAt = newer,
    projectId = crypto.randomUUID(),
  ) {
    let member = await memberships.findByProjectAndUser(projectId, student);
    member ??= await memberships.addMember({
      projectId,
      userId: student,
      role: 'collaborator',
      status: 'active',
      joinedAt: newer,
      updatedAt: newer,
      removedAt: null,
    });
    const review = await reviews.createRequest({
      projectId,
      requesterId: student,
      title: 'Synthetic inbox',
      description: 'Synthetic progress',
    });
    const response = await reviews.recordTeacherResponse(projectId, review.id, {
      reviewerId: 'teacher',
      status: 'CHANGES_REQUESTED',
      observation: 'Synthetic changes',
    });
    const input = {
      projectId,
      reviewId: review.id,
      responseActionId: response.responseActionId,
      recipientUserId: student,
      reviewerId: 'teacher',
      status: 'CHANGES_REQUESTED' as const,
    };
    timestamp = createdAt;
    const uuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(id as ReturnType<typeof crypto.randomUUID>);
    try {
      await repository.persistAuthorized(input);
    } finally {
      uuid.mockRestore();
    }
    return { member, input, review };
  }
  async function remove(member: Awaited<ReturnType<typeof memberships.addMember>>) {
    await memberships.removeMember({
      membershipId: member.id,
      projectId: member.projectId,
      userId: member.userId,
      removedAt: newer,
    });
  }
  return {
    reviews,
    memberships,
    repository,
    add,
    remove,
    useCase: new ListStudentReviewNotificationsUseCase(repository),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Student inbox memory reader (simulated storage, shared with writer)', () => {
  it('filters recipients and current membership before taking an authorized lookahead', async () => {
    const setup = fixture();
    await setup.add('other-student', high);
    const removed = await setup.add('student', middle);
    await setup.remove(removed.member);
    await setup.add('student', low, older);
    const page = await setup.useCase.execute({
      session: { userId: 'student', role: 'student' },
      query: { limit: 1 },
    });
    expect(page.items.map((row) => row.id)).toEqual([low]);
    expect(page.nextCursor).toBeNull();
    expect(
      await setup.repository.listAuthorizedForStudent({ studentId: 'stranger', take: 2 }),
    ).toEqual([]);
    expect(setup.repository.notifications).toHaveLength(3);
  });

  it('revalidates between pages, fills from another project and restores eligibility on readmission', async () => {
    const setup = fixture();
    const first = await setup.add('student', low, newer);
    await setup.add('student', high, older, first.input.projectId);
    await setup.add('student', middle, '2026-11-12T15:20:30.123000Z');
    const session = { userId: 'student', role: 'student' };
    const page = await setup.useCase.execute({ session, query: { limit: 1 } });
    expect(page.items[0]!.id).toBe(low);
    await setup.remove(first.member);
    const next = await setup.useCase.execute({
      session,
      query: { limit: 1, cursor: page.nextCursor },
    });
    expect(next.items.map((row) => row.id)).toEqual([middle]);
    expect(next.nextCursor).toBeNull();
    await setup.memberships.addMember({ ...first.member, id: undefined });
    expect((await setup.useCase.execute({ session })).items.map((row) => row.id)).toEqual([
      low,
      high,
      middle,
    ]);
  });

  it('paginates microseconds before reverse UUIDs and exact timestamp ties without skips or duplicates', async () => {
    const setup = fixture();
    await setup.add('student', low, newer);
    await setup.add('student', middle, older);
    await setup.add('student', high, older);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await setup.useCase.execute({
        session: { userId: 'student', role: 'student' },
        query: { limit: 1, cursor },
      });
      ids.push(...page.items.map((row) => row.id));
      if (page.nextCursor)
        expect(decodeReviewNotificationCursor(page.nextCursor)).toEqual({
          id: page.items[0]!.id,
          createdAt: page.items[0]!.createdAt,
        });
      cursor = page.nextCursor ?? undefined;
    } while (cursor && ids.length < 5);
    expect(ids).toEqual([low, high, middle]);
    expect(new Set(ids).size).toBe(3);
  });

  it.each(['2026-11-12T15:20:30Z', '2026-11-12T15:20:30.123Z', older])(
    'normalizes without discarding available fractional precision: %s',
    async (createdAt) => {
      const setup = fixture();
      await setup.add('student', low, createdAt);
      const [row] = await setup.repository.listAuthorizedForStudent({
        studentId: 'student',
        take: 2,
      });
      expect(row!.createdAt).toBe(
        createdAt === older
          ? older
          : createdAt.replace(
              /(?:\.(\d+))?Z$/,
              (_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(6, '0')}Z`,
            ),
      );
    },
  );

  it('retains distinct historical responses after approval and returns defensive minimal copies', async () => {
    const setup = fixture();
    const first = await setup.add('student', low);
    for (const status of ['CHANGES_REQUESTED', 'APPROVED'] as const) {
      await setup.reviews.recordStudentResubmission(first.input.projectId, first.review.id, {
        studentId: 'student',
        description: 'Synthetic correction',
      });
      const response = await setup.reviews.recordTeacherResponse(
        first.input.projectId,
        first.review.id,
        { reviewerId: 'replacement-teacher', status, observation: 'Synthetic response' },
      );
      await setup.repository.persistAuthorized({
        ...first.input,
        reviewerId: 'replacement-teacher',
        responseActionId: response.responseActionId,
        status,
      });
    }
    const before = setup.repository.notifications;
    const rows = await setup.repository.listAuthorizedForStudent({
      studentId: 'student',
      take: 101,
    });
    expect(rows.map((row) => row.status).sort()).toEqual([
      'APPROVED',
      'CHANGES_REQUESTED',
      'CHANGES_REQUESTED',
    ]);
    expect(new Set(rows.map((row) => row.responseActionId)).size).toBe(3);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'createdAt',
      'id',
      'projectId',
      'responseActionId',
      'reviewId',
      'status',
    ]);
    rows[0]!.status = 'APPROVED';
    expect(setup.repository.notifications).toEqual(before);
  });

  it.each(['missing', 'foreign-requester', 'foreign-project'])(
    'requires the matching original review context: %s',
    async (scenario) => {
      const setup = fixture();
      const entry = await setup.add('student', low);
      const review = await setup.reviews.findById(entry.input.projectId, entry.review.id);
      vi.spyOn(setup.reviews, 'findById').mockResolvedValue(
        scenario === 'missing'
          ? null
          : {
              ...review!,
              ...(scenario === 'foreign-requester'
                ? { requesterId: 'other' }
                : { projectId: crypto.randomUUID() }),
            },
      );
      expect(
        await setup.repository.listAuthorizedForStudent({ studentId: 'student', take: 2 }),
      ).toEqual([]);
    },
  );

  it.each(['review', 'membership', 'timestamp'])(
    'fails closed without partial results or repair on %s failure',
    async (failure) => {
      const setup = fixture();
      await setup.add('student', high);
      await setup.add('student', low, failure === 'timestamp' ? 'invalid' : older);
      const before = setup.repository.notifications;
      if (failure === 'review')
        vi.spyOn(setup.reviews, 'findById').mockRejectedValueOnce(new Error('private'));
      if (failure === 'membership')
        vi.spyOn(setup.memberships, 'findByProjectAndUser').mockRejectedValueOnce(
          new Error('private'),
        );
      await expect(
        setup.useCase.execute({ session: { userId: 'student', role: 'student' } }),
      ).rejects.toMatchObject({ statusCode: 500, message: 'Unable to read review notifications' });
      expect(setup.repository.notifications).toEqual(before);
    },
  );
});
