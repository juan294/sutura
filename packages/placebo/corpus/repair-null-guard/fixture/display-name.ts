interface User { name?: string }

export function displayName(user: User | null): string {
  return user?.name ?? 'guest';
}
