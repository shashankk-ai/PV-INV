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
    <nav className="fixed bottom-0 left-0 right-0 z-30 safe-area-bottom">
      {/* Frosted glass bar */}
      <div className="bg-white/90 backdrop-blur-lg border-t border-gray-200/80 shadow-lg shadow-black/5 flex">
        <NavButton
          active={isScan}
          onClick={() => navigate('/scan')}
          label="Scan"
          icon={<FlaskIcon active={isScan} />}
        />
        <NavButton
          active={isLog}
          onClick={() => navigate('/log')}
          label="Log"
          icon={<ListIcon active={isLog} />}
          badge={totalBadge}
          badgePending={pendingCount > 0}
        />
      </div>
    </nav>
  );
}

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  badgePending?: boolean;
}

function NavButton({ active, onClick, label, icon, badge = 0, badgePending }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 relative transition-colors
        ${active ? 'text-teal-600' : 'text-gray-400 hover:text-gray-600'}`}
    >
      {/* Active indicator bar */}
      {active && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-teal-500 rounded-full" />
      )}

      <span className={`transition-transform duration-150 ${active ? 'scale-110' : ''}`}>
        {icon}
      </span>

      <span className={`text-xs font-semibold transition-colors ${active ? 'text-teal-600' : 'text-gray-400'}`}>
        {label}
      </span>

      {badge > 0 && (
        <span className={`absolute top-2 right-[calc(50%-18px)] -mr-1
          text-white text-xs rounded-full min-w-[18px] h-[18px]
          flex items-center justify-center font-bold px-1
          ${badgePending ? 'bg-amber-500' : 'bg-teal-500'}`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function FlaskIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3M9 3H7M15 3h2" />
      {active && <circle cx="10" cy="15" r="1" fill="currentColor" stroke="none" />}
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6"  x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6"  x2="3.01" y2="6"  strokeWidth={3} />
      <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth={3} />
      <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth={3} />
    </svg>
  );
}
