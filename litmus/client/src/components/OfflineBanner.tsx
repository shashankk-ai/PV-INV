import { useNetwork } from '../contexts/NetworkContext';
import { useSync } from '../contexts/SyncContext';

export default function OfflineBanner() {
  const { isOnline } = useNetwork();
  const { pendingCount, syncProgress, isSyncing, failedCount, triggerSync } = useSync();

  if (isOnline && !isSyncing && failedCount === 0) return null;

  // Syncing progress bar
  if (isSyncing && syncProgress) {
    const pct = syncProgress.total > 0
      ? Math.round((syncProgress.done / syncProgress.total) * 100)
      : 0;
    return (
      <div className="bg-teal-50 border-b border-teal px-4 py-2 animate-slide-down">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-teal font-medium">
            Syncing scans... {syncProgress.done}/{syncProgress.total}
          </span>
        </div>
        <div className="h-1.5 bg-teal-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // Permanent failures
  if (isOnline && failedCount > 0) {
    return (
      <div className="bg-amber-50 border-b-2 border-amber-400 px-4 py-2 flex items-center gap-3">
        <WarningIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-sm text-amber-800 flex-1">
          {failedCount} scan{failedCount !== 1 ? 's' : ''} couldn't sync.
        </span>
        <button
          onClick={triggerSync}
          className="text-sm font-semibold text-amber-700 underline flex-shrink-0"
        >
          Retry
        </button>
      </div>
    );
  }

  // Offline mode
  if (!isOnline) {
    return (
      <div className="bg-amber-50 border-b-2 border-amber-400 px-4 py-2 flex items-center gap-2 animate-slide-down">
        <WifiOffIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-sm text-amber-800 font-medium">
          Offline mode — scans saved locally
          {pendingCount > 0 && (
            <span className="ml-1 text-amber-600">({pendingCount} pending)</span>
          )}
        </span>
      </div>
    );
  }

  return null;
}

function WifiOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
      <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0122.56 9" />
      <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
      <path d="M8.53 16.11a6 6 0 016.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth={3} />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth={3} />
    </svg>
  );
}
