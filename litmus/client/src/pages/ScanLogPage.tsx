import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useSession } from '../contexts/SessionContext';
import { useSite } from '../contexts/SiteContext';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import RackScanPage from './RackScanPage';
import api from '../lib/axios';
import { PackingType } from '@litmus/shared';

interface Entry {
  id: string;
  rack_number: string;
  item_name: string;
  item_key: string;
  batch_number: string;
  units: number;
  packing_size: number;
  uom: string;
  packing_type: PackingType;
  total_quantity: number;
  mfg_date: string;
  expiry_date: string;
  is_potential_duplicate: boolean;
  user?: { username: string };
}

const BADGE_COLORS: Record<PackingType, string> = {
  drums:   'bg-blue-100 text-blue-700',
  bags:    'bg-green-100 text-green-700',
  bottles: 'bg-purple-100 text-purple-700',
  cans:    'bg-orange-100 text-orange-700',
  cartons: 'bg-yellow-100 text-yellow-700',
  pallets: 'bg-gray-100 text-gray-700',
  other:   'bg-pink-100 text-pink-700',
};

export default function ScanLogPage() {
  const { session, setScanCount } = useSession();
  const { site } = useSite();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['entries', session?.id],
    queryFn: () =>
      api.get<{ data: Entry[]; pagination: { total: number } }>(
        `/sessions/${session!.id}/entries?limit=100`
      ).then((r) => r.data),
    enabled: !!session,
    refetchInterval: 15000,
  });

  const entries = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/sessions/${session!.id}/entries/${id}`),
    onSuccess: () => {
      toast.success('Scan removed');
      setScanCount((n) => Math.max(0, n - 1));
      qc.invalidateQueries({ queryKey: ['entries', session?.id] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('Could not remove scan'),
  });

  if (!site) { navigate('/sites'); return null; }

  if (editEntry) {
    return (
      <RackScanPage
        editEntry={{
          id: editEntry.id,
          rack_number: editEntry.rack_number,
          item_name: editEntry.item_name,
          item_key: editEntry.item_key,
          batch_number: editEntry.batch_number,
          units: editEntry.units,
          packing_size: editEntry.packing_size,
          uom: editEntry.uom,
          packing_type: editEntry.packing_type,
          mfg_date: editEntry.mfg_date?.slice(0, 10),
          expiry_date: editEntry.expiry_date?.slice(0, 10),
        }}
        onSaved={() => {
          setEditEntry(null);
          qc.invalidateQueries({ queryKey: ['entries', session?.id] });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-16">
      {/* Header */}
      <header className="nav-bar sticky top-0 z-20">
        <div>
          <p className="font-semibold text-sm opacity-70 leading-tight">Scan Log</p>
          <p className="font-bold text-base leading-tight">{site.name}</p>
        </div>
        <span className="text-sm opacity-70">{entries.length} scans</span>
      </header>

      {/* Pull-to-refresh hint */}
      <button
        onClick={() => refetch()}
        className="mx-4 mt-3 text-xs text-teal flex items-center gap-1 self-start"
      >
        <RefreshIcon className="w-3.5 h-3.5" /> Refresh
      </button>

      {/* Content */}
      <div className="flex-1 px-4 py-3 max-w-lg mx-auto w-full">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((e) => (
              <li key={e.id}>
                <div
                  className={`card border-l-4 border-teal overflow-hidden
                    ${e.is_potential_duplicate ? 'border-amber-400' : ''}`}
                >
                  {e.is_potential_duplicate && (
                    <div className="bg-amber-50 px-3 py-1 text-xs text-amber-700 font-medium">
                      ⚠ Possible duplicate
                    </div>
                  )}
                  <button
                    onClick={() => setEditEntry(e)}
                    className="w-full text-left p-4 flex items-center justify-between active:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="font-mono font-bold text-navy text-sm">{e.rack_number}</p>
                      <p className="text-sm text-gray-600 truncate mt-0.5">{e.item_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Batch: {e.batch_number}
                        {e.user && <span className="ml-2">· {e.user.username}</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-teal font-bold text-base">
                        {e.total_quantity} <span className="text-xs font-normal">{e.uom}</span>
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_COLORS[e.packing_type]}`}>
                        {e.packing_type}
                      </span>
                    </div>
                  </button>

                  <div className="px-4 pb-3 flex justify-end">
                    <button
                      onClick={() => setDeleteTarget(e.id)}
                      className="p-2 text-gray-400 hover:text-red-600 active:scale-95 transition-all rounded-lg"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 flex flex-col gap-4 animate-slide-down">
            <h3 className="text-lg font-bold text-navy">Remove this scan?</h3>
            <p className="text-gray-500 text-sm">This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="btn-outline flex-1"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget)}
                disabled={deleteMutation.isPending}
                className="flex-1 btn-primary bg-red-600 hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <TestTubeIllustration />
      <p className="text-navy font-bold text-lg">No scans yet</p>
      <p className="text-gray-400 text-sm">Start with your first rack!</p>
    </div>
  );
}

function TestTubeIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="40" fill="#E6F5F3" />
      <rect x="33" y="15" width="14" height="32" rx="2" fill="#0D9488" opacity="0.3" />
      <ellipse cx="40" cy="51" rx="8" ry="9" fill="#0D9488" opacity="0.5" />
      <rect x="33" y="35" width="14" height="16" fill="#0D9488" opacity="0.2" />
      <rect x="30" y="12" width="20" height="6" rx="3" fill="#0D9488" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}
