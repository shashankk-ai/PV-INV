import { db, PendingScan } from './db';
import api from './axios';

export type SyncProgress = {
  total: number;
  done: number;
  failed: number;
  active: boolean;
};

type ProgressCallback = (p: SyncProgress) => void;
type CompleteCallback = (failed: number) => void;

const MAX_ATTEMPTS = 5;

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function syncPendingScans(
  onProgress: ProgressCallback,
  onComplete: CompleteCallback
): Promise<void> {
  const pending = await db.pending_scans
    .where('status')
    .anyOf(['pending', 'failed'])
    .sortBy('created_at');

  if (pending.length === 0) {
    onComplete(0);
    return;
  }

  const total = pending.length;
  let done = 0;
  let failed = 0;

  onProgress({ total, done, failed, active: true });

  for (const scan of pending) {
    if (scan.id === undefined) continue;

    // Mark as syncing
    await db.pending_scans.update(scan.id, { status: 'syncing' });

    const success = await attemptSyncScan(scan);
    if (success) {
      await db.pending_scans.delete(scan.id);
      done++;
    } else {
      failed++;
      const attempts = (scan.attempts ?? 0) + 1;
      await db.pending_scans.update(scan.id, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
      });
    }

    onProgress({ total, done, failed, active: done + failed < total });
  }

  onComplete(failed);
}

async function attemptSyncScan(scan: PendingScan): Promise<boolean> {
  const attempts = scan.attempts ?? 0;

  for (let attempt = 0; attempt <= Math.min(attempts, 2); attempt++) {
    try {
      if (attempt > 0) await delay(Math.pow(2, attempt) * 1000);

      const res = await api.post<{ data: { id: string } }>(
        `/sessions/${scan.session_id}/entries`,
        { ...scan.payload, idempotency_key: scan.idempotency_key }
      );

      const entryId = res.data.data.id;

      // Upload photos for this scan
      for (const photo of scan.photos) {
        try {
          const form = new FormData();
          form.append('photo', photo.blob, photo.filename);
          form.append('entry_id', entryId);
          form.append('session_id', scan.session_id);
          await api.post('/photos/upload', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          // Photo failure is non-blocking
        }
      }

      return true;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // Don't retry client errors (4xx) except 429
      if (status && status >= 400 && status < 500 && status !== 429) return false;
    }
  }

  return false;
}

export async function saveScanOffline(
  sessionId: string,
  payload: Record<string, unknown>,
  photos: Array<{ blob: Blob; filename: string }>
): Promise<void> {
  await db.pending_scans.add({
    idempotency_key: crypto.randomUUID(),
    session_id: sessionId,
    payload,
    photos,
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
  });
}

export async function getPendingCount(): Promise<number> {
  return db.pending_scans.where('status').anyOf(['pending', 'syncing', 'failed']).count();
}
