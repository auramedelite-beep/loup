import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../db';
import { authenticate } from '../auth/middleware';
import { createNotification } from '../services/notifications';
import { findUserById, findUserByUsername, searchUsers } from '../services/users';
import { isOnline } from '../realtime/presence';

export const socialRouter = express.Router();
socialRouter.use(authenticate);

socialRouter.get('/friends', (req, res) => {
  const rows = all<{
    id: string;
    username: string;
    avatar: string;
    level: number;
    rating: number;
    last_seen: number;
  }>(
    `SELECT u.id, u.username, u.avatar, p.level, p.rating, u.last_seen
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE f.user_id = ?
     ORDER BY u.username COLLATE NOCASE ASC`,
    req.auth!.id,
  );
  res.json({
    friends: rows.map((r) => ({ ...r, online: isOnline(r.id) })),
  });
});

socialRouter.get('/requests', (req, res) => {
  const incoming = all<{ id: string; from_user_id: string; username: string; avatar: string; created_at: number }>(
    `SELECT fr.id, fr.from_user_id, u.username, u.avatar, fr.created_at
     FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id
     WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
    req.auth!.id,
  );
  const outgoing = all<{ id: string; to_user_id: string; username: string; avatar: string; created_at: number }>(
    `SELECT fr.id, fr.to_user_id, u.username, u.avatar, fr.created_at
     FROM friend_requests fr JOIN users u ON u.id = fr.to_user_id
     WHERE fr.from_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
    req.auth!.id,
  );
  res.json({ incoming, outgoing });
});

const requestSchema = z.object({ username: z.string().min(3).max(120) });

socialRouter.post('/requests', (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const target = findUserByUsername(parsed.data.username.trim());
  if (!target || target.is_guest) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  if (target.id === req.auth!.id) {
    res.status(400).json({ error: 'cannot_add_self' });
    return;
  }
  const blocked = get<{ c: number }>(
    'SELECT COUNT(*) as c FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
    req.auth!.id,
    target.id,
    target.id,
    req.auth!.id,
  )?.c;
  if (blocked) {
    res.status(403).json({ error: 'blocked' });
    return;
  }
  const already = get<{ c: number }>(
    'SELECT COUNT(*) as c FROM friendships WHERE user_id = ? AND friend_id = ?',
    req.auth!.id,
    target.id,
  )?.c;
  if (already) {
    res.status(409).json({ error: 'already_friends' });
    return;
  }
  const reverse = get<{ id: string }>(
    `SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
    target.id,
    req.auth!.id,
  );
  if (reverse) {
    acceptRequest(reverse.id, req.auth!.id);
    res.json({ ok: true, accepted: true });
    return;
  }
  const existing = get<{ id: string }>(
    `SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
    req.auth!.id,
    target.id,
  );
  if (existing) {
    res.status(409).json({ error: 'request_pending' });
    return;
  }
  const id = randomUUID();
  run(
    'INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    req.auth!.id,
    target.id,
    'pending',
    Date.now(),
  );
  createNotification(target.id, 'friend_request', {
    requestId: id,
    fromId: req.auth!.id,
    fromUsername: req.auth!.username,
  });
  res.status(201).json({ ok: true, id });
});

function acceptRequest(requestId: string, userId: string): boolean {
  const request = get<{ id: string; from_user_id: string; to_user_id: string; status: string }>(
    'SELECT * FROM friend_requests WHERE id = ?',
    requestId,
  );
  if (!request || request.to_user_id !== userId || request.status !== 'pending') return false;
  const now = Date.now();
  tx(() => {
    run('UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?', 'accepted', now, requestId);
    run(
      `INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, friend_id) DO NOTHING`,
      request.from_user_id,
      request.to_user_id,
      now,
    );
    run(
      `INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, friend_id) DO NOTHING`,
      request.to_user_id,
      request.from_user_id,
      now,
    );
  });
  createNotification(request.from_user_id, 'friend_accepted', { friendId: userId });
  return true;
}

socialRouter.post('/requests/:id/accept', (req, res) => {
  if (!acceptRequest(req.params.id, req.auth!.id)) {
    res.status(404).json({ error: 'request_not_found' });
    return;
  }
  res.json({ ok: true });
});

