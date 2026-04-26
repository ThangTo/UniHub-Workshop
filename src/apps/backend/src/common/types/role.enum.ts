export const ROLES = {
  STUDENT: 'STUDENT',
  ORGANIZER: 'ORGANIZER',
  CHECKIN_STAFF: 'CHECKIN_STAFF',
  SYS_ADMIN: 'SYS_ADMIN',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: RoleName[] = Object.values(ROLES);
