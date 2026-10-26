import { getPool } from '@/db/pool';
import { errorResponse, jsonResponse } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkReadiness } from '@/lib/readiness';

export const dynamic = 'force-dynamic';

/** Readiness: dependencies needed to serve traffic are reachable and the schema is current. */
export async function GET(): Promise<Response> {
  try {
    const readiness = await checkReadiness(getPool());
    return jsonResponse(
      { status: readiness.ready ? 'ready' : 'not_ready', checks: readiness.checks },
      readiness.ready ? 200 : 503,
    );
  } catch (err) {
    // e.g. invalid configuration; log the class only, never the message (may name settings).
    logger.error(
      { errorName: err instanceof Error ? err.name : 'unknown' },
      'readiness check crashed',
    );
    return errorResponse(503, 'not_ready', 'Service is not ready');
  }
}
