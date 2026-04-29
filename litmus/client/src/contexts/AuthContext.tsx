import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import api from '../lib/axios';
import { AuthUser } from '@litmus/shared';

interface AuthContextValue {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = sessionStorage.getItem('litmus_user');
    return stored ? (JSON.parse(stored) as AuthUser) : null;
  });

  const login = useCallback(async (username: string, password: string): Promise<AuthUser> => {
    const { data: body } = await api.post('/auth/login', { username, password });
    const { user: u, access_token, refresh_token } = body.data;
    sessionStorage.setItem('litmus_access_token', access_token);
    sessionStorage.setItem('litmus_user', JSON.stringify(u));
    localStorage.setItem('litmus_refresh_token', refresh_token);
    setUser(u as AuthUser);
    return u as AuthUser;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('litmus_access_token');
    sessionStorage.removeItem('litmus_user');
    localStorage.removeItem('litmus_refresh_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
