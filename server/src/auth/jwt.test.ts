import { afterAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = path.join(
  os.tmpdir(),
  `loupgarou-auth-test-${process.pid}-${Date.now()}.db`,
);
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.NODE_ENV = 'test';

const { closeDb, run } = await import('../db');
const { revokeSession, revokeUserSessions, resolveToken, signToken } = await import('./jwt');
const { createUser } = await import('../services/users');

const suffix = Math.random().toString(36).slice(2, 7);
let userCounter = 0;

function makeUser() {
  userCounter += 1;
  return createUser({
    username: `auth${suffix}${userCounter}`.slice(0, 20),
    isGuest: false,
  });
}

afterAll(() => {
  closeDb();
});

describe('persistent auth sessions', () => {
  it('creates a non-expiring token that remains valid until its session is revoked', () => {
    const user = makeUser();
    const token = signToken(user);

    expect(jwt.decode(token)).not.toHaveProperty('exp');
    expect(resolveToken(token).ok).toBe(true);
    const result = resolveToken(token);
    if (!result.ok || !result.sessionId) throw new Error('Expected a persistent session');
    revokeSession(result.sessionId);
    expect(resolveToken(token)).toEqual({ ok: false, error: 'invalid' });
  });

  it('accepts recently expired legacy tokens so /me can upgrade them to persistent sessions', () => {
    const user = makeUser();
    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        guest: Boolean(user.is_guest),
        ver: user.token_version,
      },
      process.env.JWT_SECRET!,
      { expiresIn: -24 * 60 * 60 },
    );

    const result = resolveToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionId).toBeNull();
  });

  it('rejects legacy tokens after the migration window and expired persistent tokens', () => {
    const user = makeUser();
    const legacyToken = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        guest: Boolean(user.is_guest),
        ver: user.token_version,
      },
      process.env.JWT_SECRET!,
      { expiresIn: -(31 * 24 * 60 * 60) },
    );
    const expiredSessionId = `expired-session-${suffix}`;
    run(
      'INSERT INTO auth_sessions (id, user_id, created_at) VALUES (?, ?, ?)',
      expiredSessionId,
      user.id,
      Date.now(),
    );
    const persistentToken = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        guest: Boolean(user.is_guest),
        ver: user.token_version,
        sid: expiredSessionId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: -24 * 60 * 60 },
    );

    expect(resolveToken(legacyToken)).toEqual({ ok: false, error: 'invalid' });
    expect(resolveToken(persistentToken)).toEqual({ ok: false, error: 'invalid' });
  });

  it('revokes one device session without signing out other devices', () => {
    const user = makeUser();
    const firstToken = signToken(user);
    const secondToken = signToken(user);
    const firstSession = resolveToken(firstToken);

    if (!firstSession.ok || !firstSession.sessionId) throw new Error('Expected a persistent session');
    revokeSession(firstSession.sessionId);

    expect(resolveToken(firstToken)).toEqual({ ok: false, error: 'invalid' });
    expect(resolveToken(secondToken).ok).toBe(true);
  });

  it('revokes all persistent sessions for a user', () => {
    const user = makeUser();
    const firstToken = signToken(user);
    const secondToken = signToken(user);

    revokeUserSessions(user.id);

    expect(resolveToken(firstToken)).toEqual({ ok: false, error: 'invalid' });
    expect(resolveToken(secondToken)).toEqual({ ok: false, error: 'invalid' });
  });
});
