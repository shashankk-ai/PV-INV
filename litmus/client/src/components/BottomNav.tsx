import { useNavigate, useLocation } from 'react-router-dom';
import { useSession } from '../contexts/SessionContext';
import { useSync } from '../contexts/SyncContext';

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { scanCount } = useSession();
  const { pendingCount } = useSync();
  const totalBadge = scanCount + pendingCount;

  const isScan = location.pathname === '/scan';
  const isLog = location.pathname === '/log';

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-30 safe-area-bottom">
      <button
        onClick={() => navigate('/scan')}
        className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors
          ${isScan ? 'text-teal' : 'text-gray-400'}`}
      >
        <FlaskIcon active={isScan} />
        <span className="text-xs font-medium">Scan</span>
      </button>

      <button
        onClick={() => navigate('/log')}
        className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 relative transition-colors
          ${isLog ? 'text-teal' : 'text-gray-400'}`}
      >
        <ListIcon active={isLog} />
        {totalBadge > 0 && (
          <span className={`absolute top-2 right-1/4 -translate-x-2 text-white text-xs rounded-full
                           min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1
                           ${pendingCount > 0 ? 'bg-amber-500' : 'bg-teal'}`}>
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
        <span className="text-xs font-medium">Log</span>
      </button>
    </nav>
  );
}

function FlaskIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3M9 3H7M15 3h2" />
      <circle cx="10" cy="15" r="1" fill={active ? 'currentColor' : 'none'} />
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth={3} />
      <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth={3} />
      <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth={3} />
    </svg>
  );
}
