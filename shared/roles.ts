export function seesOwnData(role: string): boolean {
  return role === "USER" || role === "SALE";
}

export function canCheckPrices(role: string): boolean {
  return role === "ADMIN" || role === "IT" || role === "USER" || role === "SALE";
}

export function canManageMaster(role: string): boolean {
  return role === "ADMIN" || role === "IT";
}

export function canManageUsers(role: string): boolean {
  return role === "ADMIN" || role === "IT";
}

export function canViewLogs(role: string): boolean {
  return role === "IT";
}

export function roleLabel(role: string): string {
  if (role === "SALE" || role === "USER") return "Sale";
  if (role === "ADMIN") return "Admin";
  if (role === "IT") return "IT";
  if (role === "VIEWER") return "Viewer";
  return role;
}
