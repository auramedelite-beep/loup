import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, getToken, setReconnect, setToken } from '@/lib/api';
import type { Achievement, PublicUser } from '@/types';

const USER_KEY = 'lgdz.user';

export interface AuthResult {
  token: string;
  user: PublicUser;
}

interface AuthContextValue {
  user: PublicUser | null;
  achievements: Achievement[];
  loading: boolean;
  unreadNotifications: number;
  login: (identifier: string, password: string) => Promise<void>;
  completeGoogleLogin: (code: string) => Promise<void>;
  logout: (allDevices?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (partial: Partial<PublicUser>) => void;
  setUnreadNotifications: (count: number) => void;
  isAdmin: boolean;
  token: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

function storeUser(user: PublicUser | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(() => (getToken() ? readStoredUser() : null));
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const applyAuth = useCallback((result: AuthResult) => {
    setToken(result.token);
    setTokenState(result.token);
    storeUser(result.user);
    setUser(result.user);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      storeUser(null);
      setTokenState(null);
      return;
    }
    try {
      const data = await api<{
        user: PublicUser;
        achievements: Achievement[];
        unreadNotifications: number;
        token?: string;
      }>('/api/auth/me');
      if (data.token) setToken(data.token);
      storeUser(data.user);
      setUser(data.user);
      setAchievements(data.achievements ?? []);
      setUnreadNotifications(data.unreadNotifications ?? 0);
      setTokenState(getToken());
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setToken(null);
        storeUser(null);
        setReconnect(null);
        setUser(null);
        setTokenState(null);
        setAchievements([]);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const result = await api<AuthResult>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { identifier, password },
      });
      applyAuth(result);
      await refresh();
    },
    [applyAuth, refresh],
  );

  const completeGoogleLogin = useCallback(
    async (code: string) => {
      const result = await api<AuthResult>('/api/auth/google/exchange', {
        method: 'POST',
        auth: false,
        body: { code },
      });
      applyAuth(result);
      await refresh();
    },
    [applyAuth, refresh],
  );

  const logout = useCallback(async (allDevices = false) => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: { allDevices }, auth: Boolean(getToken()) });
    } catch {
      /* logging out locally matters more than the network call */
    }
    setToken(null);
    storeUser(null);
    setReconnect(null);
    setUser(null);
    setTokenState(null);
    setAchievements([]);
    setUnreadNotifications(0);
  }, []);

  const updateUser = useCallback((partial: Partial<PublicUser>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...partial };
      storeUser(next);
      return next;
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      achievements,
      loading,
      unreadNotifications,
      login,
      completeGoogleLogin,
      logout,
      refresh,
      updateUser,
      setUnreadNotifications,
      isAdmin: user?.role === 'admin',
      token,
    }),
    [
      user,
      achievements,
      loading,
      unreadNotifications,
      login,
      completeGoogleLogin,
      logout,
      refresh,
      updateUser,
      token,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
