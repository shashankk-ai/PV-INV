import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import toast from 'react-hot-toast';

interface ColumnMap {
  item_key:      string | null;
  item_name:     string | null;
  location_code: string | null;
  warehouse:     string | null;
  quantity:      string | null;
  uom:           string | null;
  cas_number:    string | null;
  uom_options:   string | null;
}

interface PreviewResult {
  headers: string[];
  detected: ColumnMap;
  confidence: number;
  warnings: string[];
  sample: Record<string, unknown>[];
  total_rows: number;
}

interface DataUpload {
  id: string;
  filename: string;
  row_count: number;
  column_map: ColumnMap;
  uploaded_at: string;
  uploader: { id: string; username: string };
}

interface Warehouse {
  id: string;
  name: string;
  location_code: string;
}

const FIELD_LABELS: Record<keyof ColumnMap, string> = {
  item_key:      'Item Key / SKU',
  item_name:     'Item Name',
  location_code: 'Location Code',
  warehouse:     'Warehouse',
  quantity:      'Quantity',
  uom:           'Unit of Measure',
  cas_number:    'CAS Number',
  uom_options:   'UOM Options',
};

const REQUIRED_FIELDS: (keyof ColumnMap)[] = ['item_key', 'item_name'];

export default function DataUploadPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [step, setStep] = useState<'pick' | 'map' | 'done'>('pick');

  const { data: uploads = [], isLoading: uploadsLoading } = useQuery({
    queryKey: ['data-uploads'],
    queryFn: () => api.get<{ data: DataUpload[] }>('/admin/data-uploads').then((r) => r.data.data),
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<{ data: Warehouse[] }>('/warehouses').then((r) => r.data.data),
  });

  const previewMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post<{ data: PreviewResult }>('/admin/data-uploads/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      const data = res.data.data;
      setPreview(data);
      setColumnMap(data.detected);
      setStep('map');
    },
    onError: () => toast.error('Could not read file — check it is a valid XLSX or CSV'),
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!selectedFile || !columnMap) throw new Error('nothing to commit');
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('column_map', JSON.stringify(columnMap));
      if (warehouseId) fd.append('warehouse_id', warehouseId);
      return api.post('/admin/data-uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      const { rows_parsed, records_upserted } = (res.data as { data: { rows_parsed: number; records_upserted: number } }).data;
      toast.success(`Uploaded: ${rows_parsed} rows → ${records_upserted} inventory records updated`);
      qc.invalidateQueries({ queryKey: ['data-uploads'] });
      setStep('done');
      setSelectedFile(null);
      setPreview(null);
      setColumnMap(null);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Upload failed';
      toast.error(msg);
    },
  });

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setStep('pick');
    setPreview(null);
    setColumnMap(null);
    previewMutation.mutate(file);
  }, [previewMutation]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const canCommit = columnMap && REQUIRED_FIELDS.every((f) => columnMap[f]);

  return (
    <div className="space-y-5">

      {/* Upload Zone */}
      {step !== 'map' && (
        <section>
          <h2 className="text-sm font-semibold text-navy mb-2">Upload Inventory File</h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors
              ${dragging ? 'border-teal bg-teal-50' : 'border-gray-300 hover:border-teal hover:bg-gray-50'}`}
          >
            <UploadIcon className="w-10 h-10 text-gray-400" />
            <div className="text-center">
              <p className="text-sm font-semibold text-navy">Drop file here or tap to browse</p>
              <p className="text-xs text-gray-400 mt-1">XLSX, XLS or CSV · max 20 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {previewMutation.isPending && (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
              <div className="h-4 w-4 border-2 border-teal border-t-transparent rounded-full animate-spin" />
              Reading file…
            </div>
          )}
        </section>
      )}

      {/* Column Mapping */}
      {step === 'map' && preview && columnMap && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => { setStep('pick'); setPreview(null); }}
              className="text-gray-400 hover:text-navy"
            >
              <ChevronLeftIcon />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-navy">{selectedFile?.name}</h2>
              <p className="text-xs text-gray-400">{preview.total_rows} rows detected</p>
            </div>
          </div>

          {/* Confidence badge */}
          <div className={`text-xs font-medium px-3 py-2 rounded-xl mb-3 flex items-center gap-2
            ${preview.confidence >= 1 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            <span>{preview.confidence >= 1 ? '✓ All required columns detected' : `⚠ ${preview.warnings.join(' · ')}`}</span>
          </div>

          {/* Column mapping selectors */}
          <div className="card p-4 space-y-3 mb-3">
            <p className="text-xs font-semibold text-navy uppercase tracking-wide mb-1">Column Mapping</p>
            {(Object.keys(FIELD_LABELS) as (keyof ColumnMap)[]).map((field) => (
              <div key={field} className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-600 w-28 flex-shrink-0">
                  {FIELD_LABELS[field]}
                  {REQUIRED_FIELDS.includes(field) && <span className="text-red-500 ml-0.5">*</span>}
                </span>
                <select
                  value={columnMap[field] ?? ''}
                  onChange={(e) => setColumnMap({ ...columnMap, [field]: e.target.value || null })}
                  className={`input-field text-xs py-1.5 flex-1 min-w-0 ${
                    REQUIRED_FIELDS.includes(field) && !columnMap[field] ? 'border-red-400 ring-1 ring-red-400' : ''
                  }`}
                >
                  <option value="">— not mapped —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Warehouse override */}
          <div className="card p-4 mb-3">
            <p className="text-xs font-semibold text-navy mb-2">Warehouse Override</p>
            <p className="text-xs text-gray-500 mb-2">
              If your file has no warehouse column, or you want to apply all rows to one warehouse, select it here.
              Leave blank to use the warehouse column from the file (applying rows to all warehouses if missing).
            </p>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="input-field text-xs py-1.5"
            >
              <option value="">Use file column / apply to all</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.location_code})</option>
              ))}
            </select>
          </div>

          {/* Sample preview */}
          {preview.sample.length > 0 && columnMap.item_key && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-navy mb-1">Sample (first 5 rows)</p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {[columnMap.item_key, columnMap.item_name, columnMap.quantity, columnMap.uom]
                        .filter(Boolean).map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {[columnMap.item_key!, columnMap.item_name!, columnMap.quantity, columnMap.uom]
                          .filter((h): h is string => h !== null).map((h) => (
                          <td key={h} className="px-3 py-2 text-navy truncate max-w-[120px]">
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setStep('pick'); setPreview(null); }} className="btn-outline flex-1">
              Cancel
            </button>
            <button
              onClick={() => commitMutation.mutate()}
              disabled={!canCommit || commitMutation.isPending}
              className="flex-1 btn-primary bg-[#4B3B8C] hover:bg-[#3a2d6e] disabled:opacity-50"
            >
              {commitMutation.isPending ? 'Uploading…' : 'Confirm & Upload'}
            </button>
          </div>
        </section>
      )}

      {/* Upload History */}
      <section>
        <h2 className="text-sm font-semibold text-navy mb-2">Upload History</h2>
        {uploadsLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2].map((i) => <div key={i} className="card p-4 animate-pulse h-14 bg-gray-100" />)}
          </div>
        ) : uploads.length === 0 ? (
          <div className="card p-6 flex flex-col items-center gap-2 text-center">
            <FileIcon className="w-8 h-8 text-gray-300" />
            <p className="text-sm text-gray-400">No uploads yet</p>
            <p className="text-xs text-gray-400">Upload a file above to set the inventory baseline</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {uploads.map((u, idx) => (
              <div key={u.id} className={`card p-4 flex items-start justify-between gap-3 ${idx === 0 ? 'border-l-4 border-teal' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-navy truncate">{u.filename}</p>
                    {idx === 0 && (
                      <span className="text-xs bg-teal-50 text-teal font-medium px-2 py-0.5 rounded-full flex-shrink-0">Active</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {u.row_count} rows · uploaded by <span className="font-medium">{u.uploader.username}</span> · {formatDateTime(u.uploaded_at)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(Object.entries(u.column_map) as [keyof ColumnMap, string | null][])
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <span key={k} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {FIELD_LABELS[k]}: <span className="font-mono">{v}</span>
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
