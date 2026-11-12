import { randomUUID } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { all, get, int, run, tx } from '../db';
import { authenticate, requireAdmin } from '../auth/middleware';
import { roomManager } from '../game/rooms';
import { BASE_SETTINGS, ROLES, ROLE_IDS } from '../game/roles';
import { getSetting, setSetting } from '../db';
import { createNotification } from '../services/notifications';
import { isOnline } from '../realtime/presence';

export const adminRouter = express.Router();
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/overview', (_req, res) => {
  const totalUsers = get<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_guest = 0')?.c ?? 0;
  const guests = get<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_guest = 1')?.c ?? 0;
  const totalGames = get<{ c: number }>('SELECT COUNT(*) as c FROM games WHERE ended_at IS NOT NULL')?.c ?? 0;
  const gamesToday =
    get<{ c: number }>('SELECT COUNT(*) as c FROM games WHERE started_at > ?', Date.now() - 86_400_000)?.c ?? 0;
  const openReports = get<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE status IN ('open','reviewing')")?.c ?? 0;
  const bans = get<{ c: number }>(
    'SELECT COUNT(*) as c FROM users WHERE banned_until IS NOT NULL AND banned_until > ?',
    Date.now(),
  )?.c ?? 0;
  const metrics = roomManager.metrics();
  const online = all<{ id: string }>('SELECT id FROM users WHERE last_seen > ?', Date.now() - 5 * 60_000);
  res.json({
    users: { registered: totalUsers, guests, online: online.filter((u) => isOnline(u.id)).length },
    games: { total: totalGames, today: gamesToday },
    rooms: metrics,
    openReports,
    activeBans: bans,
    maintenance: getSetting('maintenance_mode', 'false') === 'true',
  });
});

