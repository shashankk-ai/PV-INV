import { useAuth } from '../contexts/AuthContext';
import LitmusLogo from '../components/LitmusLogo';

export default function AdminPlaceholder() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-[#4B3B8C] text-white px-4 py-4 flex items-center justify-between">
        <span className="font-bold text-lg">LITMUS Command</span>
        <span className="text-xs bg-white/20 px-2 py-1 rounded-full">ADMIN</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <LitmusLogo size="md" showTagline={false} showByLine={false} />
        <p className="text-gray-500">Signed in as <strong>{user?.username}</strong></p>
        <p className="text-sm text-gray-400">Phase 6 — Admin screens coming.</p>
        <button onClick={logout} className="btn-outline mt-4 max-w-xs">Sign Out</button>
      </div>
    </div>
  );
}
