import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useSettings } from '@/contexts/SettingsContext';
import { api, errorCode } from '@/lib/api';
import type { NotificationItem } from '@/types';

interface NotificationResponse {
  notifications: NotificationItem[];
  unread: number;
}

export function NotificationCenter() {
  const { t } = useTranslation();
  const { user, setUnreadNotifications } = useAuth();
  const { settings, requestNotifications } = useSettings();
  const toast = useToast();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, right: 8 });

  const loadNotifications = useCallback(async () => {
    try {
      const result = await api<NotificationResponse>('/api/profile/notifications/list');
      const fresh = result.notifications.filter((item) => !seenIds.current.has(item.id));
      if (initialized.current) {
        for (const item of fresh.reverse()) {
          const message = t(`notifications.${item.type}`, {
            ...item.payload,
            defaultValue: t('notifications.system'),
          });
          toast.info(message);
          if (settings.notifications && Capacitor.isNativePlatform()) {
            try {
              const permission = await LocalNotifications.checkPermissions();
              if (permission.display === 'granted') {
                await LocalNotifications.schedule({
                  notifications: [
                    {
                      id: (Date.now() % 2_147_483_647) || 1,
                      title: 'LOUP-GAROU DZ',
                      body: message,
                      schedule: { at: new Date(Date.now() + 1000) },
                    },
                  ],
                });
              }
            } catch (notificationError) {
              console.error('[notifications] Failed to display Android notification', notificationError);
              toast.error(t('notifications.permissionError'));
            }
          } else if (
            settings.notifications &&
            !Capacitor.isNativePlatform() &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted'
          ) {
            try {
              new Notification(t('notifications.title'), { body: message, icon: '/icon.svg' });
            } catch (notificationError) {
              console.error('[notifications] Failed to display browser notification', notificationError);
            }
          }
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
  }, [setUnreadNotifications, settings.notifications, t, toast]);

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
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPanelPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
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
  const enableNotifications = async () => {
    try {
      const granted = await requestNotifications();
      toast.info(t(granted ? 'notifications.permissionGranted' : 'notifications.permissionDenied'));
    } catch (permissionError) {
      console.error('[notifications] Failed to request permission', permissionError);
      toast.error(t('notifications.permissionError'));
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="btn-icon relative"
        onClick={() => {
          if (!open) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) setPanelPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
          }
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

      {open && createPortal(
        <section
          ref={panelRef}
          id="notification-panel"
          data-back-dismiss="true"
          className="notification-panel card-tight flex flex-col overflow-hidden shadow-card"
          style={{ top: panelPosition.top, right: panelPosition.right }}
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
          {!settings.notifications && (
            <div className="border-b border-white/[0.06] px-3 py-2.5">
              <button type="button" className="btn-primary w-full text-xs" onClick={() => void enableNotifications()}>
                <Bell size={14} />
                {t('notifications.enable')}
              </button>
            </div>
          )}
          {error && (
            <p className="px-3 py-2 text-xs text-blood-300" role="alert">
              {t(`errors.${error}`, { defaultValue: t('errors.unknown_error') })}
            </p>
          )}
          <ul className="min-h-0 flex-1 divide-y divide-white/[0.05] overflow-y-auto overscroll-contain">
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
        </section>,
        document.body,
      )}
    </div>
  );
}
