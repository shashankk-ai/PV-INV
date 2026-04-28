import { useAuth } from '../contexts/AuthContext';

interface Props {
  title: string;
}

export default function PlaceholderPage({ title }: Props) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-teal-50 flex flex-col">
      <div className="nav-bar">
        <span className="font-bold text-lg">{title}</span>
        <button onClick={logout} className="text-sm text-white opacity-75 hover:opacity-100">
          Sign Out
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-6xl">🧪</div>
        <h2 className="text-2xl font-bold text-navy">{title}</h2>
        <p className="text-gray-500 text-center">
          Signed in as <strong>{user?.username}</strong> ({user?.role})
        </p>
        <p className="text-sm text-gray-400">Phase 2+ screens coming soon.</p>
      </div>
    </div>
  );
}
