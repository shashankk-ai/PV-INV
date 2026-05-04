import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/axios';

interface Chemical {
  item_key: string;
  item_name: string;
  uom_options: string[];
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  onSelect: (chem: Chemical) => void;
  error?: string;
  placeholder?: string;
}

export default function ItemCombobox({ value, onChange, onSelect, error, placeholder }: Props) {
  const [results, setResults] = useState<Chemical[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback((q: string) => {
    abortRef.current?.abort();

    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    api
      .get<{ data: Chemical[] }>(`/items?search=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
      .then((r) => {
        const count = r.headers['x-total-items'];
        if (count !== undefined) setTotalItems(parseInt(count, 10));
        setResults(r.data.data ?? []);
        setOpen(true);
      })
      .catch((err: { name?: string; code?: string }) => {
        if (err.name !== 'AbortError' && err.code !== 'ERR_CANCELED') {
          setResults([]);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, search]);

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 200);
  };

  const handleFocus = () => {
    if (value.trim() && results.length > 0) setOpen(true);
  };

  const pick = (chem: Chemical) => {
    onChange(chem.item_name);
    onSelect(chem);
    setOpen(false);
    setResults([]);
  };

  const noMatchMessage = () => {
    if (totalItems === 0 || totalItems === null && !loading) {
      return (
        <p className="text-sm text-gray-500">
          No inventory loaded —{' '}
          <span className="text-amber-600 font-semibold">ask admin to upload data</span>
        </p>
      );
    }
    return (
      <p className="text-sm text-gray-500">
        No match among{' '}
        <span className="font-medium text-navy">{totalItems?.toLocaleString('en-IN')} items</span>
        {' '}— check spelling or tap{' '}
        <strong className="text-amber-600">Unlisted Item</strong>
      </p>
    );
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder ?? 'Search chemical name...'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`input-field pr-10 ${error ? 'border-red-400 ring-1 ring-red-400' : ''}`}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 border-2 border-teal border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {results.map((c) => (
            <li key={c.item_key}>
              <button
                type="button"
                onClick={() => pick(c)}
                className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-teal-50 active:bg-teal-100 border-b border-gray-50 last:border-0"
              >
                <span className="font-medium text-navy">{c.item_name}</span>
                <span className="text-xs text-gray-400 font-mono ml-2 shrink-0">{c.item_key}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && results.length === 0 && !loading && value.trim().length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3">
          {noMatchMessage()}
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
