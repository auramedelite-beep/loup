import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Bell, Check, Info, X, type LucideIcon } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, LucideIcon> = {
  info: Info,
  success: Check,
  error: AlertCircle,
  warning: Bell,
};

const STYLES: Record<ToastKind, string> = {
  info: 'border-white/10 bg-ink-800/95 text-parchment-100',
  success: 'border-emerald-500/30 bg-emerald-950/90 text-emerald-100',
  error: 'border-blood-500/40 bg-blood-900/90 text-red-100',
  warning: 'border-gold-500/35 bg-ink-800/95 text-gold-200',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-3), { id, kind, message }]);
      window.setTimeout(() => remove(id), kind === 'error' ? 6000 : 4200);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
      warning: (message) => push(message, 'warning'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 sm:top-5">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.kind];
            return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur-xl ${STYLES[toast.kind]}`}
              role="status"
              onClick={() => remove(toast.id)}
            >
              <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="ms-1 text-xs opacity-50 transition-opacity hover:opacity-100"
                aria-label="close"
              >
                <X size={14} aria-hidden />
              </button>
            </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
