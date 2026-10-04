// Browser-side JSON helpers for our own API. Errors carry the server's safe message
// and, for validation errors, per-field messages.

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code: string; message: string; fields?: Record<string, string> } } | null;

export function postJson<T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return sendJson<T>("POST", url, body, headers);
}

export async function sendJson<T>(method: "POST" | "PATCH", url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as ErrorBody;
  if (!response.ok) {
    throw new ApiRequestError(
      data?.error?.code ?? "InternalError",
      data?.error?.message ?? "Something went wrong.",
      data?.error?.fields,
    );
  }
  return data as T;
}
