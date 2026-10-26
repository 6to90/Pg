import { randomUUID } from 'node:crypto';

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Fixed-shape error response. Never pass internal error text, stack traces or URLs here. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId = randomUUID(),
): Response {
  const body: ApiErrorBody = { error: { code, message, requestId } };
  return Response.json(body, { status, headers: { ...NO_STORE, 'X-Request-Id': requestId } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}
