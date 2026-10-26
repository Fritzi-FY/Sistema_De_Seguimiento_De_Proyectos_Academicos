export const DEV_IDENTITIES = {
  student: { userId: '11111111-1111-4111-8111-111111111111', role: 'student' },
  otherStudent: { userId: '22222222-2222-4222-8222-222222222222', role: 'student' },
  teacher: { userId: '33333333-3333-4333-8333-333333333333', role: 'teacher' },
} as const;

export const DEFAULT_DEV_IDENTITY = DEV_IDENTITIES.student;
