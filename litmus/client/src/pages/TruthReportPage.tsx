import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../lib/axios';
import { ReconciliationRow, ReconciliationStatus } from '@litmus/shared';

interface Warehouse { id: string; name: string; location_code: string; }

interface ReportData {
  warehouse: Warehouse;
  date: string;
  rows: ReconciliationRow[];
  summary: { total: number; matching: number; short: number; excess: number; missing: number; accuracy_pct: number; total_system_qty: number; total_inventory_value: number; };
}

interface ScanEntry {
  id: string;
  item_name: string;
  item_key: string;
  rack_number: string;
  batch_number: string;
  units: number;
  packing_size: number;
  total_quantity: number;
  uom: string;
  packing_type: string;
  mfg_date: string | null;
  expiry_date: string | null;
  scanned_by: string;
  scanned_at: string;
  is_potential_duplicate: boolean;
}

interface UnlistedEntry {
  id: string;
  item_name: string;
  description: string | null;
  units: number;
  packing_size: number;
  quantity: number;
  uom: string;
  packing_type: string;
  notes: string | null;
  recorded_by: string;
  created_at: string;
}

interface ItemScans {
  item_key: string;
  item_name: string;
  total_pv_count: number;
  scans: ScanEntry[];
}

const STATUS_STYLES: Record<ReconciliationStatus, string> = {
  matching: 'bg-green-100 text-green-700',
  short:    'bg-red-100 text-red-700',
  excess:   'bg-blue-100 text-blue-700',
  missing:  'bg-gray-100 text-gray-600',
};
const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  matching: 'Match ✓',
  short:    'Short ↓',
  excess:   'Excess ↑',
  missing:  'Missing —',
};
const ROW_BG: Record<ReconciliationStatus, string> = {
  matching: 'hover:bg-green-50/40',
  short:    'bg-red-50/60 hover:bg-red-50',
  excess:   'bg-blue-50/60 hover:bg-blue-50',
  missing:  'bg-gray-50 hover:bg-gray-100/60',
};
const COLS = 'grid grid-cols-[1fr_56px_64px_76px_80px]';

type View = 'reco' | 'pv' | 'unlisted';

