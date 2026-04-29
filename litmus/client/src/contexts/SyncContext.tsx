import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import { useNetwork } from './NetworkContext';
import { syncPendingScans, getPendingCount, SyncProgress } from '../lib/syncEngine';
import { useSession } from './SessionContext';

interface SyncContextValue {
  pendingCount: number;
  syncProgress: SyncProgress | null;
  isSyncing: boolean;
  failedCount: number;
  triggerSync: () => void;
  refreshPendingCount: () => void;
}

const SyncContext = createContext<SyncContextValue>({
  pendingCount: 0,
  syncProgress: null,
  isSyncing: false,
  failedCount: 0,
  triggerSync: () => {},
  refreshPendingCount: () => {},
});

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useNetwork();
  const { setScanCount } = useSession();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const wasOfflineRef = useRef(false);
  const syncLockRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  const runSync = useCallback(async () => {
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setIsSyncing(true);
    setSyncProgress({ total: 0, done: 0, failed: 0, active: true });

    try {
      await syncPendingScans(
        (progress) => setSyncProgress(progress),
        (failed) => {
          setFailedCount(failed);
          setSyncProgress(null);
          setIsSyncing(false);
          syncLockRef.current = false;

          if (failed === 0) {
            toast.success('All scans synced ✓');
          }
          refreshPendingCount();
          // Bump scan count after sync
          getPendingCount().then((n) => {
            if (n === 0) setScanCount((prev) => prev);
          });
        }
      );
    } catch {
      setIsSyncing(false);
      setSyncProgress(null);
      syncLockRef.current = false;
    }
  }, [refreshPendingCount, setScanCount]);

  const triggerSync = useCallback(() => {
    if (isOnline && !isSyncing) runSync();
  }, [isOnline, isSyncing, runSync]);

  // Sync on reconnect
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      runSync();
    }
    if (!isOnline) wasOfflineRef.current = true;
  }, [isOnline, runSync]);

  // Poll pending count every 10s
  useEffect(() => {
    refreshPendingCount();
    const interval = setInterval(refreshPendingCount, 10_000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  return (
    <SyncContext.Provider
      value={{ pendingCount, syncProgress, isSyncing, failedCount, triggerSync, refreshPendingCount }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
