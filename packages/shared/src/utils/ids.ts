/**
 * Tiny ULID-like timestamp ID for client-side optimistic IDs.
 * For DB-bound UUIDs, rely on Postgres `gen_random_uuid()`.
 */
export function clientId(prefix = 'tmp'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}${rand}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