adminRouter.get('/users', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(0, Number(req.query.page ?? 0) || 0);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const users = all<{
    id: string;
    username: string;
    avatar: string;
    role: string;
    is_guest: number;
    created_at: number;
    last_seen: number;
    banned_until: number | null;
    games_played: number;
    wins: number;
    rating: number;
    level: number;
  }>(
    `SELECT u.id, u.username, u.avatar, u.role, u.is_guest, u.created_at, u.last_seen, u.banned_until,
            p.games_played, p.wins, p.rating, p.level
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE (? = '' OR u.username LIKE ? COLLATE NOCASE)
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    q,
    like,
    limit,
    page * limit,
  );
  res.json({
    users: users.map((u) => ({ ...u, online: isOnline(u.id), banned: Boolean(u.banned_until && u.banned_until > Date.now()) })),
    page,
    limit,
  });
});

const banSchema = z.object({
  reason: z.string().min(2).max(300),
  durationHours: z.number().int().min(0).max(24 * 365).nullable().optional(),
});

adminRouter.post('/users/:id/ban', (req, res) => {
  if (req.params.id === req.auth!.id) {
    res.status(400).json({ error: 'cannot_ban_self' });
    return;
  }
  const parsed = banSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const user = get<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ?', req.params.id);
  if (!user) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  if (user.role === 'admin') {
    res.status(403).json({ error: 'cannot_ban_admin' });
    return;
  }
  const now = Date.now();
  const expiresAt = parsed.data.durationHours ? now + parsed.data.durationHours * 3_600_000 : null;
  tx(() => {
    run(
      'INSERT INTO bans (id, user_id, reason, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      randomUUID(),
      user.id,
      parsed.data.reason,
      expiresAt,
      req.auth!.id,
      now,
    );
    run(
      'UPDATE users SET banned_until = ?, ban_reason = ?, token_version = token_version + 1 WHERE id = ?',
      expiresAt,
      parsed.data.reason,
      user.id,
    );
    run('DELETE FROM auth_sessions WHERE user_id = ?', user.id);
  });
  roomManager.leaveQueue(user.id);
  roomManager.disconnectUser(user.id);
  res.json({ ok: true, expiresAt });
});

adminRouter.post('/users/:id/unban', (req, res) => {
  tx(() => {
    run('UPDATE bans SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', Date.now(), req.params.id);
    run('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?', req.params.id);
  });
  res.json({ ok: true });
});

const roleSchema = z.object({ role: z.enum(['player', 'admin']) });

adminRouter.post('/users/:id/role', (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const target = get<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ?', req.params.id);
  if (!target) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  if (target.role === 'admin' && parsed.data.role === 'player') {
    const admins = get<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE role = 'admin'")?.c ?? 0;
    if (admins <= 1) {
      res.status(400).json({ error: 'last_admin' });
      return;
    }
  }
  run('UPDATE users SET role = ? WHERE id = ?', parsed.data.role, req.params.id);
  res.json({ ok: true });
});

adminRouter.get('/rooms', (_req, res) => {
  res.json({ rooms: roomManager.allRoomsForAdmin() });
});

adminRouter.post('/rooms/:id/close', (req, res) => {
  roomManager.adminCloseRoom(req.params.id);
  res.json({ ok: true });
});

adminRouter.get('/reports', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const reports = all<{
    id: string;
    reporter_id: string | null;
    reporter_name: string | null;
    target_id: string | null;
    target_name: string | null;
    room_id: string | null;
    reason: string;
    details: string | null;
    status: string;
    created_at: number;
    resolution_note: string | null;
  }>(
    `SELECT r.*, rep.username as reporter_name, tgt.username as target_name
     FROM reports r
     LEFT JOIN users rep ON rep.id = r.reporter_id
     LEFT JOIN users tgt ON tgt.id = r.target_id
     WHERE (? = '' OR r.status = ?)
     ORDER BY r.created_at DESC LIMIT 100`,
    status,
    status,
  );
  res.json({ reports });
});

const resolveReportSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
  note: z.string().max(500).optional(),
  banTarget: z.boolean().optional(),
});

adminRouter.post('/reports/:id', (req, res) => {
  const parsed = resolveReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const report = get<{ id: string; target_id: string | null; status: string }>(
    'SELECT id, target_id, status FROM reports WHERE id = ?',
    req.params.id,
  );
  if (!report) {
    res.status(404).json({ error: 'report_not_found' });
    return;
  }
  run(
    'UPDATE reports SET status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE id = ?',
    parsed.data.status,
    req.auth!.id,
    Date.now(),
    parsed.data.note ?? null,
    report.id,
  );
  if (parsed.data.banTarget && report.target_id) {
    const now = Date.now();
    tx(() => {
      run(
        'INSERT INTO bans (id, user_id, reason, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        randomUUID(),
        report.target_id,
        `Report upheld: ${parsed.data.note ?? 'moderation decision'}`,
        null,
        req.auth!.id,
        now,
      );
      run(
        'UPDATE users SET banned_until = NULL, ban_reason = ?, token_version = token_version + 1 WHERE id = ?',
        `Report upheld: ${parsed.data.note ?? 'moderation decision'}`,
        report.target_id,
      );
      run('DELETE FROM auth_sessions WHERE user_id = ?', report.target_id);
    });
    roomManager.disconnectUser(report.target_id);
  }
  res.json({ ok: true });
});

adminRouter.get('/chat', (req, res) => {
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : '';
  const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : '';
  const messages = all(
    `SELECT * FROM chat_messages WHERE (? = '' OR room_id = ?) AND (? = '' OR game_id = ?)
     ORDER BY created_at DESC LIMIT 200`,
    roomId,
    roomId,
    gameId,
    gameId,
  );
  res.json({ messages });
});

adminRouter.delete('/chat/:id', (req, res) => {
  const row = get<{ id: string; room_id: string | null }>('SELECT id, room_id FROM chat_messages WHERE id = ?', req.params.id);
  if (!row) {
    res.status(404).json({ error: 'message_not_found' });
    return;
  }
  run('UPDATE chat_messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', Date.now(), req.auth!.id, row.id);
  roomManager.removeChatMessage(row.room_id, row.id);
  res.json({ ok: true });
});

adminRouter.get('/game-config', (_req, res) => {
  const stored = getSetting('game_config', '');
  let config: any = {};
  try {
    config = stored ? JSON.parse(stored) : {};
  } catch {
    config = {};
  }
  res.json({
    defaults: BASE_SETTINGS,
    roles: ROLE_IDS.map((id) => ({ ...ROLES[id] })),
    gameConfig: config,
  });
});

const gameConfigSchema = z.object({
  disabledRoles: z.array(z.string()).optional(),
  defaults: z.record(z.unknown()).optional(),
});

adminRouter.put('/game-config', (req, res) => {
  const parsed = gameConfigSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const disabled = (parsed.data.disabledRoles ?? []).filter((r) => ROLE_IDS.includes(r as any));
  setSetting('game_config', JSON.stringify({ disabledRoles: disabled, defaults: parsed.data.defaults ?? {} }));
  roomManager.setDisabledRoles(disabled as any);
  res.json({ ok: true });
});

adminRouter.get('/settings', (_req, res) => {
  res.json({
    maintenance_mode: getSetting('maintenance_mode', 'false'),
    maintenance_message: getSetting('maintenance_message', ''),
    registration_open: getSetting('registration_open', 'true'),
  });
});

const settingsSchema = z.object({
  maintenance_mode: z.boolean().optional(),
  maintenance_message: z.string().max(300).optional(),
  registration_open: z.boolean().optional(),
});

adminRouter.put('/settings', (req, res) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  if (typeof parsed.data.maintenance_mode === 'boolean') {
    setSetting('maintenance_mode', parsed.data.maintenance_mode ? 'true' : 'false');
  }
  if (typeof parsed.data.maintenance_message === 'string') {
    setSetting('maintenance_message', parsed.data.maintenance_message);
  }
  if (typeof parsed.data.registration_open === 'boolean') {
    setSetting('registration_open', parsed.data.registration_open ? 'true' : 'false');
  }
  res.json({ ok: true });
});

adminRouter.get('/analytics', (_req, res) => {
  const days: { day: string; games: number; newUsers: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - i);
    const end = start.getTime() + 86_400_000;
    const day = start.toISOString().slice(0, 10);
    const games = get<{ c: number }>('SELECT COUNT(*) as c FROM games WHERE started_at >= ? AND started_at < ?', start.getTime(), end)?.c ?? 0;
    const newUsers = get<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE created_at >= ? AND created_at < ?', start.getTime(), end)?.c ?? 0;
    days.push({ day, games, newUsers });
  }
  const byMode = all<{ mode: string; c: number }>(
    'SELECT mode, COUNT(*) as c FROM games WHERE ended_at IS NOT NULL GROUP BY mode ORDER BY c DESC',
  );
  const winTeams = all<{ winner_team: string; c: number }>(
    "SELECT winner_team, COUNT(*) as c FROM games WHERE winner_team IS NOT NULL GROUP BY winner_team",
  );
  res.json({ days, byMode, winTeams });
});

adminRouter.get('/chat/rooms', (_req, res) => {
  const rooms = all('SELECT id, code, name, status FROM rooms ORDER BY created_at DESC LIMIT 50');
  res.json({ rooms });
});
