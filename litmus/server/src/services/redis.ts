import Redis from 'ioredis';
import { logger } from '../utils/logger';

export let redis: Redis;

export async function connectRedis(): Promise<void> {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  redis.on('error', (err) => logger.warn({ err }, 'Redis error'));

  await redis.connect();
  logger.info('Redis connected');
}
