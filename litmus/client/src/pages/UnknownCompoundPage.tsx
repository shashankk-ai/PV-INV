import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useSession } from '../contexts/SessionContext';
import { useSite } from '../contexts/SiteContext';
import Stepper from '../components/ui/Stepper';
import PackingTypeSelector from '../components/ui/PackingTypeSelector';
import api from '../lib/axios';
import { PackingType } from '@litmus/shared';

const PACKING_TYPES = ['drums','bags','bottles','cans','cartons','pallets','other'] as const;

const schema = z.object({
  item_name:   z.string().min(1, 'Item name is required'),
  description: z.string().optional(),
  quantity:    z.number().int().min(1),
  uom:         z.enum(['L','KG','Units','Other']),
  packing_type: z.enum(PACKING_TYPES, { errorMap: () => ({ message: 'Select a packing type' }) }),
  notes:       z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function UnknownCompoundPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const { site } = useSite();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: 1, uom: 'L' },
  });

  const onSubmit = async (data: FormData) => {
    if (!session) { toast.error('No active session'); return; }
    try {
      await api.post('/unlisted-items', { ...data, session_id: session.id });
      toast.success('Unlisted item recorded ✓');
      navigate('/scan');
    } catch {
      toast.error('Failed to record. Try again.');
    }
  };

  if (!site) { navigate('/sites'); return null; }

  return (
    <div className="min-h-screen bg-white flex flex-col pb-32">
      {/* Amber header */}
      <header className="bg-gradient-to-r from-amber-500 to-amber-400 text-white px-4 py-4 flex items-center gap-3 sticky top-0 z-20 shadow-md shadow-amber-500/30">
        <button
          onClick={() => navigate('/scan')}
          className="p-1 rounded-lg active:bg-amber-600"
        >
          <BackIcon className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/70 leading-tight">Not in system inventory</p>
          <div className="flex items-center gap-2">
            <WarnFlaskIcon className="w-5 h-5" />
            <span className="font-bold text-lg">Unlisted Item</span>
          </div>
        </div>
      </header>

      {/* Subtitle card */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
        <p className="text-sm text-amber-800">
          This item is <strong>not found in the system</strong> — it will be recorded separately for review.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-5">

        {/* Item Name */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Chemical Name</label>
          <input
            {...register('item_name')}
            type="text"
            placeholder="Enter chemical name"
            className={`input-field border-gold focus:ring-gold ${errors.item_name ? 'border-red-400 ring-1 ring-red-400' : ''}`}
          />
          {errors.item_name && <p className="mt-1 text-sm text-red-700">{errors.item_name.message}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Description</label>
          <textarea
            {...register('description')}
            rows={3}
            placeholder="Describe the item, packaging condition, any labels visible"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-navy text-base
                       focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent
                       placeholder:text-gray-400 resize-none"
          />
        </div>

        {/* Quantity */}
        <Controller name="quantity" control={control} render={({ field }) => (
          <Stepper
            label="Quantity"
            value={field.value}
            onChange={field.onChange}
            error={errors.quantity?.message}
          />
        )} />

        {/* UOM */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">Unit of Measure</label>
          <select
            {...register('uom')}
            className="input-field focus:ring-gold"
          >
            <option value="L">L — Litres</option>
            <option value="KG">KG — Kilograms</option>
            <option value="Units">Units</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Packing Type */}
        <div>
          <label className="block text-sm font-medium text-navy mb-2">Packing Type</label>
          <Controller name="packing_type" control={control} render={({ field }) => (
            <PackingTypeSelector
              value={(field.value as PackingType) ?? ''}
              onChange={field.onChange}
              error={errors.packing_type?.message}
              accent="gold"
            />
          )} />
        </div>

        {/* Notes (optional) */}
        <div>
          <label className="block text-sm font-medium text-navy mb-1.5">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            {...register('notes')}
            rows={4}
            placeholder="Any additional observations"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-navy text-base
                       focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent
                       placeholder:text-gray-400 resize-none"
          />
        </div>

        {/* Camera placeholder — Phase 4 */}
        <div className="flex justify-center">
          <button type="button" className="w-16 h-16 rounded-full bg-[#C8A028] flex items-center justify-center shadow-md active:scale-95">
            <CameraIcon className="w-7 h-7 text-white" />
          </button>
        </div>
      </form>

      {/* Fixed submit */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-2 bg-white border-t border-gray-100 z-10">
        <button
          type="submit"
          onClick={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          className="btn-gold"
        >
          {isSubmitting ? 'Recording…' : 'Record Unlisted Item'}
        </button>
      </div>
    </div>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function WarnFlaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3" />
      <line x1="12" y1="12" x2="12" y2="15" />
      <circle cx="12" cy="17.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
