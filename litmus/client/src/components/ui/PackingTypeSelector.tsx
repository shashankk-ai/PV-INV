import { PackingType } from '@litmus/shared';

const OPTIONS: { value: PackingType; label: string; icon: string }[] = [
  { value: 'drums',   label: 'Drums',   icon: '🛢️' },
  { value: 'bags',    label: 'Bags',    icon: '🧴' },
  { value: 'bottles', label: 'Bottles', icon: '🍶' },
  { value: 'cans',    label: 'Cans',    icon: '🥫' },
  { value: 'cartons', label: 'Cartons', icon: '📦' },
  { value: 'pallets', label: 'Pallets', icon: '🗂️' },
  { value: 'other',   label: 'Other',   icon: '📋' },
];

interface Props {
  value: PackingType | '';
  onChange: (v: PackingType) => void;
  error?: string;
  accent?: 'teal' | 'gold';
}

export default function PackingTypeSelector({ value, onChange, error, accent = 'teal' }: Props) {
  const activeClass = accent === 'gold'
    ? 'border-gold bg-yellow-50 text-navy'
    : 'border-teal bg-teal-50 text-teal';

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl border-2 transition-colors
              ${value === opt.value ? activeClass : 'border-gray-200 bg-white text-gray-600'}
              active:scale-95`}
          >
            <span className="text-xl leading-none">{opt.icon}</span>
            <span className="text-xs font-medium leading-tight">{opt.label}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
