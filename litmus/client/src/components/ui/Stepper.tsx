interface Props {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label?: string;
  error?: string;
}

export default function Stepper({ value, onChange, min = 1, max = 9999, label, error }: Props) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <div>
      {label && <label className="block text-sm font-medium text-navy mb-1.5">{label}</label>}
      <div className={`flex items-center border rounded-xl overflow-hidden ${error ? 'border-red-400' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={dec}
          disabled={value <= min}
          className="w-14 h-12 flex items-center justify-center text-2xl font-bold text-teal bg-teal-50
                     active:bg-teal-100 disabled:opacity-30 disabled:cursor-not-allowed select-none"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          className="flex-1 text-center text-xl font-bold text-navy h-12 border-none outline-none bg-white"
        />
        <button
          type="button"
          onClick={inc}
          disabled={value >= max}
          className="w-14 h-12 flex items-center justify-center text-2xl font-bold text-teal bg-teal-50
                     active:bg-teal-100 disabled:opacity-30 disabled:cursor-not-allowed select-none"
        >
          +
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
