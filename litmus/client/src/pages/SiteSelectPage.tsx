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

  const filtered = (data ?? []).filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.location_code.toLowerCase().includes(search.toLowerCase())
  );

  const selectSite = async (w: Warehouse) => {
    setSite(w);
    clearSession();
    // Create a new PV session
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
      <header className="nav-bar sticky top-0 z-10">
        <span className="font-semibold text-lg">Select Site</span>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal flex items-center justify-center text-xs font-bold text-white">
            {initials}
          </div>
          <button
            onClick={logout}
            className="text-sm text-white opacity-75 hover:opacity-100 transition-opacity"
          >
            Sign Out
          </button>
        </div>
      </header>

      <div className="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
        {/* Search */}
        <div className="relative mb-4">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites..."
            className="input-field pl-10"
          />
        </div>

        {/* Content */}
        {isLoading ? (
          <SkeletonList count={3} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <span className="text-5xl">🏭</span>
            <p className="text-gray-500 font-medium">No sites match "{search}"</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {filtered.map((w) => (
              <li key={w.id}>
                <button
                  onClick={() => selectSite(w)}
                  className="w-full card p-4 text-left flex items-center gap-0 border-l-4 border-teal
                             active:scale-[0.99] transition-transform hover:shadow-md"
                >
                  <div className="flex-1">
                    <p className="font-bold text-navy text-lg leading-snug">{w.name}</p>
                    <p className="text-gray-400 text-sm font-mono mt-0.5">{w.location_code}</p>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-300 flex-shrink-0" />
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
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
