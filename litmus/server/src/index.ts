import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import path from 'path';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import authRouter from './routes/auth';
import healthRouter from './routes/health';
import itemsRouter from './routes/items';
import sessionsRouter from './routes/sessions';
import entriesRouter from './routes/entries';
import unlistedRouter from './routes/unlisted';
import { connectDB } from './services/prisma';
import { connectRedis } from './services/redis';
import { dataSyncService } from './services/DataSyncService';
import { logger } from './utils/logger';
import { ApiResponse } from '@litmus/shared';

(globalThis as Record<string, unknown>).__litmus_start = Date.now();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(requestIdMiddleware);

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api', itemsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions/:sessionId/entries', entriesRouter);
app.use('/api/unlisted-items', unlistedRouter);

// Serve client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// 404
app.use((_req, res) => {
  const body: ApiResponse = {
    data: null,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    meta: { requestId: res.locals.requestId ?? '', timestamp: new Date().toISOString() },
  };
  res.status(404).json(body);
});

app.use(errorHandler);

async function start() {
  try {
    await connectDB();
    await connectRedis();
    // Initial sync on startup (non-blocking)
    dataSyncService.syncAll().then(() => dataSyncService.startCron()).catch((e) =>
      logger.warn(e, 'Initial sync failed — cache may be stale')
    );
    app.listen(PORT, () => logger.info(`LITMUS server running on http://localhost:${PORT}`));
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

start();

export { app };