socialRouter.post('/requests/:id/decline', (req, res) => {
  const request = get<{ to_user_id: string; status: string }>('SELECT * FROM friend_requests WHERE id = ?', req.params.id);
  if (!request || request.to_user_id !== req.auth!.id || request.status !== 'pending') {
    res.status(404).json({ error: 'request_not_found' });
    return;
  }
  run('UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?', 'declined', Date.now(), req.params.id);
  res.json({ ok: true });
});

socialRouter.delete('/friends/:id', (req, res) => {
  tx(() => {
    run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', req.auth!.id, req.params.id);
    run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', req.params.id, req.auth!.id);
  });
  res.json({ ok: true });
});

socialRouter.get('/blocks', (req, res) => {
  const rows = all<{ id: string; username: string; avatar: string }>(
    `SELECT u.id, u.username, u.avatar FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ?`,
    req.auth!.id,
  );
  res.json({ blocks: rows });
});

socialRouter.post('/blocks/:id', (req, res) => {
  if (req.params.id === req.auth!.id) {
    res.status(400).json({ error: 'cannot_block_self' });
    return;
  }
  if (!findUserById(req.params.id)) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  tx(() => {
    run(
      'INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, blocked_id) DO NOTHING',
      req.auth!.id,
      req.params.id,
      Date.now(),
    );
    run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', req.auth!.id, req.params.id);
    run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', req.params.id, req.auth!.id);
  });
  res.json({ ok: true });
});

socialRouter.delete('/blocks/:id', (req, res) => {
  run('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?', req.auth!.id, req.params.id);
  res.json({ ok: true });
});

const reportSchema = z.object({
  targetId: z.string().min(1).max(80),
  reason: z.enum(['harassment', 'hate_speech', 'spam', 'cheating', 'inappropriate_name', 'other']),
  details: z.string().max(1000).optional(),
  roomId: z.string().max(80).optional(),
});

socialRouter.post('/reports', (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  if (parsed.data.targetId === req.auth!.id) {
    res.status(400).json({ error: 'cannot_report_self' });
    return;
  }
  if (!findUserById(parsed.data.targetId)) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const id = randomUUID();
  run(
    `INSERT INTO reports (id, reporter_id, target_id, room_id, reason, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    id,
    req.auth!.id,
    parsed.data.targetId,
    parsed.data.roomId ?? null,
    parsed.data.reason,
    parsed.data.details ?? null,
    Date.now(),
  );
  const admins = all<{ id: string }>("SELECT id FROM users WHERE role = 'admin'");
  for (const admin of admins) {
    createNotification(admin.id, 'report_created', { reportId: id, targetId: parsed.data.targetId });
  }
  res.status(201).json({ ok: true, id });
});

socialRouter.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) {
    res.json({ users: [] });
    return;
  }
  const blocked = new Set(
    all<{ id: string }>(
      'SELECT blocked_id as id FROM blocks WHERE user_id = ?',
      req.auth!.id,
    ).map((r) => r.id),
  );
  const users = searchUsers(q, 15).filter((u) => u.id !== req.auth!.id && !blocked.has(u.id));
  res.json({ users });
});

socialRouter.get('/recent', (req, res) => {
  const rows = all<{ id: string; username: string; avatar: string; last_played: number }>(
    `SELECT u.id, u.username, u.avatar, MAX(g.ended_at) as last_played
     FROM game_players me
     JOIN games g ON g.id = me.game_id AND g.ended_at IS NOT NULL
     JOIN game_players other ON other.game_id = me.game_id AND other.user_id <> me.user_id
     JOIN users u ON u.id = other.user_id AND u.is_guest = 0
     WHERE me.user_id = ?
     GROUP BY u.id
     ORDER BY last_played DESC LIMIT 20`,
    req.auth!.id,
  );
  res.json({
    players: rows.map((r) => ({ ...r, online: isOnline(r.id) })),
  });
});

socialRouter.post('/invite', (req, res) => {
  const schema = z.object({ friendId: z.string().min(1), roomCode: z.string().min(3).max(12) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const isFriend = get<{ c: number }>(
    'SELECT COUNT(*) as c FROM friendships WHERE user_id = ? AND friend_id = ?',
    req.auth!.id,
    parsed.data.friendId,
  )?.c;
  if (!isFriend) {
    res.status(403).json({ error: 'not_friends' });
    return;
  }
  createNotification(parsed.data.friendId, 'room_invite', {
    fromId: req.auth!.id,
    fromUsername: req.auth!.username,
    roomCode: parsed.data.roomCode.toUpperCase(),
  });
  res.json({ ok: true });
});
