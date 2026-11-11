import { randomUUID } from 'node:crypto';
import { all, get, run, setSetting, tx } from '../db';

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  payload_json: string;
  read_at: number | null;
  created_at: number;
}

export function createNotification(
  userId: string,
  type: string,
  payload: Record<string, unknown> = {},
): string {
  const id = randomUUID();
  run(
    'INSERT INTO notifications (id, user_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    userId,
    type,
    JSON.stringify(payload),
    Date.now(),
  );
  return id;
}

export function unreadNotificationCount(userId: string): number {
  return (
    get<{ count: number }>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL',
      userId,
    )?.count ?? 0
  );
}

export function notificationsFor(
  userId: string,
  limit = 40,
): { id: string; type: string; payload: Record<string, unknown>; readAt: number | null; createdAt: number }[] {
  const rows = all<NotificationRow>(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    userId,
    limit,
  );
  return rows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      type: row.type,
      payload,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  });
}

export function markNotificationsRead(userId: string, ids?: string[]): void {
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders})`,
      Date.now(),
      userId,
      ...ids,
    );
  } else {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', Date.now(), userId);
  }
}

export function seedDatabase(adminUsernames: string[], adminPassword: string): void {
  const achievements = [
    { key: 'first_game', icon: '🎲', xp: 20, sort: 1 },
    { key: 'first_win', icon: '🏆', xp: 40, sort: 2 },
    { key: 'village_win', icon: '🏘️', xp: 40, sort: 3 },
    { key: 'wolf_win', icon: '🐺', xp: 40, sort: 4 },
    { key: 'veteran_10', icon: '🎖️', xp: 80, sort: 5 },
    { key: 'veteran_50', icon: '👑', xp: 200, sort: 6 },
    { key: 'survivor', icon: '🕯️', xp: 60, sort: 7 },
    { key: 'mvp', icon: '⭐', xp: 100, sort: 8 },
    { key: 'ranked_gold', icon: '🥇', xp: 150, sort: 9 },
    { key: 'social', icon: '🤝', xp: 30, sort: 10 },
    { key: 'night_owl', icon: '🌙', xp: 50, sort: 11 },
  ];

  tx(() => {
    for (const a of achievements) {
      run(
        `INSERT INTO achievements (key, icon, xp, sort) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET icon = excluded.icon, xp = excluded.xp, sort = excluded.sort`,
        a.key,
        a.icon,
        a.xp,
        a.sort,
      );
    }
    const settingFallbacks: Record<string, string> = {
      maintenance_mode: 'false',
      registration_open: 'true',
      maintenance_message: '',
    };
    for (const [key, fallback] of Object.entries(settingFallbacks)) {
      const existing = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
      if (!existing) setSetting(key, fallback);
    }
  });

  const adminName = adminUsernames[0] || 'admin';
  const existingAdmin = get<{ id: string }>('SELECT id FROM users WHERE role = ? LIMIT 1', 'admin');
  if (!existingAdmin) {
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const now = Date.now();
    const id = randomUUID();
    run(
      `INSERT INTO users (id, username, email, password_hash, avatar, role, is_guest, locale, token_version, settings_json, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?, 'admin', 0, 'ar', 0, ?, ?, ?)`,
      id,
      adminName,
      `${adminName}@loupgarou.dz`,
      bcrypt.hashSync(adminPassword, 10),
      'wolf',
      JSON.stringify({ language: 'ar', music: 0.4, sound: 0.6, animations: true, notifications: true }),
      now,
      now,
    );
    run('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)', id, now);
    console.log(`[seed] admin account created: ${adminName}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[seed] dev admin password: ${adminPassword} (set ADMIN_PASSWORD to change)`);
    } else {
      console.log('[seed] CHANGE THE ADMIN PASSWORD IMMEDIATELY.');
    }
  }
}
