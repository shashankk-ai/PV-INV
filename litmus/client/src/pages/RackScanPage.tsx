import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useSite } from '../contexts/SiteContext';
import { useSession } from '../contexts/SessionContext';
import { useAuth } from '../contexts/AuthContext';
import BottomNav from '../components/BottomNav';
import ItemCombobox from '../components/ui/ItemCombobox';
import Stepper from '../components/ui/Stepper';
import PackingTypeSelector from '../components/ui/PackingTypeSelector';
import PhotoStrip, { PhotoItem } from '../components/PhotoStrip';
import OcrSuggestion from '../components/OcrSuggestion';
import OfflineBanner from '../components/OfflineBanner';
import api from '../lib/axios';
import { saveScanOffline } from '../lib/syncEngine';
import { useNetwork } from '../contexts/NetworkContext';
import { useSync } from '../contexts/SyncContext';

const PACKING_TYPES = ['drums', 'bags', 'bottles', 'cans', 'cartons', 'pallets', 'other'] as const;
const DRAFT_KEY = 'litmus_scan_draft';

const schema = z
  .object({
    rack_number:  z.string().min(1, 'Rack number is required'),
    item_name:    z.string().min(1, 'Item name is required'),
    item_key:     z.string().min(1, 'Select an item from the list'),
    batch_number: z.string().min(3, 'Min 3 characters'),
    units:        z.number().int().min(1, 'Must be ≥ 1'),
    packing_size: z.number().int().min(1, 'Must be ≥ 1'),
    uom:          z.string().min(1, 'UOM is required'),
    packing_type: z.enum(PACKING_TYPES, { errorMap: () => ({ message: 'Select a packing type' }) }),
    mfg_date:     z.string().min(1, 'Manufacturing date required'),
    expiry_date:  z.string().min(1, 'Expiry date required'),
  })
  .refine((d) => !d.expiry_date || !d.mfg_date || new Date(d.expiry_date) > new Date(d.mfg_date), {
    message: 'Expiry must be after manufacture date',
    path: ['expiry_date'],
  });

type FormData = z.infer<typeof schema>;

interface Props {
  editEntry?: { id: string } & Partial<FormData>;
  onSaved?: () => void;
}

