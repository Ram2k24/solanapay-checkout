// Safety checks for the development seed. The seed must never run against a
// production, shared or test database, so every condition must hold.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function seedRefusal(env: { APP_ENV?: string; DATABASE_URL?: string }): string | null {
  if (env.APP_ENV !== "development") return `APP_ENV must be "development" (got "${env.APP_ENV ?? ""}").`;

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    return "DATABASE_URL is not a valid URL.";
  }
  if (!LOCAL_HOSTS.has(url.hostname)) return `The database host must be local (got "${url.hostname}").`;
  if (url.pathname.slice(1).endsWith("_test")) return "Refusing to seed a test database.";
  return null;
}
