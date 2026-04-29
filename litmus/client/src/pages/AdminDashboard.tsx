import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/axios';
import toast from 'react-hot-toast';
import DataUploadPage from './DataUploadPage';

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

interface AdminUser {
  id: string;
  username: string;
  role: 'ops' | 'admin';
  created_at: string;
  sessions_today: number;
  scans_today: number;
}

type Tab = 'overview' | 'data' | 'users';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [showAddUser, setShowAddUser] = useState(false);

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
    enabled: tab === 'overview',
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<{ data: Warehouse[] }>('/warehouses').then((r) => r.data.data),
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ data: AdminUser[] }>('/admin/users').then((r) => r.data.data),
    refetchInterval: 30000,
    enabled: tab === 'users',
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { toast.success('User removed'); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Could not remove user'),
  });

  const stats = statsData;
  const sessions = sessionsData ?? [];
  const warehouses = warehousesData ?? [];
  const users = usersData ?? [];

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
          <button onClick={logout} className="text-white opacity-70 hover:opacity-100 text-sm">Out</button>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 flex px-4 sticky top-[60px] z-10">
        {([
            { key: 'overview', label: 'Overview' },
            { key: 'data',     label: 'Data' },
            { key: 'users',    label: 'Team' },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors
              ${tab === key ? 'border-[#4B3B8C] text-[#4B3B8C]' : 'border-transparent text-gray-500'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 max-w-lg mx-auto w-full space-y-5">

        {tab === 'overview' && (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Sessions Today" value={stats?.sessions_today ?? '—'} color="purple" />
              <StatCard label="Scans Today"    value={stats?.scans_today    ?? '—'} color="teal" />
              <StatCard label="Active Users"   value={stats?.active_users   ?? '—'} color="blue" />
              <StatCard label="Unlisted Items" value={stats?.unlisted_items ?? '—'} color="amber" />
            </div>

            {/* Truth Reports */}
            <section>
              <h2 className="text-sm font-semibold text-navy mb-2">Truth Reports</h2>
              <div className="flex flex-col gap-2">
                {warehouses.length === 0 ? (
                  <p className="text-sm text-gray-400">Loading warehouses…</p>
                ) : warehouses.map((wh) => (
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
                      View Report <ChevronRightIcon />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Recent Sessions */}
            <section>
              <h2 className="text-sm font-semibold text-navy mb-2">Recent Sessions</h2>
              <div className="flex flex-col gap-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-gray-400">No sessions yet today.</p>
                ) : sessions.map((s) => (
                  <div key={s.id} className="card p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-navy truncate">{s.warehouse.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.user.username} · {formatTime(s.started_at)}</p>
                    </div>
                    <span className="text-sm font-bold text-teal flex-shrink-0 ml-3">{s._count.entries} scans</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === 'data' && <DataUploadPage />}

        {tab === 'users' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-navy">Team Members</h2>
              <button
                onClick={() => setShowAddUser(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#4B3B8C] bg-purple-50 px-3 py-1.5 rounded-full hover:bg-purple-100 transition-colors"
              >
                <PlusIcon /> Add User
              </button>
            </div>

            {usersLoading ? (
              <div className="flex flex-col gap-2">
                {[1,2,3].map((i) => <div key={i} className="card p-4 animate-pulse h-16 bg-gray-100" />)}
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-gray-400">No users found.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {users.map((u) => (
                  <div key={u.id} className="card p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-navy">{u.username}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${u.role === 'admin' ? 'bg-purple-100 text-[#4B3B8C]' : 'bg-teal-50 text-teal'}`}>
                          {u.role}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {u.sessions_today} session{u.sessions_today !== 1 ? 's' : ''} · {u.scans_today} scans today
                      </p>
                    </div>
                    {u.id !== user?.id && (
                      <button
                        onClick={() => {
                          if (confirm(`Remove user "${u.username}"? This cannot be undone.`)) {
                            deleteUserMutation.mutate(u.id);
                          }
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors ml-2 flex-shrink-0"
                        title="Remove user"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <AddUserModal
          onClose={() => setShowAddUser(false)}
          onCreated={() => {
            setShowAddUser(false);
            qc.invalidateQueries({ queryKey: ['admin-users'] });
          }}
        />
      )}
    </div>
  );
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ops' | 'admin'>('ops');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/admin/users', { username, password, role }),
    onSuccess: () => { toast.success(`User "${username}" created`); onCreated(); },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Could not create user';
      setError(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 flex flex-col gap-4 animate-slide-down">
        <h3 className="text-lg font-bold text-navy">Add Team Member</h3>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-navy mb-1">Username</label>
            <input
              className="input-field"
              placeholder="e.g. john_ops"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy mb-1">Password</label>
            <input
              className="input-field"
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy mb-1">Role</label>
            <div className="flex gap-2">
              {(['ops', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors
                    ${role === r
                      ? r === 'admin' ? 'bg-[#4B3B8C] text-white border-[#4B3B8C]' : 'bg-teal text-white border-teal'
                      : 'bg-white text-gray-600 border-gray-200'}`}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-3 mt-1">
          <button onClick={onClose} className="btn-outline flex-1">Cancel</button>
          <button
            onClick={() => { setError(''); mutation.mutate(); }}
            disabled={mutation.isPending || !username || !password}
            className="flex-1 btn-primary bg-[#4B3B8C] hover:bg-[#3a2d6e]"
          >
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
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

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
