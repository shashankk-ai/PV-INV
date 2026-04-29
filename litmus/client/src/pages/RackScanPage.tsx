import { useEffect, useState } from 'react';
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
import api from '../lib/axios';

const PACKING_TYPES = ['drums', 'bags', 'bottles', 'cans', 'cartons', 'pallets', 'other'] as const;

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
  const navigate = useNavigate();
  const [uomOptions, setUomOptions] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [ocrText, setOcrText] = useState<string | null>(null);

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
    defaultValues: editEntry
      ? { ...editEntry, units: editEntry.units ?? 1, packing_size: editEntry.packing_size ?? 1 }
      : { units: 1, packing_size: 1, packing_type: undefined },
  });

  const units = watch('units') ?? 1;
  const packingSize = watch('packing_size') ?? 1;
  const totalQty = units * packingSize;

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
    const idempotencyKey = editEntry?.id ? undefined : crypto.randomUUID();
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
        reset({ units: 1, packing_size: 1, packing_type: undefined });
        setUomOptions([]);
        setPhotos([]);
        setOcrText(null);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Failed to save. Try again.';
      toast.error(msg);
    }
  };

  if (!site) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-32">
      {/* Header */}
      <header className="nav-bar sticky top-0 z-20">
        <div>
          <p className="font-semibold text-sm leading-tight text-white opacity-70">Rack Scan</p>
          <p className="font-bold text-base leading-tight">{site.name}</p>
        </div>
        <div className="flex items-center gap-3">
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

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-5">
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
                onChange={field.onChange}
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
          <label className="block text-sm font-medium text-navy mb-1.5">Item Key</label>
          <input
            {...register('item_key')}
            type="text"
            readOnly
            className="input-field bg-gray-100 text-gray-500 font-mono cursor-not-allowed"
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

        <div className="h-4" />
      </form>

      {/* Unknown Compound FAB */}
      <button
        onClick={() => navigate('/unknown')}
        className="fixed right-4 bottom-24 z-20 flex items-center gap-2 bg-gold text-white
                   px-4 py-3 rounded-full shadow-lg active:scale-95 transition-transform font-semibold text-sm"
      >
        <span className="text-lg font-bold leading-none">?</span>
        <span>Unknown</span>
      </button>

      {/* Fixed bottom submit */}
      <div className="fixed bottom-16 left-0 right-0 px-4 pb-2 bg-gradient-to-t from-gray-50 to-transparent z-10">
        <button
          type="submit"
          disabled={isSubmitting}
          onClick={handleSubmit(onSubmit)}
          className="btn-primary h-[52px]"
        >
          {isSubmitting ? (
            <span className="flex items-center gap-2"><Spinner /> Saving...</span>
          ) : editEntry ? 'Update Scan' : 'Log Scan'}
        </button>
      </div>

      <BottomNav />
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
