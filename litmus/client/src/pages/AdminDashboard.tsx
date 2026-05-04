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
  _count: { system_inventory: number };
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
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
  const [warehouseSearch, setWarehouseSearch] = useState('');

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
      <header className="bg-gradient-to-r from-[#2A1F68] to-[#4B3B8C] text-white px-4 pt-5 pb-4 sticky top-0 z-20 shadow-lg shadow-[#4B3B8C]/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-white/60 leading-tight">LITMUS Command</p>
            <p className="font-bold text-lg leading-tight">Admin Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/15 border border-white/20 flex items-center justify-center text-xs font-bold">
              {user?.username.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-white/80 text-sm">{user?.username}</span>
            <button onClick={logout} className="text-white/60 hover:text-white text-sm transition-colors px-2 py-1">
              Out
            </button>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 flex px-4 sticky top-[68px] z-10 shadow-sm">
        {([
          { key: 'overview', label: 'Overview', icon: <GridIcon /> },
          { key: 'data',     label: 'Data',     icon: <UploadIcon /> },
          { key: 'users',    label: 'Team',     icon: <UsersIcon /> },
        ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5
              ${tab === key
                ? 'border-[#4B3B8C] text-[#4B3B8C]'
                : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            <span className="w-4 h-4">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="px-4 py-5 max-w-lg mx-auto w-full space-y-5">

        {tab === 'overview' && (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Sessions Today"
                value={stats?.sessions_today ?? '—'}
                color="purple"
                icon={<SessionIcon />}
              />
              <StatCard
                label="Scans Today"
                value={stats?.scans_today ?? '—'}
                color="teal"
                icon={<ScanIcon />}
              />
              <StatCard
                label="Active Users"
                value={stats?.active_users ?? '—'}
                color="blue"
                icon={<UserIcon />}
              />
              <StatCard
                label="Unlisted Items"
                value={stats?.unlisted_items ?? '—'}
                color="amber"
                icon={<AlertIcon />}
              />
            </div>

            {/* Truth Reports */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="section-title mb-0">Truth Reports</h2>
              </div>
              {warehouses.length > 0 && (
                <div className="relative mb-2">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search warehouse by name or code…"
                    value={warehouseSearch}
                    onChange={(e) => setWarehouseSearch(e.target.value)}
                    className="input-field pl-9 text-sm py-2"
                  />
                </div>
              )}
              <div className="flex flex-col gap-2">
                {warehouses.length === 0 ? (
                  <div className="card p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gray-100 animate-pulse" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-gray-100 rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                ) : warehouses.filter((w) => w._count.system_inventory > 0).length === 0 ? (
                  <div className="card p-4 text-center text-sm text-gray-400">
                    No inventory uploaded yet — go to Data tab to upload your file
                  </div>
                ) : warehouses.filter((wh) =>
                    wh._count.system_inventory > 0 && (
                      !warehouseSearch ||
                      wh.name.toLowerCase().includes(warehouseSearch.toLowerCase()) ||
                      wh.location_code.toLowerCase().includes(warehouseSearch.toLowerCase())
                    )
                  ).map((wh) => (
                  <button
                    key={wh.id}
                    onClick={() => navigate(`/admin/truth/${wh.id}`)}
                    className="card p-4 flex items-center gap-3 text-left
                      hover:shadow-md hover:border-purple-200
                      active:scale-[0.99] transition-all duration-150 w-full"
                  >
                    <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                      <WarehouseIcon />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-navy text-sm truncate">{wh.name}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{wh.location_code}</p>
                    </div>
                    <span className="badge-purple flex items-center gap-1 flex-shrink-0">
                      View Report <ChevronRightIcon />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Recent Sessions */}
            <section>
              <h2 className="section-title">Recent Sessions</h2>
              <div className="flex flex-col gap-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-gray-400 px-1">No sessions yet today.</p>
                ) : sessions.map((s) => (
                  <div key={s.id} className="card p-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
                      <span className="text-teal-600 text-xs font-bold">
                        {s.user.username.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-navy truncate">{s.warehouse.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.user.username} · {formatTime(s.started_at)}</p>
                    </div>
                    <span className="badge-teal flex-shrink-0">{s._count.entries} scans</span>
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
              <h2 className="section-title mb-0">Team Members</h2>
              <button
                onClick={() => setShowAddUser(true)}
                className="badge-purple cursor-pointer hover:bg-purple-200/60 transition-colors flex items-center gap-1"
              >
                <PlusIcon /> Add User
              </button>
            </div>

            {usersLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((i) => <div key={i} className="card p-4 animate-pulse h-16 bg-gray-100" />)}
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-gray-400 px-1">No users found.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {users.map((u) => (
                  <div key={u.id} className="card p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0
                      ${u.role === 'admin' ? 'bg-purple-100 text-[#4B3B8C]' : 'bg-teal-50 text-teal-700'}`}>
                      {u.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-navy">{u.username}</p>
                        <span className={u.role === 'admin' ? 'badge-purple' : 'badge-teal'}>
                          {u.role}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{u.email}</p>
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
                        className="p-2 text-gray-300 hover:text-red-500 transition-colors ml-1 flex-shrink-0"
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
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ops' | 'admin'>('ops');
  const [error, setError] = useState('');

  const usernameValid = /^[a-z0-9_]{3,32}$/.test(username);
  const canSubmit = usernameValid && email.trim().includes('@') && password.length >= 8;

  const mutation = useMutation({
    mutationFn: () => api.post('/admin/users', { username, email, password, role }),
    onSuccess: () => { toast.success(`User "${username}" created`); onCreated(); },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: { message?: string; details?: Record<string, string[]> } } } };
      const details = err?.response?.data?.error?.details;
      if (details) {
        const msgs = Object.values(details).flat().join(' · ');
        setError(msgs || 'Check your input');
      } else {
        setError(err?.response?.data?.error?.message ?? 'Could not create user — try again');
      }
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-8">
      <div className="bg-white rounded-3xl w-full max-w-sm p-6 flex flex-col gap-4 animate-slide-up shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-navy">Add Team Member</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XIcon />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Username</label>
            <input
              className={`input-field ${username && !usernameValid ? 'border-red-400 ring-1 ring-red-400' : ''}`}
              placeholder="e.g. john_ops"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoCapitalize="none"
            />
            <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers and _ only (e.g. <span className="font-mono">ram_ops</span>)</p>
            {username && !usernameValid && (
              <p className="text-xs text-red-500 mt-0.5">Use only lowercase letters, numbers and underscore (_)</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Email <span className="text-red-500">*</span>
              <span className="ml-1 text-gray-400 normal-case font-normal">— welcome email sent here</span>
            </label>
            <input
              className="input-field"
              type="email"
              placeholder="john@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Password</label>
            <input
              className="input-field"
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Role</label>
            <div className="flex gap-2">
              {(['ops', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold border transition-all
                    ${role === r
                      ? r === 'admin'
                        ? 'bg-[#4B3B8C] text-white border-[#4B3B8C] shadow-md shadow-[#4B3B8C]/20'
                        : 'bg-teal-500 text-white border-teal-500 shadow-md shadow-teal-500/20'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-1">
          <button onClick={onClose} className="btn-outline flex-1">Cancel</button>
          <button
            onClick={() => { setError(''); mutation.mutate(); }}
            disabled={mutation.isPending || !canSubmit}
            className="flex-1 h-touch-lg rounded-2xl font-semibold text-sm text-white
              bg-gradient-to-br from-[#4B3B8C] to-[#6B4FB0]
              shadow-md shadow-[#4B3B8C]/25
              active:scale-[0.97] transition-all duration-150
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: React.ReactNode }) {
  const styles: Record<string, { bg: string; iconBg: string; text: string }> = {
    purple: { bg: 'bg-gradient-to-br from-purple-50 to-purple-100/60 border-purple-200/60', iconBg: 'bg-purple-100', text: 'text-[#4B3B8C]' },
    teal:   { bg: 'bg-gradient-to-br from-teal-50 to-teal-100/60 border-teal-200/60',       iconBg: 'bg-teal-100',   text: 'text-teal-700' },
    blue:   { bg: 'bg-gradient-to-br from-blue-50 to-blue-100/60 border-blue-200/60',       iconBg: 'bg-blue-100',   text: 'text-blue-700' },
    amber:  { bg: 'bg-gradient-to-br from-amber-50 to-amber-100/60 border-amber-200/60',    iconBg: 'bg-amber-100',  text: 'text-amber-700' },
    green:  { bg: 'bg-gradient-to-br from-green-50 to-green-100/60 border-green-200/60',    iconBg: 'bg-green-100',  text: 'text-green-700' },
  };
  const s = styles[color];
  return (
    <div className={`rounded-2xl border p-4 ${s.bg}`}>
      <div className={`w-8 h-8 rounded-xl ${s.iconBg} flex items-center justify-center mb-3 ${s.text}`}>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${s.text}`}>{value}</p>
      <p className="text-xs font-medium mt-0.5 text-gray-500">{label}</p>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* --- Icons --- */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
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
function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
}
function SessionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}
function ScanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3M9 3H7M15 3h2"/>
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
}
function ValueIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  );
}
function WarehouseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-[#4B3B8C]">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}
