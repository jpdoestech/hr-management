const BUILT_IN_EXPORT_ROLES = new Set(['Administrator', 'HR Staff']);

export function roleCanExport(role, explicitlyAllowed = false) {
  return BUILT_IN_EXPORT_ROLES.has(role) || explicitlyAllowed === true;
}
