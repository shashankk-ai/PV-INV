import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Minimal interface covering every Redis call in this codebase
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  ping(): Promise<unknown>;
}

// In-process fallback used when Redis is not available
class InMemoryCache implements CacheClient {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: null });
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1_000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) if (this.store.delete(k)) count++;
    return count;
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }
}

export let redis: CacheClient;

export async function connectRedis(): Promise<void> {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 3_000,
    // Return null instead of retrying on disconnect so we don't hang
    retryStrategy: () => null,
  });

  // Suppress unhandled error events after we fall back
  client.on('error', () => undefined);

  try {
    await client.connect();
    redis = client as unknown as CacheClient;
    logger.info('Redis connected');
  } catch {
    client.disconnect();
    redis = new InMemoryCache();
    logger.warn('Redis unavailable — using in-memory cache (data resets on restart)');
  }
}
