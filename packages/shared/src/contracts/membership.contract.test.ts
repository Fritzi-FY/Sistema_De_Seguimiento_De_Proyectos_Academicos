import { describe, it, expect } from 'vitest';
import { AddMemberRequestSchema, MembershipResponseSchema } from './membership.contract.js';

describe('AddMemberRequestSchema', () => {
  it('acepta una carga válida con userId UUID y role collaborator', () => {
    const result = AddMemberRequestSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'collaborator',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza userId con formato no UUID', () => {
    const result = AddMemberRequestSchema.safeParse({
      userId: 'not-a-uuid',
      role: 'collaborator',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('userId');
    }
  });

  it('rechaza role con valor "owner" (fuera del enum público)', () => {
    const result = AddMemberRequestSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'owner',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('role');
    }
  });

  it('rechaza role con valor "admin" (fuera del enum público)', () => {
    const result = AddMemberRequestSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza role con cadena vacía', () => {
    const result = AddMemberRequestSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      role: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('MembershipResponseSchema', () => {
  const validMembership = {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    userId: 'user-student-01',
    role: 'owner' as const,
    status: 'active' as const,
    joinedAt: '2026-10-12T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z',
  };

  it('valida correctamente una membresía con todos los campos obligatorios', () => {
    const result = MembershipResponseSchema.safeParse(validMembership);
    expect(result.success).toBe(true);
  });

  it('valida membresía con role collaborator', () => {
    const result = MembershipResponseSchema.safeParse({
      ...validMembership,
      role: 'collaborator',
    });
    expect(result.success).toBe(true);
  });

  it('valida membresía con status removed', () => {
    const result = MembershipResponseSchema.safeParse({
      ...validMembership,
      status: 'removed',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza membresía con id no UUID', () => {
    const result = MembershipResponseSchema.safeParse({
      ...validMembership,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('id');
    }
  });

  it('rechaza membresía sin campo projectId', () => {
    const { projectId: _, ...withoutProjectId } = validMembership;
    const result = MembershipResponseSchema.safeParse(withoutProjectId);
    expect(result.success).toBe(false);
  });

  it('rechaza membresía sin campo joinedAt', () => {
    const { joinedAt: _, ...withoutJoinedAt } = validMembership;
    const result = MembershipResponseSchema.safeParse(withoutJoinedAt);
    expect(result.success).toBe(false);
  });
});
