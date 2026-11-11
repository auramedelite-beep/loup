import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { audio } from '@/lib/audio';
import { useAuth } from './AuthContext';

export interface AppSettings {
  music: number;
  musicEnabled: boolean;
  sound: number;
  animations: boolean;
  notifications: boolean;
  reducedMotion: boolean;
  privacy: boolean;
}

interface SettingsContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  toggleMusic: () => void;
  save: () => Promise<void>;
  saving: boolean;
  requestNotifications: () => Promise<void>;
}

const STORAGE_KEY = 'lgdz.settings';

const DEFAULTS: AppSettings = {
  music: 0.3,
  musicEnabled: true,
  sound: 0.65,
  animations: true,
  notifications: false,
  reducedMotion: false,
  privacy: true,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStored(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Partial<AppSettings> = {};
    if (typeof parsed.music === 'number') next.music = Math.min(1, Math.max(0, parsed.music));
    if (typeof parsed.musicEnabled === 'boolean') next.musicEnabled = parsed.musicEnabled;
    if (typeof parsed.sound === 'number') next.sound = Math.min(1, Math.max(0, parsed.sound));
    if (typeof parsed.animations === 'boolean') next.animations = parsed.animations;
    if (typeof parsed.notifications === 'boolean') next.notifications = parsed.notifications;
    if (typeof parsed.reducedMotion === 'boolean') next.reducedMotion = parsed.reducedMotion;
    if (typeof parsed.privacy === 'boolean') next.privacy = parsed.privacy;
    return next;
  } catch {
    return {};
  }
}

function store(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}

function fromUserSettings(raw: Record<string, unknown> | undefined): Partial<AppSettings> {
  if (!raw) return {};
  const next: Partial<AppSettings> = {};
  if (typeof raw.music === 'number') next.music = Math.min(1, Math.max(0, raw.music));
  if (typeof raw.musicEnabled === 'boolean') next.musicEnabled = raw.musicEnabled;
  if (typeof raw.sound === 'number') next.sound = Math.min(1, Math.max(0, raw.sound));
  if (typeof raw.animations === 'boolean') next.animations = raw.animations;
  if (typeof raw.notifications === 'boolean') next.notifications = raw.notifications;
  if (typeof raw.reducedMotion === 'boolean') next.reducedMotion = raw.reducedMotion;
  if (typeof raw.privacy === 'boolean') next.privacy = raw.privacy;
  return next;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...DEFAULTS, ...readStored() }));
  const [saving, setSaving] = useState(false);
  const appliedUser = useRef<string | null>(null);

  // Merge account-level settings once per signed-in user.
  useEffect(() => {
    if (!user) {
      appliedUser.current = null;
      return;
    }
    if (appliedUser.current === user.id) return;
    appliedUser.current = user.id;
    const remote = fromUserSettings(user.settings);
    if (Object.keys(remote).length) {
      setSettings((current) => ({ ...current, ...remote }));
    }
  }, [user?.id]);

  useEffect(() => {
    audio.configure({
      sound: settings.sound,
      music: settings.music,
      enabled: !settings.reducedMotion,
      musicEnabled: settings.musicEnabled,
    });
    store(settings);
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', settings.reducedMotion || !settings.animations);
  }, [settings]);

  // Browsers require a user gesture before audio can start.
  useEffect(() => {
    let armed = true;
    const onGesture = () => {
      if (!armed) return;
      armed = false;
      audio.init();
      if (settings.musicEnabled && settings.music > 0 && !settings.reducedMotion) audio.startMusic();
    };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [settings.music, settings.musicEnabled, settings.reducedMotion]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const toggleMusic = useCallback(() => {
    const musicEnabled = !settings.musicEnabled;
    setSettings((current) => ({ ...current, musicEnabled }));
    audio.configure({
      music: settings.music,
      enabled: !settings.reducedMotion,
      musicEnabled,
    });
    if (musicEnabled && !settings.reducedMotion && settings.music > 0) {
      audio.init();
      audio.startMusic();
    } else {
      audio.stopMusic();
    }
  }, [settings.music, settings.musicEnabled, settings.reducedMotion]);

  const save = useCallback(async () => {
    store(settings);
    if (!user || user.isGuest) return;
    setSaving(true);
    try {
      await api('/api/profile/me', {
        method: 'PATCH',
        body: { settings, locale: 'ar', publicProfile: settings.privacy },
      });
    } finally {
      setSaving(false);
    }
  }, [settings, user]);

  const requestNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      update({ notifications: false });
      return;
    }
    if (Notification.permission === 'granted') {
      update({ notifications: true });
      return;
    }
    const permission = await Notification.requestPermission();
    update({ notifications: permission === 'granted' });
  }, [update]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, update, toggleMusic, save, saving, requestNotifications }),
    [settings, update, toggleMusic, save, saving, requestNotifications],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>');
  return context;
}
