import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingBlock } from '@/components/ui';
import { AppLayout } from '@/components/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { HomePage } from '@/pages/HomePage';
import { AuthPage, GoogleAuthCallbackPage } from '@/pages/AuthPage';
import { RoomsPage } from '@/pages/RoomsPage';
import { RoomPage } from '@/pages/RoomPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { FriendsPage } from '@/pages/FriendsPage';
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
  { path: '/profile', element: <ProfilePage /> },
  { path: '/profile/:id', element: <ProfilePage /> },
  { path: '/friends', element: <FriendsPage /> },
  { path: '/how-to-play', element: <HowToPlayPage /> },
  { path: '/admin', element: <div>لوحة الإدارة</div>, isAdmin: true },
];

/* ── Main App ──────────────────────────────────────────────────────────── */
export function App() {
  const navigate = useNavigate();
  const { user, loading: authLoading, isAdmin } = useAuth();
  const { t } = useTranslation();

  /* ── Service Worker ───────────────────────────────────────────────────── */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void (async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setBackgroundColor({ color: '#0b0b12' });
        await StatusBar.setStyle({ style: Style.Dark });
      } catch (error) {
        console.error('[android] Failed to configure system status bar', error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let lastUrl = '';
    let removeUrlListener: (() => Promise<void>) | undefined;
    const handleAppUrl = (rawUrl: string) => {
      if (rawUrl === lastUrl) return;
      lastUrl = rawUrl;

      try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'dz.loupgarou.game:' || url.hostname !== 'auth') return;

        if (url.pathname === '/google/callback') {
          const code = url.searchParams.get('code');
          if (!code) {
            navigate('/auth/login?google_error=google_code_invalid', { replace: true });
          } else {
            const callback = new URLSearchParams({ code });
            callback.set('next', url.searchParams.get('next') ?? '/rooms');
            navigate(`/auth/google/callback?${callback.toString()}`, { replace: true });
          }
        } else if (url.pathname === '/login') {
          const error = url.searchParams.get('google_error');
          navigate(error ? `/auth/login?google_error=${encodeURIComponent(error)}` : '/auth/login', {
            replace: true,
          });
        }

        void Browser.close().catch((error: unknown) =>
          console.error('[auth] Failed to close Google sign-in browser', error),
        );
      } catch (error) {
        console.error('[auth] Invalid app callback URL', error);
      }
    };

    void CapacitorApp.addListener('appUrlOpen', ({ url }) => handleAppUrl(url))
      .then((listener) => {
        if (disposed) {
          void listener.remove();
          return;
        }
        removeUrlListener = () => listener.remove();
      })
      .catch((error: unknown) => console.error('[auth] Failed to register app URL handler', error));

    void CapacitorApp.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) handleAppUrl(launch.url);
      })
      .catch((error: unknown) => console.error('[auth] Failed to read app launch URL', error));

    return () => {
      disposed = true;
      if (removeUrlListener) {
        void removeUrlListener().catch((error: unknown) =>
          console.error('[auth] Failed to remove app URL handler', error),
        );
      }
    };
  }, [navigate]);

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
      <Routes>
        {routes.map((route) => {
          const element = route.isAdmin && !isAdmin ? <NotFoundPage /> : route.element;
          return (
            <Route
              key={route.path}
              path={route.path}
              element={
                route.path === '/settings' || route.path.startsWith('/profile') || route.path === '/friends' ? (
                  <ProtectedRoute>{element}</ProtectedRoute>
                ) : (
                  element
                )
              }
            />
          );
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  );
}