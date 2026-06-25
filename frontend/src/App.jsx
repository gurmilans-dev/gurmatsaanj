import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/common/Layout/Layout';
import Loader from './components/common/Loader/Loader';

function lazyWithRetry(loader) {
  return lazy(() => loader().catch((err) => {
    const msg = String(err?.message || err || '');
    const looksLikeStaleChunk =
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('error loading dynamically imported module') ||
      msg.includes('Loading chunk') ||
      msg.includes('Importing a module script failed');
    if (typeof window === 'undefined' || !looksLikeStaleChunk) throw err;

    const flag = 'saanj-kirtan.chunk-reload';
    try {
      if (window.sessionStorage?.getItem(flag) === '1') throw err;
      window.sessionStorage?.setItem(flag, '1');
    } catch {
      // Still try to reload if sessionStorage is blocked.
    }
    window.location.reload();
    return new Promise(() => {});
  }));
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    try {
      window.sessionStorage?.removeItem('saanj-kirtan.chunk-reload');
    } catch {
      // noop
    }
  });
}

const SearchPage = lazyWithRetry(() => import('./pages/SearchPage/SearchPage'));
const ShabadPage = lazyWithRetry(() => import('./pages/ShabadPage/ShabadPage'));
const HukamPage = lazyWithRetry(() => import('./pages/HukamPage/HukamPage'));
const AngPage = lazyWithRetry(() => import('./pages/AngPage/AngPage'));
const BaniPage = lazyWithRetry(() => import('./pages/BaniPage/BaniPage'));
const CalendarPage = lazyWithRetry(() => import('./pages/CalendarPage/CalendarPage'));
const RemoteControlPage = lazyWithRetry(() => import('./pages/RemoteControlPage/RemoteControlPage'));
const ProjectorPage = lazyWithRetry(() => import('./pages/ProjectorPage/ProjectorPage'));
const FollowPage = lazyWithRetry(() => import('./pages/FollowPage/FollowPage'));
const CreditsPage = lazyWithRetry(() => import('./pages/CreditsPage/CreditsPage'));
const SetupPage = lazyWithRetry(() => import('./pages/SetupPage/SetupPage'));

function PageFallback({ label = 'Loading...' }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '4rem 0' }}>
      <Loader label={label} />
    </div>
  );
}

function MainAppRoutes() {
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/kirtan" replace />} />
          <Route path="/kirtan" element={<SearchPage experience="kirtan" />} />
          <Route path="/katha" element={<SearchPage experience="katha" />} />
          <Route path="/bani" element={<BaniPage />} />
          <Route path="/bani/:id" element={<BaniPage />} />
          <Route path="/hukam" element={<HukamPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/remote" element={<RemoteControlPage />} />
          <Route path="/credits" element={<CreditsPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/search" element={<Navigate to="/kirtan" replace />} />
          <Route path="/listen" element={<Navigate to="/kirtan" replace />} />
          <Route path="/shabad/:id" element={<ShabadPage />} />
          <Route path="/ang/:ang" element={<AngPage />} />
          <Route path="*" element={<Navigate to="/kirtan" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function AppShell() {
  const location = useLocation();

  // Projector stays outside AppProvider because it passively receives
  // broadcasted state from the main app window.
  if (location.pathname === '/projector') {
    return (
      <Suspense fallback={<PageFallback label="Opening projector..." />}>
        <ProjectorPage />
      </Suspense>
    );
  }

  if (location.pathname.startsWith('/follow/')) {
    return (
      <Suspense fallback={<PageFallback label="Connecting to Sangat View..." />}>
        <Routes>
          <Route path="/follow/:code" element={<FollowPage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <AppProvider>
      <MainAppRoutes />
    </AppProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
