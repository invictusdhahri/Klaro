export function toIsoDate(d: Date | string | number): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function startOfMonth(d: Date | string): Date {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

export function monthsBetween(from: Date | string, to: Date | string): number {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function daysSince(d: Date | string): number {
  const ms = Date.now() - new Date(d).getTime();
  return Math.floor(ms / 86_400_000);
}
