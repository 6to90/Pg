import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '@/config/env';

const base = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgres://u:supersecretpw@127.0.0.1:5432/db',
  CHAIN_ID: '31337',
};

describe('parseEnv', () => {
  it('accepts a valid local config and applies defaults', () => {
    const env = parseEnv(base);
    expect(env.CONFIRMATIONS).toBe(12);
    expect(env.CHAIN_ID).toBe(31337);
    expect(env.PRODUCT_NAME).toBe('6to9 Crypto Payment Gateway');
  });

  it('accepts Base Sepolia on testnet with https RPC', () => {
    const env = parseEnv({
      ...base,
      APP_ENV: 'testnet',
      CHAIN_ID: '84532',
      RPC_URL: 'https://sepolia.base.org',
    });
    expect(env.CHAIN_ID).toBe(84532);
  });

  it.each(['1', '8453', '10', '137', '0', '-1', 'abc', '84532.5'])(
    'rejects non-testnet chain id %s',
    (id) => {
      expect(() => parseEnv({ ...base, CHAIN_ID: id })).toThrow(ConfigError);
    },
  );

  it.each(['production', 'mainnet', 'staging', ''])('rejects APP_ENV=%s', (v) => {
    expect(() => parseEnv({ ...base, APP_ENV: v })).toThrow(ConfigError);
  });

  it('requires Base Sepolia and https RPC when APP_ENV=testnet', () => {
    expect(() => parseEnv({ ...base, APP_ENV: 'testnet' })).toThrow(/CHAIN_ID/);
    expect(() =>
      parseEnv({
        ...base,
        APP_ENV: 'testnet',
        CHAIN_ID: '84532',
        RPC_URL: 'http://rpc.example.com',
      }),
    ).toThrow(/https/);
  });

  it('rejects bad DATABASE_URL, RPC_URL scheme and confirmation bounds', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(ConfigError);
    expect(() => parseEnv({ ...base, RPC_URL: 'ftp://x.example.com' })).toThrow(ConfigError);
    expect(() => parseEnv({ ...base, CONFIRMATIONS: '0' })).toThrow(ConfigError);
    expect(() => parseEnv({ ...base, CONFIRMATIONS: '1001' })).toThrow(ConfigError);
  });

  it('treats empty strings as unset', () => {
    expect(parseEnv({ ...base, RPC_URL: '', CONFIRMATIONS: '' }).CONFIRMATIONS).toBe(12);
  });

  it('never leaks values (e.g. the DB password) into error messages', () => {
    try {
      parseEnv({ ...base, DATABASE_URL: 'mysql://u:supersecretpw@h/db', CHAIN_ID: '1' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain('supersecretpw');
    }
  });
});
