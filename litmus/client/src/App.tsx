import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { SiteProvider } from './contexts/SiteContext';
import { SessionProvider } from './contexts/SessionContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { SyncProvider } from './contexts/SyncContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import SiteSelectPage from './pages/SiteSelectPage';
import RackScanPage from './pages/RackScanPage';
import ScanLogPage from './pages/ScanLogPage';
import UnknownCompoundPage from './pages/UnknownCompoundPage';
import AdminDashboard from './pages/AdminDashboard';
import TruthReportPage from './pages/TruthReportPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NetworkProvider>
        <SiteProvider>
          <SessionProvider>
          <SyncProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<Navigate to="/login" replace />} />

                <Route
                  path="/sites"
                  element={<ProtectedRoute><SiteSelectPage /></ProtectedRoute>}
                />
                <Route
                  path="/scan"
                  element={<ProtectedRoute><RackScanPage /></ProtectedRoute>}
                />
                <Route
                  path="/log"
                  element={<ProtectedRoute><ScanLogPage /></ProtectedRoute>}
                />
                <Route
                  path="/unknown"
                  element={<ProtectedRoute><UnknownCompoundPage /></ProtectedRoute>}
                />
                <Route
                  path="/admin"
                  element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>}
                />
                <Route
                  path="/admin/truth/:warehouseId"
                  element={<ProtectedRoute adminOnly><TruthReportPage /></ProtectedRoute>}
                />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </BrowserRouter>
            <Toaster
              position="top-center"
              toastOptions={{
                duration: 3000,
                style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px' },
              }}
            />
          </SyncProvider>
          </SessionProvider>
        </SiteProvider>
        </NetworkProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