export default function RackScanPage({ editEntry, onSaved }: Props) {
  const { site } = useSite();
  const { session, setSession, scanCount, setScanCount } = useSession();
  const { logout } = useAuth();
  const { isOnline } = useNetwork();
  const { refreshPendingCount } = useSync();
  const navigate = useNavigate();
  const [uomOptions, setUomOptions] = useState<string[]>(() => {
    if (editEntry) return [];
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) {
        const d = JSON.parse(draft) as Partial<FormData>;
        return d.uom ? [d.uom] : [];
      }
    } catch { /* ignore */ }
    return [];
  });
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [ocrText, setOcrText] = useState<string | null>(null);

  const defaultValues = useMemo(() => {
    if (editEntry) return { ...editEntry, units: editEntry.units ?? 1, packing_size: editEntry.packing_size ?? 1 };
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft) as Partial<FormData>;
    } catch { /* ignore */ }
    return { units: 1, packing_size: 1, packing_type: undefined };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const formValues = watch();
  const units = formValues.units ?? 1;
  const packingSize = formValues.packing_size ?? 1;
  const totalQty = units * packingSize;

  // Persist draft so camera / page-reload doesn't wipe filled fields
  useEffect(() => {
    if (!editEntry) {
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(formValues)); } catch { /* ignore */ }
    }
  }, [formValues, editEntry]);

  useEffect(() => { if (!site) navigate('/sites'); }, [site, navigate]);

  useEffect(() => {
    if (site && !session) {
      api.post('/sessions', { warehouse_id: site.id })
        .then((r) => setSession(r.data.data as Parameters<typeof setSession>[0]))
        .catch(() => {});
    }
  }, [site, session, setSession]);

  const handleItemSelect = (chem: { item_key: string; uom_options: string[] }) => {
    setValue('item_key', chem.item_key, { shouldValidate: true });
    setUomOptions(chem.uom_options);
    if (chem.uom_options.length > 0) setValue('uom', chem.uom_options[0]);
  };

  const runOcr = async (blob: Blob) => {
    try {
      const form = new FormData();
      form.append('image', blob, 'capture.jpg');
      const res = await api.post<{ data: { detected_text: string | null; confidence: number; enabled: boolean } }>(
        '/ocr/detect', form, { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      const { detected_text, confidence, enabled } = res.data.data;
      if (enabled && detected_text && confidence > 0.5) setOcrText(detected_text);
    } catch {
      // silent
    }
  };

  const handlePhotoAdd = (photo: PhotoItem) => {
    setPhotos((prev) => [...prev, photo]);
    // Attempt OCR on new photo
    runOcr(photo.blob);
  };

  const handlePhotoRemove = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadPhotos = async (entryId: string, sessionId: string) => {
    for (const photo of photos) {
      if (photo.uploaded) continue;
      const form = new FormData();
      form.append('photo', photo.blob, 'photo.jpg');
      form.append('entry_id', entryId);
      form.append('session_id', sessionId);
      try {
        await api.post('/photos/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        photo.uploaded = true;
      } catch {
        // Non-blocking — entry is saved even if photo upload fails
      }
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!session) { toast.error('No active session. Please select a site again.'); return; }

    // Offline path
    if (!isOnline) {
      await saveScanOffline(
        session.id,
        data as unknown as Record<string, unknown>,
        photos.map((p, i) => ({ blob: p.blob, filename: `photo_${i}.jpg` }))
      );
      toast.success('Scan saved locally ✓', { icon: '📲' });
      setScanCount((n) => n + 1);
      refreshPendingCount();
      sessionStorage.removeItem(DRAFT_KEY);
      reset({ units: 1, packing_size: 1, packing_type: undefined });
      setUomOptions([]);
      setPhotos([]);
      setOcrText(null);
      return;
    }

    const idempotencyKey = editEntry?.id ? undefined : generateUUID();
    try {
      if (editEntry?.id) {
        await api.put(`/sessions/${session.id}/entries/${editEntry.id}`, data);
        if (photos.length > 0) await uploadPhotos(editEntry.id, session.id);
        toast.success('Scan updated ✓');
        onSaved?.();
      } else {
        const res = await api.post<{ data: { id: string } }>(
          `/sessions/${session.id}/entries`,
          { ...data, idempotency_key: idempotencyKey }
        );
        const entryId = res.data.data.id;
        if (photos.length > 0) await uploadPhotos(entryId, session.id);
        toast.success('Scan logged ✓');
        setScanCount((n) => n + 1);
        sessionStorage.removeItem(DRAFT_KEY);
        reset({ units: 1, packing_size: 1, packing_type: undefined });
        setUomOptions([]);
        setPhotos([]);
        setOcrText(null);
      }
    } catch (err: unknown) {
      // Network error — fall back to offline storage
      const isNetworkError = !(err as { response?: unknown })?.response;
      if (isNetworkError && !editEntry?.id) {
        await saveScanOffline(
          session.id,
          data as unknown as Record<string, unknown>,
          photos.map((p, i) => ({ blob: p.blob, filename: `photo_${i}.jpg` }))
        );
        toast.success('Connection lost — scan saved locally ✓', { icon: '📲' });
        setScanCount((n) => n + 1);
        refreshPendingCount();
        sessionStorage.removeItem(DRAFT_KEY);
        reset({ units: 1, packing_size: 1, packing_type: undefined });
        setUomOptions([]);
        setPhotos([]);
        setOcrText(null);
        return;
      }
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Failed to save. Try again.';
      toast.error(msg);
    }
  };

  if (!site) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-20">
      {/* Header */}
      <header className="nav-bar sticky top-0 z-20">
        <div>
          <p className="font-semibold text-sm leading-tight text-white opacity-70">Rack Scan</p>
          <p className="font-bold text-base leading-tight">{site.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Unlisted Item shortcut — prominent in header */}
          <button
            type="button"
            onClick={() => navigate('/unknown')}
            className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-white
                       text-xs font-bold px-3 py-1.5 rounded-full shadow-md shadow-amber-500/30
                       active:scale-95 transition-all duration-150"
          >
            <span className="text-sm leading-none">?</span>
            <span>Unlisted Item</span>
          </button>
          {scanCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-teal-500 border-2 border-white flex items-center justify-center text-xs font-bold text-white">
              {scanCount > 99 ? '99+' : scanCount}
            </div>
          )}
          <button onClick={logout} className="text-white opacity-70 hover:opacity-100 text-sm">
            Out
          </button>
        </div>
      </header>

      <OfflineBanner />

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit, () => toast.error('Please fill all required fields'))} className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-5">
        {/* Rack Number */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Rack Number</label>
          <input
            {...register('rack_number')}
            type="text"
            placeholder="e.g. AB-001"
            className={`input-field ${errors.rack_number ? 'border-red-400 ring-1 ring-red-400' : ''}`}
          />
          {errors.rack_number && <p className="mt-1 text-sm text-red-700">{errors.rack_number.message}</p>}
        </div>

        {/* Item Name */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Item Name</label>
          <Controller
            name="item_name"
            control={control}
            render={({ field }) => (
              <ItemCombobox
                value={field.value ?? ''}
                onChange={(name) => {
                  field.onChange(name);
                  // Mirror typed name → item_key so form is always submittable.
                  // onSelect() will overwrite this with the real key when user picks from dropdown.
                  setValue('item_key', name, { shouldValidate: false });
                }}
                onSelect={(chem) => { field.onChange(chem.item_name); handleItemSelect(chem); }}
                error={errors.item_name?.message ?? errors.item_key?.message}
                placeholder="Search chemical name..."
              />
            )}
          />
          {/* OCR Suggestion */}
          {ocrText && (
            <div className="mt-2">
              <OcrSuggestion
                detectedText={ocrText}
                onAccept={(text) => { setValue('item_name', text, { shouldValidate: true }); setOcrText(null); }}
                onDismiss={() => setOcrText(null)}
              />
            </div>
          )}
        </div>

        {/* Item Key */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Item Key <span className="text-xs font-normal text-gray-400">(auto-filled)</span></label>
          <input
            {...register('item_key')}
            type="text"
            className="input-field font-mono text-gray-600 bg-gray-50"
            placeholder="Auto-filled on item selection"
          />
        </div>

        {/* Batch Number */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Batch Number</label>
          <input
            {...register('batch_number')}
            type="text"
            placeholder="e.g. BATCH-2025-001"
            className={`input-field ${errors.batch_number ? 'border-red-400 ring-1 ring-red-400' : ''}`}
          />
          {errors.batch_number && <p className="mt-1 text-sm text-red-700">{errors.batch_number.message}</p>}
        </div>

        {/* Units + Packing Size */}
        <div className="grid grid-cols-2 gap-4">
          <Controller name="units" control={control} render={({ field }) => (
            <Stepper label="Units" value={field.value ?? 1} onChange={field.onChange} error={errors.units?.message} />
          )} />
          <Controller name="packing_size" control={control} render={({ field }) => (
            <Stepper label="Pack Size" value={field.value ?? 1} onChange={field.onChange} error={errors.packing_size?.message} />
          )} />
        </div>

        {/* UOM */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">UOM</label>
          {uomOptions.length > 0 ? (
            <select {...register('uom')} className={`input-field ${errors.uom ? 'border-red-400' : ''}`}>
              {uomOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          ) : (
            <input
              {...register('uom')}
              type="text"
              placeholder="e.g. L, KG"
              className={`input-field ${errors.uom ? 'border-red-400 ring-1 ring-red-400' : ''}`}
            />
          )}
          {errors.uom && <p className="mt-1 text-sm text-red-700">{errors.uom.message}</p>}
        </div>

        {/* Packing Type */}
        <div>
          <label className="block text-sm font-medium text-navy mb-2">Packing Type</label>
          <Controller name="packing_type" control={control} render={({ field }) => (
            <PackingTypeSelector value={field.value ?? ''} onChange={field.onChange} error={errors.packing_type?.message} />
          )} />
        </div>

        {/* Total Quantity */}
        <div className="bg-teal-50 border border-teal rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-teal font-medium">Total Quantity</span>
          <span className="text-2xl font-bold text-teal">
            {totalQty} <span className="text-base font-normal">{watch('uom') || 'units'}</span>
          </span>
        </div>
        <p className="text-xs text-gray-400 -mt-3 text-right">= {units} units × {packingSize} pack size</p>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-navy mb-1.5">Mfg Date</label>
            <input {...register('mfg_date')} type="date"
              className={`input-field ${errors.mfg_date ? 'border-red-400' : ''}`} />
            {errors.mfg_date && <p className="mt-1 text-sm text-red-700">{errors.mfg_date.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-navy mb-1.5">Expiry Date</label>
            <input {...register('expiry_date')} type="date"
              className={`input-field ${errors.expiry_date ? 'border-red-400' : ''}`} />
            {errors.expiry_date && <p className="mt-1 text-sm text-red-700">{errors.expiry_date.message}</p>}
          </div>
        </div>

        {/* Photo Strip */}
        <PhotoStrip photos={photos} onAdd={handlePhotoAdd} onRemove={handlePhotoRemove} />

        {/* Submit button — inside form, no z-index/positioning issues on mobile */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary h-[52px] w-full mt-2"
        >
          {isSubmitting ? (
            <span className="flex items-center gap-2"><Spinner /> Saving...</span>
          ) : editEntry ? 'Update Scan' : 'Log Scan'}
        </button>
        <div className="h-4" />
      </form>

      <BottomNav />
    </div>
  );
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for HTTP (non-secure context) where crypto.randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
