export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  const seconds = Math.max(0, Math.round(totalSeconds ?? 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatClock(seconds: number): string {
  return formatDuration(Math.max(0, Math.ceil(seconds)));
}

export function formatNumber(value: number): string {
  try {
    return new Intl.NumberFormat().format(value);
  } catch {
    return String(value);
  }
}

export function timeAgo(timestamp: number, locale = 'en'): string {
  const delta = Math.round((Date.now() - timestamp) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(delta) < 60) return rtf.format(-delta, 'second');
  if (Math.abs(delta) < 3600) return rtf.format(-Math.round(delta / 60), 'minute');
  if (Math.abs(delta) < 86400) return rtf.format(-Math.round(delta / 3600), 'hour');
  return rtf.format(-Math.round(delta / 86400), 'day');
}

export function formatDate(timestamp: number, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shortMode(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
