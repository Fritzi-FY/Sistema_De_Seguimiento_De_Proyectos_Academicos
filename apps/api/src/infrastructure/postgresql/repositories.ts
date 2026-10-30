import {
  DuplicateMembershipError,
  ProjectAlreadyExistsError,
  MembershipNotFoundError,
  type Project,
  type ProjectMembership,
  type ProjectRepositoryPort,
  type MembershipRepositoryPort,
  type ProjectCreationPort,
  type RemoveMembershipCondition,
} from '@is488/shared';
import { currentSqlSession, PersistenceTransactionError, type SqlSession } from './session.js';

const projectColumns =
  'id, title, description, course_code AS "courseCode", status, start_date AS "startDate", target_date AS "targetDate", creator_id AS "creatorId", created_at AS "createdAt", updated_at AS "updatedAt"';
const membershipColumns =
  'id, project_id AS "projectId", user_id AS "userId", role, status, joined_at AS "joinedAt", updated_at AS "updatedAt", removed_at AS "removedAt"';
type ProjectRow = Omit<
  Project,
  'startDate' | 'targetDate' | 'createdAt' | 'updatedAt' | 'description'
> & {
  description: string | null;
  startDate: Date;
  targetDate: Date;
  createdAt: Date;
  updatedAt: Date;
};
type MembershipRow = Omit<ProjectMembership, 'joinedAt' | 'updatedAt' | 'removedAt'> & {
  joinedAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
};
function project(row: ProjectRow): Project {
  const { description, ...rest } = row;
  return {
    ...rest,
    ...(description === null ? {} : { description }),
    startDate: row.startDate.toISOString(),
    targetDate: row.targetDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function membership(row: MembershipRow): ProjectMembership {
  return {
    ...row,
    joinedAt: row.joinedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}
const projectValues = (p: Project) => [
  p.id,
  p.title,
  p.description ?? null,
  p.courseCode,
  p.status,
  p.startDate,
  p.targetDate,
  p.creatorId,
  p.createdAt,
  p.updatedAt,
];
const insertProject =
  'INSERT INTO public.projects (id,title,description,course_code,status,start_date,target_date,creator_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
const membershipValues = (m: ProjectMembership) => [
  m.id,
  m.projectId,
  m.userId,
  m.role,
  m.status,
  m.joinedAt,
  m.updatedAt,
  m.removedAt,
];
const insertMembership =
  'INSERT INTO public.project_memberships (id,project_id,user_id,role,status,joined_at,updated_at,removed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
type SessionProvider = () => SqlSession;
const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class PostgresqlProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly session: SessionProvider = currentSqlSession) {}
  async save(p: Project): Promise<void> {
    await this.session().query(
      insertProject +
        ' ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, course_code=EXCLUDED.course_code, status=EXCLUDED.status, start_date=EXCLUDED.start_date, target_date=EXCLUDED.target_date, creator_id=EXCLUDED.creator_id, created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at',
      projectValues(p),
    );
  }
  async findById(id: string): Promise<Project | null> {
    if (!isUuid(id)) return null;
    const result = await this.session().query<ProjectRow>(
      'SELECT ' + projectColumns + ' FROM public.projects WHERE id=$1',
      [id],
    );
    return result.rows[0] ? project(result.rows[0]) : null;
  }
  async findAll(): Promise<Project[]> {
    return (
      await this.session().query<ProjectRow>(
        'SELECT ' + projectColumns + ' FROM public.projects ORDER BY created_at,id',
      )
    ).rows.map(project);
  }
  async findByUser(userId: string): Promise<Project[]> {
    return (
      await this.session().query<ProjectRow>(
        'SELECT ' +
          projectColumns +
          ' FROM public.projects WHERE creator_id=$1 ORDER BY created_at,id',
        [userId],
      )
    ).rows.map(project);
  }
}
export class PostgresqlMembershipRepository implements MembershipRepositoryPort {
  constructor(private readonly session: SessionProvider = currentSqlSession) {}
  async addMember(
    data: Omit<ProjectMembership, 'id'> & { id?: string },
  ): Promise<ProjectMembership> {
    const m = { ...data, id: data.id ?? crypto.randomUUID() };
    try {
      const result = await this.session().query<MembershipRow>(
        insertMembership + ' RETURNING ' + membershipColumns,
        membershipValues(m),
      );
      return membership(result.rows[0]!);
    } catch (error) {
      const e =
        error instanceof PersistenceTransactionError && error.outcome === 'rolled_back'
          ? { code: error.sqlState, constraint: error.constraint }
          : (error as { code?: string; constraint?: string });
      if (e.code === '23505' && e.constraint === 'membership_active_pair')
        throw new DuplicateMembershipError(data.projectId, data.userId);
      throw error;
    }
  }
  async removeMember(c: RemoveMembershipCondition): Promise<ProjectMembership> {
    if (!isUuid(c.membershipId) || !isUuid(c.projectId))
      throw new MembershipNotFoundError(c.membershipId);
    const result = await this.session().query<MembershipRow>(
      "UPDATE public.project_memberships SET status='removed',removed_at=$4,updated_at=$4 WHERE id=$1 AND project_id=$2 AND user_id=$3 AND status='active' AND role='collaborator' RETURNING " +
        membershipColumns,
      [c.membershipId, c.projectId, c.userId, c.removedAt],
    );
    if (!result.rows[0]) throw new MembershipNotFoundError(c.membershipId);
    return membership(result.rows[0]);
  }
  async findByProject(projectId: string): Promise<ProjectMembership[]> {
    if (!isUuid(projectId)) return [];
    return (
      await this.session().query<MembershipRow>(
        'SELECT ' +
          membershipColumns +
          " FROM public.project_memberships WHERE project_id=$1 AND status='active' ORDER BY joined_at,id",
        [projectId],
      )
    ).rows.map(membership);
  }
  async findByUser(userId: string): Promise<ProjectMembership[]> {
    return (
      await this.session().query<MembershipRow>(
        'SELECT ' +
          membershipColumns +
          " FROM public.project_memberships WHERE user_id=$1 AND status='active' ORDER BY joined_at,id",
        [userId],
      )
    ).rows.map(membership);
  }
  async findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMembership | null> {
    if (!isUuid(projectId)) return null;
    const result = await this.session().query<MembershipRow>(
      'SELECT ' +
        membershipColumns +
        " FROM public.project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active'",
      [projectId, userId],
    );
    return result.rows[0] ? membership(result.rows[0]) : null;
  }
}
export class PostgresqlProjectCreationAdapter implements ProjectCreationPort {
  constructor(private readonly session: SessionProvider = currentSqlSession) {}
  async createProjectWithOwner(p: Project, m: ProjectMembership): Promise<void> {
    if (
      m.projectId !== p.id ||
      m.userId !== p.creatorId ||
      m.role !== 'owner' ||
      m.status !== 'active' ||
      m.removedAt !== null
    )
      throw new Error('Invalid initial owner');
    const session = this.session();
    try {
      await session.transaction(async () => {
        await session.query(insertProject, projectValues(p));
        await session.query(insertMembership, membershipValues(m));
      });
    } catch (error) {
      if (
        error instanceof PersistenceTransactionError &&
        error.outcome === 'rolled_back' &&
        error.sqlState === '23505'
      ) {
        if (error.constraint === 'projects_pkey') throw new ProjectAlreadyExistsError(p.id);
        if (error.constraint === 'membership_active_pair')
          throw new DuplicateMembershipError(m.projectId, m.userId);
      }
      throw error;
    }
  }
}
