import { createContext, useContext, useState, ReactNode } from 'react';

export interface PvSession {
  id: string;
  warehouse_id: string;
  user_id: string;
  started_at: string;
}

interface SessionContextValue {
  session: PvSession | null;
  setSession: (s: PvSession) => void;
  clearSession: () => void;
  scanCount: number;
  setScanCount: (n: number | ((prev: number) => number)) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<PvSession | null>(() => {
    const s = sessionStorage.getItem('litmus_session');
    return s ? (JSON.parse(s) as PvSession) : null;
  });
  const [scanCount, setScanCount] = useState(0);

  const setSession = (s: PvSession) => {
    sessionStorage.setItem('litmus_session', JSON.stringify(s));
    setSessionState(s);
  };

  const clearSession = () => {
    sessionStorage.removeItem('litmus_session');
    setSessionState(null);
    setScanCount(0);
  };

  return (
    <SessionContext.Provider value={{ session, setSession, clearSession, scanCount, setScanCount }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
