import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import {
  BookOpen,
  Crown,
  Home,
  LogIn,
  LogOut,
  Menu,
  Music2,
  Settings as SettingsIcon,
  Shield,
  Trophy,
  User as UserIcon,
  Users,
  VolumeX,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/contexts/SocketContext';
import { useToast } from '@/contexts/ToastContext';
import { useSettings } from '@/contexts/SettingsContext';
import { audio } from '@/lib/audio';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import { NotificationCenter } from './NotificationCenter';
import { AppUpdatePrompt } from './AppUpdatePrompt';
import { cn } from '@/lib/format';
import { APP_VERSION } from '@/lib/version';

const LINKS = [
  { to: '/', key: 'nav.home', icon: Home, end: true },
  { to: '/rooms', key: 'nav.rooms', icon: Users },
  { to: '/leaderboard', key: 'nav.leaderboard', icon: Trophy },
  { to: '/friends', key: 'nav.friends', icon: Users },
  { to: '/how-to-play', key: 'nav.howTo', icon: BookOpen },
];

function UserMenu() {
  const { t } = useTranslation();
  const { user, isAdmin, logout } = useAuth();
  const { settings, toggleMusic } = useSettings();
  const { room } = useSocket();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link to="/auth/login" className="btn-ghost btn-sm min-w-10 px-2 sm:px-3" aria-label={t('nav.login')}>
          <LogIn size={14} />
          <span className="hidden sm:inline">{t('nav.login')}</span>
        </Link>
      </div>
    );
  }

  const profile = user.profile;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1 pe-2.5 transition-colors hover:border-gold-500/40"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar avatar={user.avatar} size="sm" />
        <span className="hidden max-w-[120px] truncate text-xs font-semibold text-parchment-100 sm:block">
          {user.username}
        </span>
        <span className="hidden rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-bold text-gold-300 sm:block">
          {t('common.level')} {profile?.level ?? 1}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            role="menu"
            data-back-dismiss="true"
            className="card-tight absolute end-0 top-full z-50 mt-2 w-60 overflow-hidden p-1.5 shadow-card"
          >
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-2.5 pb-2.5 pt-1.5">
              <Avatar avatar={user.avatar} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-parchment-100">{user.username}</p>
                <p className="text-[11px] text-mist">
                  {profile ? `${profile.rating} ${t('common.rating')}` : t('common.guest')}
                </p>
              </div>
            </div>
            {!room && <SoundMenuItem enabled={settings.musicEnabled} onClick={toggleMusic} />}
            <MenuLink to={`/profile/${user.id}`} icon={<UserIcon size={15} />} onClick={() => setOpen(false)}>
              {t('nav.profile')}
            </MenuLink>
            <MenuLink to="/settings" icon={<SettingsIcon size={15} />} onClick={() => setOpen(false)}>
              {t('nav.settings')}
            </MenuLink>
            {isAdmin && (
              <MenuLink to="/admin" icon={<Shield size={15} />} onClick={() => setOpen(false)}>
                {t('nav.admin')}
              </MenuLink>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await logout();
                toast.info(t('auth.logoutConfirm'));
                navigate('/');
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-blood-400 transition-colors hover:bg-blood-900/30"
            >
              <LogOut size={15} />
              {t('nav.logout')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SoundMenuItem({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const Icon = enabled ? Music2 : VolumeX;

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      aria-pressed={enabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-parchment-200 transition-colors hover:bg-white/[0.06] hover:text-gold-300"
    >
      <Icon size={15} />
      {t(enabled ? 'settings.turnMusicOff' : 'settings.turnMusicOn')}
    </button>
  );
}

function MenuLink({
  to,
  icon,
  children,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-parchment-200 transition-colors hover:bg-white/[0.06] hover:text-gold-300"
    >
      {icon}
      {children}
    </Link>
  );
}

export function NavBar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { room, connected } = useSocket();
  const { settings, toggleMusic } = useSettings();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const wasInRoom = useRef(Boolean(room));
  const pathname = useRef(location.pathname);

  useEffect(() => {
    pathname.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const openOverlay = Array.from(
        document.querySelectorAll<HTMLElement>('[data-back-dismiss="true"], [role="dialog"]'),
      ).find((element) => element.getClientRects().length > 0);
      if (openOverlay) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      if (pathname.current !== '/') {
        if (canGoBack) navigate(-1);
        else navigate('/');
        return;
      }
      if (canGoBack) navigate(-1);
      else void CapacitorApp.exitApp();
    })
      .then((listener) => {
        if (disposed) {
          void listener.remove();
          return;
        }
        removeListener = () => listener.remove();
      })
      .catch((error: unknown) => console.error('[android] Failed to register back-button handler', error));

    return () => {
      disposed = true;
      if (removeListener) {
        void removeListener().catch((error: unknown) =>
          console.error('[android] Failed to remove back-button handler', error),
        );
      }
    };
  }, [navigate]);

  useEffect(() => {
    audio.setMusicAllowed(!room);
    if (!room && wasInRoom.current && settings.musicEnabled && !settings.reducedMotion && settings.music > 0) {
      audio.init();
      audio.startMusic();
    }
    wasInRoom.current = Boolean(room);
  }, [room, settings.music, settings.musicEnabled, settings.reducedMotion]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-2.5 sm:h-[62px] sm:gap-3 sm:px-5">
        <Link to="/" className="shrink-0" aria-label={t('common.appName')}>
          <Logo />
        </Link>

        <nav className="ms-3 hidden items-center gap-0.5 lg:flex" aria-label={t('nav.menu')}>
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                  isActive
                    ? 'bg-gold-500/10 text-gold-300'
                    : 'text-mist hover:bg-white/[0.04] hover:text-parchment-100',
                )
              }
            >
              <link.icon size={14} />
              {t(link.key)}
            </NavLink>
          ))}
        </nav>

        {room && (
          <Link
            to={`/room/${room.code}`}
            className="badge-live ms-auto hidden shrink-0 gap-1.5 sm:inline-flex"
            title={t('rooms.yourRoom')}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {room.code}
          </Link>
        )}

        <div className={cn('flex shrink-0 items-center gap-1.5 sm:gap-2', !room && 'ms-auto')}>
          <NotificationCenter />
          <span
            className={cn('hidden h-2 w-2 rounded-full sm:block', connected ? 'bg-emerald-400' : 'bg-blood-400')}
            title={connected ? t('common.online') : t('common.offline')}
          />
          <UserMenu />
          <button
            type="button"
            className="btn-icon lg:hidden"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={t('nav.menu')}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/[0.06] bg-ink-950/95 lg:hidden"
            aria-label={t('nav.menu')}
            data-back-dismiss="true"
          >
            <div className="grid grid-cols-2 gap-1.5 p-3">
              {LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium',
                      isActive ? 'bg-gold-500/10 text-gold-300' : 'text-parchment-200 hover:bg-white/[0.04]',
                    )
                  }
                >
                  <link.icon size={16} />
                  {t(link.key)}
                </NavLink>
              ))}
              {user && (
                <NavLink
                  to="/settings"
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-parchment-200 hover:bg-white/[0.04]"
                >
                  <SettingsIcon size={16} />
                  {t('nav.settings')}
                </NavLink>
              )}
              {!user && (
                <NavLink
                  to="/auth/login"
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-parchment-200 hover:bg-white/[0.04]"
                >
                  <LogIn size={16} />
                  {t('nav.login')}
                </NavLink>
              )}
              {!room && !user && (
                <SoundMenuItem
                  enabled={settings.musicEnabled}
                  onClick={toggleMusic}
                />
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="mt-10 border-t border-white/[0.05] py-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-center text-[11px] text-mist/70 sm:flex-row sm:text-start">
        <p>{t('home.footer')}</p>
        <p className="flex items-center gap-2">
          <span>LOUP-GAROU DZ</span>
          <span aria-hidden>·</span>
          <span>{t('common.version')} {APP_VERSION}</span>
        </p>
      </div>
    </footer>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="noise flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-gold-500 focus:px-3 focus:py-2 focus:text-ink-950"
      >
        تجاوز إلى المحتوى
      </a>
      <NavBar />
      <AppUpdatePrompt />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-2.5 py-4 sm:px-5 sm:py-8">
        {children ?? <Outlet />}
      </main>
      <Footer />
    </div>
  );
}
