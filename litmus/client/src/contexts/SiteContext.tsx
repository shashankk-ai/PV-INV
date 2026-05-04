import { createContext, useContext, useState, ReactNode } from 'react';

export interface Warehouse {
  id: string;
  name: string;
  location_code: string;
  _count?: { system_inventory: number };
}

interface SiteContextValue {
  site: Warehouse | null;
  setSite: (w: Warehouse) => void;
  clearSite: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSiteState] = useState<Warehouse | null>(() => {
    const s = sessionStorage.getItem('litmus_site');
    return s ? (JSON.parse(s) as Warehouse) : null;
  });

  const setSite = (w: Warehouse) => {
    sessionStorage.setItem('litmus_site', JSON.stringify(w));
    setSiteState(w);
  };

  const clearSite = () => {
    sessionStorage.removeItem('litmus_site');
    setSiteState(null);
  };

  return <SiteContext.Provider value={{ site, setSite, clearSite }}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used within SiteProvider');
  return ctx;
}
