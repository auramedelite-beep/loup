import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { getSetting, get, run, tx } from '../db';
import { config } from '../config';
import { authenticate, optionalAuth } from '../auth/middleware';
import { signToken } from '../auth/jwt';
import { sendPasswordResetEmail, mailerConfigured } from '../services/mailer';
import {
  achievementsFor,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  isUserBanned,
  setPassword,
  toPublicUser,
  verifyPassword,
} from '../services/users';
import { unreadNotificationCount } from '../services/notifications';
import { isValidUsername, normalizeUsername, sha256 } from '../utils/validate';

export const authRouter = express.Router();

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

function authResponse(user: ReturnType<typeof findUserById>) {
  if (!user) throw new Error('user missing');
  return {
    token: signToken(user),
    user: toPublicUser(user),
  };
}

const GOOGLE_STATE_COOKIE = 'lgdz_google_state';
const GOOGLE_STATE_TTL = 10 * 60 * 1000;
const GOOGLE_CODE_TTL = 2 * 60 * 1000;
const googleStates = new Map<string, { next: string; expiresAt: number }>();
const googleCodes = new Map<string, { auth: ReturnType<typeof authResponse>; expiresAt: number }>();

function safeNextPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/rooms';
}

function frontendRedirect(res: express.Response, path: string): void {
  res.redirect(302, new URL(path, config.clientOrigins[0]).toString());
}

function googleErrorRedirect(res: express.Response, error: string): void {
  const url = new URL('/auth/login', config.clientOrigins[0]);
  url.searchParams.set('google_error', error);
  frontendRedirect(res, `${url.pathname}${url.search}`);
}

function requestCookie(req: express.Request, name: string): string | null {
  const prefix = `${name}=`;
  const item = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return null;
  }
}

const googleCookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax' as const,
  path: '/api/auth/google',
};

