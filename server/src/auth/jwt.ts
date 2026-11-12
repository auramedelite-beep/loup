import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { get, run } from '../db';
import { config } from '../config';
import { findUserById, isUserBanned, type UserRow } from '../services/users';

export interface TokenPayload {
  sub: string;
  username: string;
  role: 'player' | 'admin';
  guest: boolean;
  ver: number;
  sid?: string;
}

export function signToken(user: UserRow): string {
  const sessionId = randomUUID();
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    guest: Boolean(user.is_guest),
    ver: user.token_version,
    sid: sessionId,
  };
  const token = jwt.sign(payload, config.jwtSecret);
  run('INSERT INTO auth_sessions (id, user_id, created_at) VALUES (?, ?, ?)', sessionId, user.id, Date.now());
  return token;
}

export type ResolveTokenResult =
  | { ok: true; user: UserRow; sessionId: string | null }
  | { ok: false; error: 'invalid' | 'banned'; reason?: string | null; until?: number | null };

export function resolveToken(token: string | null | undefined): ResolveTokenResult {
  if (!token) return { ok: false, error: 'invalid' };
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!payload?.sub) return { ok: false, error: 'invalid' };
  const user = findUserById(payload.sub);
  if (!user) return { ok: false, error: 'invalid' };
  if (user.token_version !== payload.ver) return { ok: false, error: 'invalid' };
  if (payload.sid) {
    const session = get<{ user_id: string }>('SELECT user_id FROM auth_sessions WHERE id = ?', payload.sid);
    if (!session || session.user_id !== user.id) return { ok: false, error: 'invalid' };
  }
  const ban = isUserBanned(user);
  if (ban.banned) return { ok: false, error: 'banned', reason: ban.reason, until: ban.until };
  return { ok: true, user, sessionId: payload.sid ?? null };
}

export function revokeSession(sessionId: string): void {
  run('DELETE FROM auth_sessions WHERE id = ?', sessionId);
}

export function revokeUserSessions(userId: string): void {
  run('DELETE FROM auth_sessions WHERE user_id = ?', userId);
}

export function tokenFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
