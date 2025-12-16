export function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function coerceJsonEnv<T = unknown>(name: string): T {
  const raw = mustGetEnv(name);
  return JSON.parse(raw);
}
