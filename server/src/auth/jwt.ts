import jwt from 'jsonwebtoken';
import { config } from '../config';
import { findUserById, isUserBanned, type UserRow } from '../services/users';

export interface TokenPayload {
  sub: string;
  username: string;
  role: 'player' | 'admin';
  guest: boolean;
  ver: number;
}

export function signToken(user: UserRow): string {
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    guest: Boolean(user.is_guest),
    ver: user.token_version,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export type ResolveTokenResult =
  | { ok: true; user: UserRow }
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
  const ban = isUserBanned(user);
  if (ban.banned) return { ok: false, error: 'banned', reason: ban.reason, until: ban.until };
  return { ok: true, user };
}

export function tokenFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
