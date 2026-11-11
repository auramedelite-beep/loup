import { Navigate, Route, Routes, NavLink } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingBlock, Spinner } from '@/components/ui';
import { AppLayout } from '@/components/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { AuthPage, GoogleAuthCallbackPage } from '@/pages/AuthPage';
import { RoomsPage } from '@/pages/RoomsPage';
import { RoomPage } from '@/pages/RoomPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { HowToPlayPage } from '@/pages/HowToPlayPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/* ── Routes ──────────────────────────────────────────────────────────────── */
const routes = [
  { path: '/', element: <HomePage /> },
  { path: '/auth/login', element: <AuthPage mode="login" /> },
  { path: '/auth/register', element: <Navigate to="/auth/login" replace /> },
  { path: '/auth/guest', element: <Navigate to="/auth/login" replace /> },
  { path: '/auth/forgot', element: <AuthPage mode="forgot" /> },
  { path: '/auth/reset', element: <AuthPage mode="reset" /> },
  { path: '/auth/google/callback', element: <GoogleAuthCallbackPage /> },
  { path: '/rooms', element: <RoomsPage /> },
  { path: '/room/:code', element: <RoomPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/how-to-play', element: <HowToPlayPage /> },
  { path: '/admin', element: <div>لوحة الإدارة</div>, isAdmin: true },
];

/* ── Main App ──────────────────────────────────────────────────────────── */
export function App() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const { t } = useTranslation();

  /* ── Service Worker ───────────────────────────────────────────────────── */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  /* ── Set dir/lang for RTL ─────────────────────────────────────────────── */
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('dir', 'rtl');
    html.setAttribute('lang', 'ar');
  }, []);

  /* ── Render ──────────────────────────────────────────────────────────── */
  if (authLoading) {
    return <LoadingBlock label={t('common.loading')} />;
  }

  return (
    <AppLayout>
        <nav className="hidden sm:flex items-center gap-0.5 lg:flex">
          {/* Quick nav links */}
          <NavLink to="/rooms" className="text-mist hover:text-gold-300">
            {t('nav.rooms')}
          </NavLink>
          <NavLink to="/how-to-play" className="text-mist hover:text-gold-300">
            {t('nav.howTo')}
          </NavLink>
          {isAdmin && <NavLink to="/admin" className="text-mist hover:text-gold-300">
            {t('nav.admin')}
          </NavLink>}
        </nav>

        <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-5 sm:py-8">
          <Routes>
            {routes.map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={route.isAdmin && !isAdmin ? <NotFoundPage /> : route.element}
              />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        {/* Chat panel in footer */}
        <div className="sr-only">
          <Spinner />
        </div>
    </AppLayout>
  );
}