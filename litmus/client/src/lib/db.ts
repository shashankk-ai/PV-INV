import Dexie, { Table } from 'dexie';

export interface PendingScan {
  id?: number;
  idempotency_key: string;
  session_id: string;
  payload: Record<string, unknown>;
  photos: Array<{ blob: Blob; filename: string }>;
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
  created_at: number;
  error?: string;
}

export interface PendingPhoto {
  id?: number;
  idempotency_key: string;
  entry_id: string;
  session_id: string;
  blob: Blob;
  filename: string;
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
}

class LitmusDB extends Dexie {
  pending_scans!: Table<PendingScan, number>;
  pending_photos!: Table<PendingPhoto, number>;

  constructor() {
    super('litmus_offline');
    this.version(1).stores({
      pending_scans: '++id, idempotency_key, session_id, status, created_at',
      pending_photos: '++id, idempotency_key, entry_id, session_id, status',
    });
  }
}

export const db = new LitmusDB();
