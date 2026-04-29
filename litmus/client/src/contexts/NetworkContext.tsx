import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import api from '../lib/axios';

interface NetworkContextValue {
  isOnline: boolean;
  lastChecked: number;
}

const NetworkContext = createContext<NetworkContextValue>({ isOnline: true, lastChecked: Date.now() });

const HEARTBEAT_INTERVAL = 30_000;

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastChecked, setLastChecked] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkConnectivity = useCallback(async () => {
    try {
      await api.get('/health', { timeout: 5000 });
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
    setLastChecked(Date.now());
  }, []);

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); checkConnectivity(); };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Heartbeat
    intervalRef.current = setInterval(checkConnectivity, HEARTBEAT_INTERVAL);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkConnectivity]);

  return (
    <NetworkContext.Provider value={{ isOnline, lastChecked }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
