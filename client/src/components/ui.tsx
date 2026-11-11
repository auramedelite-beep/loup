import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCountdown } from '@/hooks/useCountdown';
import { formatClock } from '@/lib/format';

/* ── Spinner ─────────────────────────────────────────────────────────────── */

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="loading"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-mist">
      <Spinner size={28} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/* ── Timer ring ──────────────────────────────────────────────────────────── */

export function TimerRing({
  endsAt,
  serverNow,
  total,
  size = 68,
  className = '',
}: {
  endsAt: number | null | undefined;
  serverNow?: number | null;
  total: number;
  size?: number;
  className?: string;
}) {
  const remaining = useCountdown(endsAt, serverNow);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const offset = circumference * (1 - ratio);
  const urgent = remaining <= 10 && remaining > 0;
  const stroke = urgent ? '#e23b50' : remaining <= 25 ? '#e8c96a' : '#d4af37';

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label={formatClock(remaining)}
    >
      <svg viewBox="0 0 64 64" className="timer-ring h-full w-full">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.4s linear, stroke 0.3s ease',
            filter: urgent ? 'drop-shadow(0 0 6px rgba(226,59,80,0.6))' : 'drop-shadow(0 0 4px rgba(212,175,55,0.35))',
          }}
        />
      </svg>
      <span
        className={`absolute text-[13px] font-semibold tabular-nums ${urgent ? 'text-blood-400' : 'text-parchment-100'}`}
      >
        {formatClock(remaining)}
      </span>
    </div>
  );
}

/* ── Toggle ──────────────────────────────────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`toggle ${checked ? 'toggle-on' : ''} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/* ── Modal ───────────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={`card safe-bottom my-0 w-full ${widths[size]} max-h-[92vh] overflow-y-auto rounded-b-none sm:my-6 sm:rounded-3xl`}
          >
            <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/[0.06] bg-ink-900/95 px-5 py-4 backdrop-blur-xl">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="font-display text-lg font-semibold text-parchment-100">
                  {title}
                </h2>
                {subtitle && <p className="mt-1 text-sm text-mist">{subtitle}</p>}
              </div>
              <button type="button" onClick={onClose} className="btn-icon h-9 w-9 shrink-0" aria-label="close">
                <X size={17} />
              </button>
            </div>
            <div className="px-5 py-5">{children}</div>
            {footer && (
              <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-white/[0.06] bg-ink-900/95 px-5 py-4 backdrop-blur-xl">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ── Confirm ─────────────────────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => void onConfirm()}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-parchment-300">{message}</p>
    </Modal>
  );
}

/* ── Page header ─────────────────────────────────────────────────────────── */

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-bold leading-tight text-parchment-100 sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Stat tile ───────────────────────────────────────────────────────────── */

export function StatTile({
  icon,
  label,
  value,
  hint,
  accent = 'gold',
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: 'gold' | 'blood' | 'emerald' | 'violet';
}) {
  const accents = {
    gold: 'text-gold-400 border-gold-500/20',
    blood: 'text-blood-400 border-blood-500/20',
    emerald: 'text-emerald-300 border-emerald-500/20',
    violet: 'text-purple-300 border-purple-500/20',
  };
  return (
    <div className="stat-tile text-start">
      <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-white/[0.03] ${accents[accent]}`}>
        {icon}
      </div>
      <p className="font-display text-2xl font-bold tabular-nums text-parchment-100">{value}</p>
      <p className="mt-0.5 text-xs text-mist">{label}</p>
      {hint && <p className="mt-1 text-[11px] text-mist/70">{hint}</p>}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-12 text-center">
      {icon && <div className="text-4xl opacity-70">{icon}</div>}
      <h3 className="font-display text-lg font-semibold text-parchment-100">{title}</h3>
      {text && <p className="max-w-md text-sm leading-relaxed text-mist">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ── Progress bar ────────────────────────────────────────────────────────── */

export function ProgressBar({
  value,
  max,
  className = '',
  tone = 'gold',
}: {
  value: number;
  max: number;
  className?: string;
  tone?: 'gold' | 'blood' | 'emerald';
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const tones = {
    gold: 'from-gold-300 to-gold-600',
    blood: 'from-blood-400 to-blood-700',
    emerald: 'from-emerald-300 to-emerald-600',
  };
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`}>
      <div
        className={`h-full rounded-full bg-gradient-to-r ${tones[tone]} transition-[width] duration-500`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/* ── Section heading ─────────────────────────────────────────────────────── */

export function SectionHeading({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-gold-400">{icon}</span>}
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-parchment-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-mist">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ── Field ───────────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error">{error}</p>
      ) : (
        hint && <p className="mt-1 text-[11px] leading-relaxed text-mist/80">{hint}</p>
      )}
    </div>
  );
}
