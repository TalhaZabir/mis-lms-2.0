// Single source of truth for role-based access (frontend + docs).
// Backend enforces the same via requireRoles(); frontend only hides.
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN_STAFF: 'ADMIN_STAFF',
  FACULTY: 'FACULTY',
  TA: 'TA',
  STUDENT: 'STUDENT',
  ALUMNI: 'ALUMNI',
  MODERATOR: 'MODERATOR',
};

export const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_STAFF];
export const TEACH_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_STAFF, ROLES.FACULTY, ROLES.TA];
export const LEARN_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_STAFF, ROLES.FACULTY, ROLES.TA, ROLES.STUDENT, ROLES.MODERATOR];
export const CONNECT_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_STAFF, ROLES.FACULTY, ROLES.TA, ROLES.STUDENT, ROLES.ALUMNI, ROLES.MODERATOR];
export const RESOURCE_ROLES = [...CONNECT_ROLES];
export const MOD_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_STAFF, ROLES.MODERATOR];
export const CURATOR_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_STAFF, ROLES.FACULTY];

export const NAV = [
  { href: '/', label: 'Home', roles: null }, // public
  { href: '/admin', label: 'Admin', roles: ADMIN_ROLES },
  { href: '/teach', label: 'Teach', roles: TEACH_ROLES },
  { href: '/learn', label: 'Learn', roles: LEARN_ROLES },
  { href: '/connect', label: 'Connect', roles: CONNECT_ROLES },
  { href: '/resources', label: 'Resources', roles: RESOURCE_ROLES },
];

export function can(roles, user) {
  if (!roles) return true; // public
  if (!user) return false;
  return roles.includes(user.role);
}

export const ROLE_HOME = {
  SUPER_ADMIN: '/admin',
  ADMIN_STAFF: '/admin',
  FACULTY: '/teach',
  TA: '/teach',
  STUDENT: '/learn',
  MODERATOR: '/learn',
  ALUMNI: '/connect',
};
