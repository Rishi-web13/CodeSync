import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from '@/auth/AuthProvider';
import AssistantWidget from '@/components/AssistantWidget';
import { ToastProvider } from '@/components/toast';
import { FullPageSpinner } from '@/components/ui/spinner';
import Landing from '@/pages/Landing';
import AuthPage from '@/pages/AuthPage';
import Dashboard from '@/pages/Dashboard';
import JoinPage from '@/pages/JoinPage';
import { DocsPage, PrivacyPage } from '@/pages/Static';

// Monaco is large — only load it when a workspace is opened.
const Workspace = lazy(() => import('@/workspace/Workspace'));

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<AuthPage mode="signin" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/app" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
            <Route path="/room/:roomId" element={<RequireAuth><Suspense fallback={<FullPageSpinner label="Opening workspace…" />}><Workspace /></Suspense></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <AssistantWidget />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
