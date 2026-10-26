import { getEnv } from '@/config/env';
import { jsonResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Liveness: the process is up. Does not touch the database or the chain. */
export function GET(): Response {
  const env = getEnv();
  return jsonResponse({
    status: 'ok',
    service: env.PRODUCT_NAME,
    network: 'testnet',
    chainId: env.CHAIN_ID,
  });
}
