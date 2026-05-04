import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useSite, Warehouse } from '../contexts/SiteContext';
import { useSession } from '../contexts/SessionContext';
import { SkeletonList } from '../components/ui/SkeletonCard';
import api from '../lib/axios';

export default function SiteSelectPage() {
  const { user, logout } = useAuth();
  const { setSite } = useSite();
  const { setSession, clearSession } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<{ data: Warehouse[] }>('/warehouses').then((r) => r.data.data),
  });

  const filtered = (data ?? [])
    .filter((w) => (w._count?.system_inventory ?? 0) > 0) // only warehouses with uploaded inventory
    .filter(
      (w) =>
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        w.location_code.toLowerCase().includes(search.toLowerCase())
    );

  const selectSite = async (w: Warehouse) => {
    setSite(w);
    clearSession();
    try {
      const res = await api.post<{ data: { id: string; warehouse_id: string; user_id: string; started_at: string } }>(
        '/sessions',
        { warehouse_id: w.id }
      );
      setSession(res.data.data);
    } catch {
      // Session creation failure is non-blocking — will retry on first scan
    }
    navigate('/scan');
  };

  const initials = user?.username.slice(0, 2).toUpperCase() ?? '??';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#0A1628] to-[#1a2d4a] text-white px-4 pt-5 pb-6 sticky top-0 z-10 shadow-lg shadow-navy/20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-white/60 leading-tight">Welcome back</p>
            <p className="font-bold text-lg leading-tight text-white">{user?.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-teal-500/30 border border-teal-400/40 flex items-center justify-center text-sm font-bold text-teal-300">
              {initials}
            </div>
            <button
              onClick={logout}
              className="text-sm text-white/60 hover:text-white transition-colors px-2 py-1"
            >
              Out
            </button>
          </div>
        </div>

        {/* Search bar in header */}
        <div className="relative">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites…"
            className="w-full h-11 rounded-2xl border border-white/10 pl-10 pr-4 text-sm
              bg-white/10 text-white placeholder:text-white/40
              focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal/40
              transition-shadow duration-150"
          />
        </div>
      </header>

      <div className="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
        {/* Count */}
        {!isLoading && data && (
          <p className="text-xs text-gray-400 font-medium mb-3 px-1">
            {filtered.length} site{filtered.length !== 1 ? 's' : ''}
            {search ? ` matching "${search}"` : ' available'}
          </p>
        )}

        {isLoading ? (
          <SkeletonList count={4} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl">🏭</div>
            {search
              ? <><p className="text-gray-500 font-medium">No sites match "{search}"</p><p className="text-gray-400 text-sm">Try a different search term</p></>
              : <><p className="text-gray-500 font-medium">No sites available</p><p className="text-gray-400 text-sm">Ask admin to upload inventory data first</p></>
            }
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {filtered.map((w) => (
              <li key={w.id} className="animate-slide-up">
                <button
                  onClick={() => selectSite(w)}
                  className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm
                    p-4 text-left flex items-center gap-3
                    hover:shadow-md hover:border-teal/30
                    active:scale-[0.99] transition-all duration-150"
                >
                  {/* Color dot */}
                  <div className="w-2.5 h-2.5 rounded-full bg-teal-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-navy text-sm leading-snug truncate">{w.name}</p>
                    <p className="text-gray-400 text-xs font-mono mt-0.5">{w.location_code}</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
