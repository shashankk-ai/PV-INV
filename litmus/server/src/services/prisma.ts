import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Connection pool is configured via DATABASE_URL connection_limit param
// Default Prisma pool = min(cpu_count*2+1, 10). We override to 20 via URL.
// Add ?connection_limit=20 to DATABASE_URL for production tuning.

export async function connectDB(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}
