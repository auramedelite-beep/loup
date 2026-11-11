import { createHash } from 'node:crypto';

const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{2,19}$/u;
const RESERVED = new Set(['admin', 'system', 'moderator', 'support', 'loupgarou', 'server', 'root']);

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username) && !RESERVED.has(username.toLowerCase());
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/\s+/g, ' ');
}

const BLOCKED_WORDS = [
  // A deliberately small moderation baseline. Expand via admin/moderation policy.
  'kys',
  'nazi',
  'hitler',
  'rape',
];

export function cleanChatBody(input: unknown, max = 400): string {
  if (typeof input !== 'string') return '';
  const stripped = input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r/g, '')
    .trim();
  let body = stripped.slice(0, max);
  for (const word of BLOCKED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    body = body.replace(re, '*'.repeat(word.length));
  }
  return body;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
