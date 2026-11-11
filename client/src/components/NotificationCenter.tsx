import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { api, errorCode } from '@/lib/api';
import type { NotificationItem } from '@/types';

interface NotificationResponse {
  notifications: NotificationItem[];
  unread: number;
}

export function NotificationCenter() {
  const { t } = useTranslation();
  const { user, setUnreadNotifications } = useAuth();
  const toast = useToast();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const result = await api<NotificationResponse>('/api/profile/notifications/list');
      const fresh = result.notifications.filter((item) => !seenIds.current.has(item.id));
      if (initialized.current) {
        for (const item of fresh.reverse()) {
          toast.info(
            t(`notifications.${item.type}`, {
              ...item.payload,
              defaultValue: t('notifications.system'),
            }),
          );
        }
      }
      seenIds.current = new Set(result.notifications.map((item) => item.id));
      initialized.current = true;
      setNotifications(result.notifications);
      setUnreadNotifications(result.unread);
      setError(null);
    } catch (loadError) {
      console.error('[notifications] Failed to load notifications', loadError);
      setError(errorCode(loadError));
    }
  }, [setUnreadNotifications, t, toast]);

  useEffect(() => {
    if (!user || user.isGuest) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }

    seenIds.current = new Set();
    initialized.current = false;
    void loadNotifications();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifications();
    }, 20_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadNotifications();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadNotifications, setUnreadNotifications, user?.id, user?.isGuest]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markRead = async (ids?: string[]) => {
    try {
      await api('/api/profile/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
      const readAt = Date.now();
      setNotifications((current) =>
        current.map((item) => (!ids || ids.includes(item.id) ? { ...item, readAt } : item)),
      );
      setUnreadNotifications(
        ids ? Math.max(0, notifications.filter((item) => !item.readAt && !ids.includes(item.id)).length) : 0,
      );
      setError(null);
    } catch (markError) {
      console.error('[notifications] Failed to mark notifications as read', markError);
      setError(errorCode(markError));
    }
  };

  if (!user || user.isGuest) return null;

  const unread = notifications.filter((item) => !item.readAt).length;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="btn-icon relative"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void loadNotifications();
        }}
        aria-label={`${t('notifications.title')}${unread ? ` (${unread})` : ''}`}
        aria-expanded={open}
        aria-controls="notification-panel"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -end-1 -top-1 min-w-4 rounded-full bg-blood-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <section
          id="notification-panel"
          data-back-dismiss="true"
          className="card-tight absolute end-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden shadow-card"
          aria-label={t('notifications.title')}
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
            <h2 className="text-sm font-bold text-parchment-100">{t('notifications.title')}</h2>
            {unread > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-gold-300 hover:text-gold-200"
                onClick={() => void markRead()}
              >
                <CheckCheck size={14} />
                {t('notifications.markRead')}
              </button>
            )}
          </div>
          {error && (
            <p className="px-3 py-2 text-xs text-blood-300" role="alert">
              {t(`errors.${error}`, { defaultValue: t('errors.unknown_error') })}
            </p>
          )}
          <ul className="max-h-80 divide-y divide-white/[0.05] overflow-y-auto">
            {notifications.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-mist">{t('notifications.empty')}</li>
            ) : (
              notifications.map((item) => (
                <li key={item.id} className={`flex items-start gap-2 px-3 py-2.5 ${item.readAt ? 'opacity-65' : ''}`}>
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-parchment-200">
                    {t(`notifications.${item.type}`, {
                      ...item.payload,
                      defaultValue: t('notifications.system'),
                    })}
                    <time className="mt-1 block text-[10px] text-mist/70" dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString('ar')}
                    </time>
                  </p>
                  {!item.readAt && (
                    <button
                      type="button"
                      className="rounded p-1 text-mist hover:text-gold-300"
                      aria-label={t('notifications.markRead')}
                      title={t('notifications.markRead')}
                      onClick={() => void markRead([item.id])}
                    >
                      <Check size={14} />
                    </button>
                  )}
                </li>
              ))
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
