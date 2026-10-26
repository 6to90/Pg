import { z } from 'zod';
import { ALLOWED_CHAIN_IDS, BASE_SEPOLIA_CHAIN_ID, isAllowedChainId } from './chains';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'testnet']),
    PRODUCT_NAME: z.string().trim().min(1).max(80).default('6to9 Crypto Payment Gateway'),
    DATABASE_URL: z
      .string()
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// URL'),
    CHAIN_ID: z.coerce
      .number()
      .int()
      .refine(isAllowedChainId, `must be one of ${ALLOWED_CHAIN_IDS.join(', ')} (testnets only)`),
    RPC_URL: z.url({ protocol: /^https?$/ }).optional(),
    CONFIRMATIONS: z.coerce.number().int().min(1).max(1000).default(12),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'testnet') {
      if (env.CHAIN_ID !== BASE_SEPOLIA_CHAIN_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['CHAIN_ID'],
          message: `APP_ENV=testnet requires CHAIN_ID=${BASE_SEPOLIA_CHAIN_ID}`,
        });
      }
      if (env.RPC_URL !== undefined && !env.RPC_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['RPC_URL'],
          message: 'APP_ENV=testnet requires an https RPC_URL',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Thrown for invalid configuration. Messages never include the offending values. */
export class ConfigError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` in a .env file behaves like a missing key.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}