export default function TruthReportPage() {
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const navigate = useNavigate();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<View>('reco');
  const [filter, setFilter] = useState<ReconciliationStatus | 'all'>('all');
  const [recoSearch, setRecoSearch] = useState('');
  const [pvSearch, setPvSearch] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ReconciliationRow | null>(null);

  // --- Queries ---
  const { data, isLoading: recoLoading, refetch } = useQuery({
    queryKey: ['truth-report', warehouseId, date],
    queryFn: () =>
      api.get<{ data: ReportData }>(`/reconciliation/${warehouseId}?date=${date}`).then((r) => r.data.data),
    enabled: !!warehouseId,
  });

  const { data: allScans, isLoading: pvLoading } = useQuery({
    queryKey: ['all-scans', warehouseId, date],
    queryFn: () =>
      api.get<{ data: ScanEntry[] }>(`/reconciliation/${warehouseId}/scans?date=${date}`).then((r) => r.data.data),
    enabled: !!warehouseId && view === 'pv',
  });

  const { data: unlistedItems, isLoading: unlistedLoading } = useQuery({
    queryKey: ['unlisted-items', warehouseId, date],
    queryFn: () =>
      api.get<{ data: UnlistedEntry[] }>(`/unlisted-items?warehouse_id=${warehouseId}&date=${date}`).then((r) => r.data.data),
    enabled: !!warehouseId && view === 'unlisted',
  });

  const { data: itemScans, isLoading: scansLoading } = useQuery({
    queryKey: ['item-scans', warehouseId, selectedItem?.item_key, date],
    queryFn: () =>
      api.get<{ data: ItemScans }>(
        `/reconciliation/${warehouseId}/items/${encodeURIComponent(selectedItem!.item_key)}/scans?date=${date}`
      ).then((r) => r.data.data),
    enabled: !!selectedItem && !!warehouseId,
  });

  // --- Derived data ---
  const recoRows = (data?.rows ?? []).filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (recoSearch) {
      const q = recoSearch.toLowerCase();
      return r.item_name.toLowerCase().includes(q) || r.item_key.toLowerCase().includes(q);
    }
    return true;
  });

  // Group PV scans by rack, filtered by search
  const rackGroups = useMemo(() => {
    if (!allScans) return [];
    const filtered = pvSearch
      ? allScans.filter((s) =>
          s.item_name.toLowerCase().includes(pvSearch.toLowerCase()) ||
          s.rack_number.toLowerCase().includes(pvSearch.toLowerCase()) ||
          s.item_key.toLowerCase().includes(pvSearch.toLowerCase())
        )
      : allScans;

    const map = new Map<string, ScanEntry[]>();
    for (const scan of filtered) {
      const rack = scan.rack_number || '—';
      if (!map.has(rack)) map.set(rack, []);
      map.get(rack)!.push(scan);
    }
    // Sort racks naturally
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allScans, pvSearch]);

  // --- Export handlers ---
  const handleRecoCsvExport = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/reconciliation/${warehouseId}/export/csv?date=${date}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `litmus-reco-${data?.warehouse.location_code ?? 'wh'}-${date}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
    finally { setDownloading(false); }
  };

  const handlePvCsvExport = async () => {
    try {
      const res = await api.get(`/reconciliation/${warehouseId}/scans/export/csv?date=${date}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `litmus-pv-${data?.warehouse.location_code ?? 'wh'}-${date}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const handleUnlistedCsvExport = async () => {
    try {
      const res = await api.get(`/unlisted-items/export/csv?warehouse_id=${warehouseId}&date=${date}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `litmus-unlisted-${data?.warehouse.location_code ?? 'wh'}-${date}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col print:bg-white">

      {/* ── Header ── */}
      <header className="bg-[#4B3B8C] text-white px-4 py-4 flex items-center gap-3 sticky top-0 z-20 print:hidden">
        <button onClick={() => navigate('/admin')} className="text-white opacity-70 hover:opacity-100">
          <BackIcon />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium opacity-70 leading-tight">Truth Report</p>
          <p className="font-bold text-base leading-tight truncate">{data?.warehouse.name ?? 'Loading…'}</p>
        </div>
        {/* View-specific actions */}
        {view === 'reco' && (
          <div className="flex items-center gap-2">
            <button onClick={handleRecoCsvExport} disabled={downloading || !data}
              className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50">
              {downloading ? '…' : 'CSV'}
            </button>
            <button onClick={() => window.print()} disabled={!data}
              className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50">
              Print
            </button>
          </div>
        )}
        {view === 'pv' && (
          <button onClick={handlePvCsvExport} disabled={!allScans?.length}
            className="text-xs bg-teal-500 hover:bg-teal-400 px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50">
            Export CSV
          </button>
        )}
        {view === 'unlisted' && (
          <button onClick={handleUnlistedCsvExport} disabled={!unlistedItems?.length}
            className="text-xs bg-amber-400 hover:bg-amber-300 px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50">
            Export CSV
          </button>
        )}
      </header>

      {/* ── Print header ── */}
      <div className="hidden print:block px-6 py-4 border-b border-gray-200 mb-4">
        <p className="text-2xl font-bold text-navy">LITMUS Truth Report</p>
        <p className="text-gray-600 mt-1">{data?.warehouse.name} · {date}</p>
        <p className="text-xs text-gray-400 mt-0.5">Generated {new Date().toLocaleString()}</p>
      </div>

      {/* ── Tab bar ── */}
      <div className="bg-white border-b border-gray-200 flex print:hidden sticky top-[64px] z-10 shadow-sm">
        {([
          { key: 'reco',     label: 'Reco Data',       accent: 'border-[#4B3B8C] text-[#4B3B8C]' },
          { key: 'pv',       label: 'PV Data',         accent: 'border-teal-500 text-teal-600' },
          { key: 'unlisted', label: 'Unlisted Items',  accent: 'border-amber-500 text-amber-600' },
        ] as { key: View; label: string; accent: string }[]).map(({ key, label, accent }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-colors
              ${view === key ? accent : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Shared date bar ── */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center gap-2 print:hidden">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input-field flex-1 text-sm py-1.5"
        />
        <button onClick={() => refetch()} className="btn-outline text-sm px-3 py-1.5">
          <RefreshIcon className="w-4 h-4" />
        </button>
      </div>

      {/* ══════════════════════════════════════
          VIEW: RECO DATA
      ══════════════════════════════════════ */}
      {view === 'reco' && (
        <div className="px-4 py-4 max-w-2xl mx-auto w-full space-y-4 print:max-w-full print:px-6">
          {/* Search */}
          <div className="relative print:hidden">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search product name or code…"
              value={recoSearch}
              onChange={(e) => setRecoSearch(e.target.value)}
              className="input-field pl-9 text-sm"
            />
            {recoSearch && (
              <button onClick={() => setRecoSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <XIcon />
              </button>
            )}
          </div>

          {recoLoading ? (
            <div className="space-y-2">{[1,2,3,4].map((i) => <div key={i} className="card p-4 animate-pulse h-16 bg-gray-100" />)}</div>
          ) : data ? (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-teal-50 border border-teal-100 px-3 py-2.5 text-center">
                  <p className="text-lg font-bold text-teal-700 leading-tight">{data.summary.total_system_qty.toLocaleString('en-IN')}</p>
                  <p className="text-xs font-medium text-teal-600 opacity-80 mt-0.5">Total System Qty</p>
                </div>
                <div className="rounded-xl bg-green-50 border border-green-100 px-3 py-2.5 text-center">
                  <p className="text-lg font-bold text-green-700 leading-tight">
                    {data.summary.total_inventory_value > 0
                      ? `₹${(data.summary.total_inventory_value / 1_00_000).toFixed(1)}L`
                      : '—'}
                  </p>
                  <p className="text-xs font-medium text-green-600 opacity-80 mt-0.5">Inventory Value</p>
                </div>
              </div>

              {/* Summary pills */}
              <div className="grid grid-cols-3 gap-2 print:grid-cols-5">
                <SummaryPill label="Accuracy" value={`${data.summary.accuracy_pct}%`} color="purple" />
                <SummaryPill label="Matching" value={data.summary.matching} color="green" />
                <SummaryPill label="Short" value={data.summary.short} color="red" />
                <SummaryPill label="Excess" value={data.summary.excess} color="blue" />
                <SummaryPill label="Missing" value={data.summary.missing} color="gray" />
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 overflow-x-auto pb-1 print:hidden">
                {(['all', 'short', 'missing', 'excess', 'matching'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors
                      ${filter === f ? 'bg-[#4B3B8C] text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
                    {f === 'all' ? `All (${data.summary.total})` : STATUS_LABELS[f as ReconciliationStatus]}
                  </button>
                ))}
              </div>

              {recoRows.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  {recoSearch ? `No items match "${recoSearch}"` : 'No items match this filter.'}
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden border border-gray-200 print:border-gray-300">
                  <div className={`${COLS} gap-x-2 bg-gray-100 print:bg-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-500`}>
                    <span>Item</span>
                    <span className="text-right">System</span>
                    <span className="text-right">PV Count</span>
                    <span className="text-right">Difference</span>
                    <span className="text-center">Status</span>
                  </div>
                  {recoRows.map((row, i) => (
                    <button key={row.item_key} type="button" onClick={() => setSelectedItem(row)}
                      className={`${COLS} gap-x-2 px-3 py-3 text-sm w-full text-left transition-colors cursor-pointer
                        ${ROW_BG[row.status]}
                        ${i < recoRows.length - 1 ? 'border-b border-gray-100 print:border-gray-200' : ''}`}>
                      <div className="min-w-0">
                        <p className="font-medium text-navy text-xs leading-tight truncate">{row.item_name}</p>
                        <p className="text-gray-400 text-xs font-mono">{row.item_key}</p>
                      </div>
                      <span className="text-right text-xs font-mono text-gray-600 self-center">{row.system_quantity}</span>
                      <span className="text-right text-xs font-mono font-semibold text-navy self-center">{row.litmus_quantity}</span>
                      <span className={`text-right text-xs font-mono font-bold self-center
                        ${row.variance > 0 ? 'text-blue-600' : row.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {row.variance > 0 ? `+${row.variance}` : row.variance}
                      </span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full text-center self-center whitespace-nowrap mx-auto ${STATUS_STYLES[row.status]}`}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">Failed to load report.</div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════
          VIEW: PV DATA (by Rack)
      ══════════════════════════════════════ */}
      {view === 'pv' && (
        <div className="px-4 py-4 max-w-2xl mx-auto w-full space-y-4">
          {/* Search */}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search item or rack…"
              value={pvSearch}
              onChange={(e) => setPvSearch(e.target.value)}
              className="input-field pl-9 text-sm"
            />
            {pvSearch && (
              <button onClick={() => setPvSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <XIcon />
              </button>
            )}
          </div>

          {pvLoading ? (
            <div className="space-y-2">{[1,2,3,4,5].map((i) => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}</div>
          ) : !allScans?.length ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium">No scans recorded for {date}</p>
            </div>
          ) : rackGroups.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No scans match "{pvSearch}"</div>
          ) : (
            <>
              <p className="text-xs text-gray-400 font-medium">
                {rackGroups.length} rack{rackGroups.length !== 1 ? 's' : ''} · {allScans.length} entries · Total Qty:{' '}
                <strong className="text-navy">{allScans.reduce((s, e) => s + e.total_quantity, 0).toLocaleString('en-IN')}</strong>
              </p>

              <div className="space-y-4">
                {rackGroups.map(([rack, scans]) => (
                  <div key={rack}>
                    {/* Rack header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="bg-[#4B3B8C] text-white text-xs font-bold px-3 py-1 rounded-full">
                        Rack {rack}
                      </div>
                      <span className="text-xs text-gray-400">{scans.length} item{scans.length !== 1 ? 's' : ''}</span>
                      <div className="flex-1 border-t border-gray-200" />
                    </div>

                    {/* Scans in this rack */}
                    <div className="space-y-2">
                      {scans.map((scan) => (
                        <div key={scan.id} className={`bg-white rounded-xl px-4 py-3 border ${scan.is_potential_duplicate ? 'border-amber-300 bg-amber-50' : 'border-gray-100'}`}>
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex-1 min-w-0 pr-2">
                              <p className="font-semibold text-navy text-sm leading-tight truncate">{scan.item_name}</p>
                              <p className="text-xs text-gray-400 font-mono">{scan.item_key}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-bold text-teal-600 text-sm">{scan.total_quantity} <span className="font-normal text-xs text-gray-400">{scan.uom}</span></p>
                              {scan.is_potential_duplicate && <span className="text-xs text-amber-600 font-medium">⚠ Dup?</span>}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-500">
                            <span>Batch: <strong className="text-navy">{scan.batch_number}</strong></span>
                            <span>Units × Pack: {scan.units} × {scan.packing_size}</span>
                            <span>Type: {scan.packing_type}</span>
                            <span>By: {scan.scanned_by} · {new Date(scan.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {scan.mfg_date && <span>Mfg: {scan.mfg_date}</span>}
                            {scan.expiry_date && <span>Exp: {scan.expiry_date}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════
          VIEW: UNLISTED ITEMS
      ══════════════════════════════════════ */}
      {view === 'unlisted' && (
        <div className="px-4 py-4 max-w-2xl mx-auto w-full space-y-4">
          {unlistedLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}</div>
          ) : !unlistedItems?.length ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium">No unlisted items for {date}</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-400 font-medium">
                {unlistedItems.length} item{unlistedItems.length !== 1 ? 's' : ''} · Total Qty:{' '}
                <strong className="text-navy">{unlistedItems.reduce((s, e) => s + e.quantity, 0).toLocaleString('en-IN')}</strong>
              </p>
              <div className="space-y-2">
                {unlistedItems.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl px-4 py-3 border border-amber-200">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="font-semibold text-navy text-sm leading-tight">{item.item_name}</p>
                        {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-amber-600 text-sm">{item.quantity} <span className="font-normal text-xs text-gray-400">{item.uom}</span></p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-500">
                      <span>Units × Pack: {item.units} × {item.packing_size}</span>
                      <span>Type: {item.packing_type}</span>
                      {item.notes && <span className="col-span-2 italic text-gray-400">{item.notes}</span>}
                      <span className="col-span-2 text-gray-400">By {item.recorded_by} · {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Item drill-down sheet (Reco tab only) ── */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedItem(null)} />
          <div className="relative bg-white rounded-t-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="flex-1 min-w-0 pr-3">
                <p className="font-bold text-navy text-sm leading-tight truncate">{selectedItem.item_name}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{selectedItem.item_key}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>System: <strong className="text-navy">{selectedItem.system_quantity}</strong></span>
                  <span>PV Count: <strong className="text-navy">{selectedItem.litmus_quantity}</strong></span>
                  <span className={`font-bold ${selectedItem.variance < 0 ? 'text-red-600' : selectedItem.variance > 0 ? 'text-blue-600' : 'text-green-600'}`}>
                    Diff: {selectedItem.variance > 0 ? `+${selectedItem.variance}` : selectedItem.variance}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedItem(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <XIcon />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3">
              {scansLoading ? (
                <div className="space-y-2 py-4">{[1,2,3].map((i) => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}</div>
              ) : !itemScans?.scans.length ? (
                <div className="text-center py-10 text-gray-400 text-sm">No scans recorded for this item.</div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400 pb-1">{itemScans.scans.length} scan{itemScans.scans.length !== 1 ? 's' : ''} · Total PV Count: <strong>{itemScans.total_pv_count}</strong></p>
                  {itemScans.scans.map((scan, i) => (
                    <div key={scan.id} className="bg-gray-50 rounded-xl px-3 py-2.5 text-xs">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-navy">#{i + 1} · Rack {scan.rack_number}</span>
                        <span className="text-gray-400">{new Date(scan.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                        <span><span className="text-gray-400">Batch:</span> {scan.batch_number}</span>
                        <span><span className="text-gray-400">Qty:</span> <strong className="text-navy">{scan.total_quantity} {scan.uom}</strong></span>
                        <span><span className="text-gray-400">Units × Pack:</span> {scan.units} × {scan.packing_size}</span>
                        <span><span className="text-gray-400">Type:</span> {scan.packing_type}</span>
                        {scan.mfg_date && <span><span className="text-gray-400">Mfg:</span> {scan.mfg_date.slice(0, 10)}</span>}
                        {scan.expiry_date && <span><span className="text-gray-400">Exp:</span> {scan.expiry_date.slice(0, 10)}</span>}
                        <span className="col-span-2"><span className="text-gray-400">By:</span> {scan.scanned_by}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: number | string; color: string }) {
  const map: Record<string, string> = {
    purple: 'bg-purple-50 text-[#4B3B8C]',
    green:  'bg-green-50 text-green-700',
    red:    'bg-red-50 text-red-700',
    blue:   'bg-blue-50 text-blue-700',
    gray:   'bg-gray-100 text-gray-600',
  };
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${map[color]}`}>
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <polyline points="15 18 9 12 15 6" />
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
function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
