import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/axios';

interface Stats {
  sessions_today: number;
  scans_today: number;
  active_users: number;
  unlisted_items: number;
  total_entries: number;
  warehouses: number;
}

interface AdminSession {
  id: string;
  started_at: string;
  warehouse: { id: string; name: string; location_code: string };
  user: { id: string; username: string };
  _count: { entries: number };
}

interface Warehouse {
  id: string;
  name: string;
  location_code: string;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { data: statsData } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<{ data: Stats }>('/admin/stats').then((r) => r.data.data),
    refetchInterval: 30000,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: () =>
      api.get<{ data: AdminSession[] }>('/admin/sessions?limit=30').then((r) => r.data.data),
    refetchInterval: 30000,
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () =>
      api.get<{ data: Warehouse[] }>('/warehouses').then((r) => r.data.data),
  });

  const stats = statsData;
  const sessions = sessionsData ?? [];
  const warehouses = warehousesData ?? [];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-8">
      {/* Header */}
      <header className="bg-[#4B3B8C] text-white px-4 py-4 flex items-center justify-between sticky top-0 z-20">
        <div>
          <p className="text-xs font-medium opacity-70 leading-tight">LITMUS Command</p>
          <p className="font-bold text-base leading-tight">Admin Dashboard</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-white/20 px-2 py-1 rounded-full">{user?.username}</span>
          <button onClick={logout} className="text-white opacity-70 hover:opacity-100 text-sm">
            Out
          </button>
        </div>
      </header>

      <div className="px-4 py-4 max-w-lg mx-auto w-full space-y-5">

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Sessions Today" value={stats?.sessions_today ?? '—'} color="purple" />
          <StatCard label="Scans Today" value={stats?.scans_today ?? '—'} color="teal" />
          <StatCard label="Active Users" value={stats?.active_users ?? '—'} color="blue" />
          <StatCard label="Unlisted Items" value={stats?.unlisted_items ?? '—'} color="amber" />
        </div>

        {/* Truth Reports by Warehouse */}
        <section>
          <h2 className="text-sm font-semibold text-navy mb-2">Truth Reports</h2>
          <div className="flex flex-col gap-2">
            {warehouses.length === 0 ? (
              <p className="text-sm text-gray-400">Loading warehouses…</p>
            ) : (
              warehouses.map((wh) => (
                <button
                  key={wh.id}
                  onClick={() => navigate(`/admin/truth/${wh.id}`)}
                  className="card p-4 flex items-center justify-between text-left active:bg-gray-50 w-full"
                >
                  <div>
                    <p className="font-semibold text-navy text-sm">{wh.name}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{wh.location_code}</p>
                  </div>
                  <span className="text-xs font-semibold text-[#4B3B8C] bg-purple-50 px-2 py-1 rounded-full flex items-center gap-1">
                    View Report
                    <ChevronRightIcon />
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Recent Sessions */}
        <section>
          <h2 className="text-sm font-semibold text-navy mb-2">Recent Sessions</h2>
          <div className="flex flex-col gap-2">
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-400">No sessions yet today.</p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="card p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy truncate">{s.warehouse.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {s.user.username} · {formatTime(s.started_at)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-teal flex-shrink-0 ml-3">
                    {s._count.entries} scans
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colorMap: Record<string, string> = {
    purple: 'bg-purple-50 border-purple-200 text-[#4B3B8C]',
    teal:   'bg-teal-50 border-teal text-teal',
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