function googleUsername(name: string | undefined): string {
  const normalized = normalizeUsername((name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '')).slice(0, 20);
  const base = isValidUsername(normalized) ? normalized : `Player-${randomBytes(3).toString('hex')}`;
  if (!findUserByUsername(base)) return base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base.slice(0, 14)}-${randomBytes(3).toString('hex')}`;
    if (isValidUsername(candidate) && !findUserByUsername(candidate)) return candidate;
  }
  return `Player-${randomBytes(4).toString('hex')}`;
}

authRouter.get('/google', (req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    googleErrorRedirect(res, 'google_not_configured');
    return;
  }
  const now = Date.now();
  for (const [state, attempt] of googleStates) {
    if (attempt.expiresAt <= now) googleStates.delete(state);
  }
  const state = randomBytes(32).toString('hex');
  googleStates.set(state, { next: safeNextPath(req.query.next), expiresAt: now + GOOGLE_STATE_TTL });
  res.cookie(GOOGLE_STATE_COOKIE, state, { ...googleCookieOptions, maxAge: GOOGLE_STATE_TTL });

  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();
  res.redirect(302, authorizationUrl.toString());
});

authRouter.get('/google/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const attempt = googleStates.get(state);
  googleStates.delete(state);
  res.clearCookie(GOOGLE_STATE_COOKIE, googleCookieOptions);
  if (!attempt || attempt.expiresAt <= Date.now() || requestCookie(req, GOOGLE_STATE_COOKIE) !== state) {
    googleErrorRedirect(res, 'google_state_invalid');
    return;
  }
  if (typeof req.query.error === 'string') {
    googleErrorRedirect(res, 'google_cancelled');
    return;
  }
  if (typeof req.query.code !== 'string') {
    googleErrorRedirect(res, 'google_failed');
    return;
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: config.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) throw new Error('google_token_exchange_failed');
    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (!tokenData.access_token) throw new Error('google_access_token_missing');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileResponse.ok) throw new Error('google_userinfo_failed');
    const profile = await profileResponse.json() as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!profile.sub || !profile.email || profile.email_verified !== true) {
      googleErrorRedirect(res, 'google_email_unverified');
      return;
    }

    const email = profile.email.trim().toLowerCase();
    let user = findUserByEmail(email);
    if (!user) {
      if (getSetting('registration_open', 'true') !== 'true') {
        googleErrorRedirect(res, 'registration_closed');
        return;
      }
      user = createUser({ username: googleUsername(profile.name), email, locale: 'ar', avatar: 'wolf' });
    }

    const ban = isUserBanned(user);
    if (ban.banned) {
      googleErrorRedirect(res, 'banned');
      return;
    }
    run('UPDATE users SET last_seen = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', Date.now(), user.id);
    const now = Date.now();
    for (const [code, exchange] of googleCodes) {
      if (exchange.expiresAt <= now) googleCodes.delete(code);
    }
    const code = randomBytes(32).toString('hex');
    googleCodes.set(code, { auth: authResponse(findUserById(user.id)), expiresAt: now + GOOGLE_CODE_TTL });
    const callbackUrl = new URL('/auth/google/callback', config.clientOrigins[0]);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('next', attempt.next);
    res.redirect(302, callbackUrl.toString());
  } catch (error) {
    console.error('[auth] Google sign-in failed', error);
    googleErrorRedirect(res, 'google_failed');
  }
});

authRouter.post('/google/exchange', authLimiter, (req, res) => {
  const parsed = z.object({ code: z.string().min(32).max(128) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const exchange = googleCodes.get(parsed.data.code);
  googleCodes.delete(parsed.data.code);
  if (!exchange || exchange.expiresAt <= Date.now()) {
    res.status(401).json({ error: 'google_code_invalid' });
    return;
  }
  res.json(exchange.auth);
});

authRouter.post('/register', authLimiter, (_req, res) => {
  res.status(403).json({ error: 'google_only' });
});

const loginSchema = z.object({
  identifier: z.string().min(3).max(120),
  password: z.string().min(1).max(128),
});

authRouter.post('/login', authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const identifier = parsed.data.identifier.trim();
  const user = identifier.includes('@') ? findUserByEmail(identifier) : findUserByUsername(identifier);
  if (!user || user.is_guest) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const now = Date.now();
  if (user.locked_until && user.locked_until > now) {
    res.status(423).json({ error: 'account_locked', until: user.locked_until });
    return;
  }
  const ban = isUserBanned(user);
  if (ban.banned) {
    res.status(403).json({ error: 'banned', reason: ban.reason, until: ban.until });
    return;
  }
  if (!verifyPassword(user, parsed.data.password)) {
    const failed = (user.failed_logins ?? 0) + 1;
    const lockedUntil = failed >= 5 ? now + 15 * 60 * 1000 : null;
    run(
      'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?',
      lockedUntil ? 0 : failed,
      lockedUntil,
      user.id,
    );
    res.status(401).json({ error: lockedUntil ? 'account_locked' : 'invalid_credentials' });
    return;
  }
  run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen = ? WHERE id = ?', now, user.id);
  res.json(authResponse(findUserById(user.id)));
});

const guestSchema = z.object({
  username: z.string().min(3).max(20).optional(),
  locale: z.literal('ar').optional(),
});

authRouter.post('/guest', authLimiter, (_req, res) => {
  res.status(403).json({ error: 'google_only' });
});

authRouter.get('/me', authenticate, (req, res) => {
  const user = findUserById(req.auth!.id);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({
    user: toPublicUser(user),
    achievements: achievementsFor(user.id),
    unreadNotifications: unreadNotificationCount(user.id),
  });
});

authRouter.post('/logout', optionalAuth, (req, res) => {
  if (req.auth && req.body?.allDevices === true) {
    run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', req.auth.id);
  }
  res.json({ ok: true });
});

const forgotSchema = z.object({ email: z.string().email().max(120) });

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const user = findUserByEmail(parsed.data.email.toLowerCase());
  let resetToken: string | undefined;
  if (user && !user.is_guest) {
    resetToken = randomBytes(32).toString('hex');
    const now = Date.now();
    tx(() => {
      run(
        'INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        randomUUID(),
        user.id,
        sha256(resetToken!),
        now + 30 * 60 * 1000,
        now,
      );
    });
    try {
      await sendPasswordResetEmail(parsed.data.email, user.username, resetToken);
    } catch (error) {
      console.error('[auth] failed to send reset email', error);
    }
  }
  res.json({
    ok: true,
    message: 'If the email exists, a reset link has been sent.',
    // Dev convenience only — never exposed in production.
    ...(process.env.NODE_ENV !== 'production' && resetToken ? { resetToken } : {}),
    mailerConfigured,
  });
});

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(128),
});

authRouter.post('/reset-password', authLimiter, (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const row = get<{ id: string; user_id: string; expires_at: number; used_at: number | null }>(
    'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?',
    sha256(parsed.data.token),
  );
  if (!row || row.used_at || row.expires_at < Date.now()) {
    res.status(400).json({ error: 'invalid_reset_token' });
    return;
  }
  setPassword(row.user_id, parsed.data.password);
  run('UPDATE password_resets SET used_at = ? WHERE id = ?', Date.now(), row.id);
  res.json({ ok: true });
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

authRouter.post('/change-password', authenticate, (req, res) => {
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const user = findUserById(req.auth!.id);
  if (!user || user.is_guest) {
    res.status(400).json({ error: 'guest_account' });
    return;
  }
  if (!verifyPassword(user, parsed.data.currentPassword)) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  setPassword(user.id, parsed.data.newPassword);
  res.json(authResponse(findUserById(user.id)));
});
