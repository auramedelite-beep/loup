import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { all, get, int, run } from '../db';
import { authenticate } from '../auth/middleware';
import {
  achievementsFor,
  findUserById,
  getProfile,
  listAchievements,
  toPublicUser,
} from '../services/users';
import { gameHistoryFor, leaderboard } from '../services/stats';
import { notificationsFor, unreadNotificationCount } from '../services/notifications';
import { parseSettings } from '../services/users';

export const profileRouter = express.Router();
profileRouter.use(authenticate);

const AVATARS = new Set(['wolf', 'moon', 'owl', 'raven', 'skull', 'candle', 'rose', 'dagger', 'crown', 'fog']);

profileRouter.get('/me', (req, res) => {
  const user = findUserById(req.auth!.id);
  if (!user) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({
    user: toPublicUser(user),
    achievements: achievementsFor(user.id),
    allAchievements: listAchievements(),
    history: gameHistoryFor(user.id),
    notifications: notificationsFor(user.id),
    unreadNotifications: unreadNotificationCount(user.id),
  });
});

profileRouter.get('/leaderboard', (_req, res) => {
  res.json({ players: leaderboard(50) });
});

profileRouter.get('/history', (req, res) => {
  res.json({ games: gameHistoryFor(req.auth!.id, 40) });
});

const updateSchema = z.object({
  avatar: z.string().max(30).optional(),
  locale: z.literal('ar').optional(),
  settings: z.record(z.unknown()).optional(),
  publicProfile: z.boolean().optional(),
  username: z.string().min(3).max(20).optional(),
});

const updateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

profileRouter.patch('/me', updateLimiter, (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const user = findUserById(req.auth!.id);
  if (!user) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const data = parsed.data;
  if (data.username && data.username.trim() !== user.username) {
    if (user.is_guest) {
      res.status(400).json({ error: 'guest_username_locked' });
      return;
    }
    const taken = get<{ id: string }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', data.username.trim());
    if (taken) {
      res.status(409).json({ error: 'username_taken' });
      return;
    }
    run('UPDATE users SET username = ? WHERE id = ?', data.username.trim(), user.id);
  }
  if (data.avatar && AVATARS.has(data.avatar)) {
    run('UPDATE users SET avatar = ? WHERE id = ?', data.avatar, user.id);
  }
  if (data.locale) {
    run('UPDATE users SET locale = ? WHERE id = ?', data.locale, user.id);
  }
  if (data.settings) {
    const allowed: Record<string, unknown> = {};
    for (const key of [
      'music',
      'musicEnabled',
      'sound',
      'animations',
      'notifications',
      'reducedMotion',
      'language',
      'privacy',
    ]) {
      if (typeof data.settings[key] !== 'undefined') allowed[key] = data.settings[key];
    }
    const merged = { ...parseSettings(user.settings_json), ...allowed };
    run('UPDATE users SET settings_json = ? WHERE id = ?', JSON.stringify(merged), user.id);
  }
  if (typeof data.publicProfile === 'boolean') {
    run('UPDATE profiles SET public_profile = ? WHERE user_id = ?', int(data.publicProfile), user.id);
  }
  const updated = findUserById(user.id);
  res.json({ user: toPublicUser(updated!) });
});

profileRouter.post('/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string') : undefined;
  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders})`,
      Date.now(),
      req.auth!.id,
      ...ids,
    );
  } else {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', Date.now(), req.auth!.id);
  }
  res.json({ ok: true });
});

profileRouter.get('/notifications/list', (req, res) => {
  res.json({
    notifications: notificationsFor(req.auth!.id),
    unread: unreadNotificationCount(req.auth!.id),
  });
});

// Keep this catch-all last so it never shadows the static routes above.
profileRouter.get('/:id', (req, res) => {
  const target = findUserById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const targetProfile = getProfile(target.id);
  const isSelf = target.id === req.auth!.id;
  const isFriend = Boolean(
    get<{ c: number }>('SELECT COUNT(*) as c FROM friendships WHERE user_id = ? AND friend_id = ?', req.auth!.id, target.id)?.c,
  );
  if (!isSelf && targetProfile && !targetProfile.public_profile && !isFriend) {
    const publicUser = toPublicUser(target, true);
    res.json({
      user: {
        id: publicUser.id,
        username: publicUser.username,
        avatar: publicUser.avatar,
        isGuest: publicUser.isGuest,
        private: true,
      },
    });
    return;
  }
  res.json({
    user: { ...toPublicUser(target), private: false },
    achievements: achievementsFor(target.id),
    isFriend,
  });
});
