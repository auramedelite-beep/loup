import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { all, get, int, run, tx } from '../db';

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  avatar: string;
  role: 'player' | 'admin';
  is_guest: number;
  locale: string;
  token_version: number;
  settings_json: string;
  created_at: number;
  last_seen: number;
  banned_until: number | null;
  ban_reason: string | null;
  failed_logins: number;
  locked_until: number | null;
}

export interface ProfileRow {
  user_id: string;
  games_played: number;
  wins: number;
  losses: number;
  village_games: number;
  village_wins: number;
  wolf_games: number;
  wolf_wins: number;
  xp: number;
  level: number;
  rating: number;
  peak_rating: number;
  favorite_role: string | null;
  public_profile: number;
  updated_at: number;
}

export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  role: 'player' | 'admin';
  isGuest: boolean;
  locale: string;
  createdAt: number;
  settings: Record<string, unknown>;
  profile: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    villageGames: number;
    villageWins: number;
    wolfGames: number;
    wolfWins: number;
    xp: number;
    level: number;
    rating: number;
    peakRating: number;
    favoriteRole: string | null;
    publicProfile: boolean;
    winRate: number;
    wolfWinRate: number;
    villageWinRate: number;
  } | null;
}

export function parseSettings(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1);
}

export function findUserById(id: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function findUserByUsername(username: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email);
}

export function getProfile(userId: string): ProfileRow | undefined {
  return get<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', userId);
}

export function isUserBanned(user: UserRow): { banned: boolean; until: number | null; reason: string | null } {
  const now = Date.now();
  if (user.banned_until && user.banned_until > now) {
    return { banned: true, until: user.banned_until, reason: user.ban_reason };
  }
  const active = get<{ expires_at: number | null; reason: string }>(
    `SELECT expires_at, reason FROM bans
     WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC LIMIT 1`,
    user.id,
    now,
  );
  if (active) return { banned: true, until: active.expires_at, reason: active.reason };
  return { banned: false, until: null, reason: null };
}

export function toPublicUser(user: UserRow, includeProfile = true): PublicUser {
  const profile = includeProfile ? getProfile(user.id) : undefined;
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    role: user.role,
    isGuest: Boolean(user.is_guest),
    locale: user.locale,
    createdAt: user.created_at,
    settings: parseSettings(user.settings_json),
    profile: profile
      ? {
          gamesPlayed: profile.games_played,
          wins: profile.wins,
          losses: profile.losses,
          villageGames: profile.village_games,
          villageWins: profile.village_wins,
          wolfGames: profile.wolf_games,
          wolfWins: profile.wolf_wins,
          xp: profile.xp,
          level: profile.level,
          rating: profile.rating,
          peakRating: profile.peak_rating,
          favoriteRole: profile.favorite_role,
          publicProfile: Boolean(profile.public_profile),
          winRate: profile.games_played ? Math.round((profile.wins / profile.games_played) * 100) : 0,
          wolfWinRate: profile.wolf_games ? Math.round((profile.wolf_wins / profile.wolf_games) * 100) : 0,
          villageWinRate: profile.village_games
            ? Math.round((profile.village_wins / profile.village_games) * 100)
            : 0,
        }
      : null,
  };
}

export interface CreateUserInput {
  username: string;
  email?: string | null;
  password?: string | null;
  avatar?: string;
  locale?: string;
  isGuest?: boolean;
  role?: 'player' | 'admin';
}

export function createUser(input: CreateUserInput, adminUsernames: string[] = []): UserRow {
  const now = Date.now();
  const id = randomUUID();
  const isAdmin =
    input.role === 'admin' || adminUsernames.includes(input.username.toLowerCase());
  const passwordHash = input.password ? bcrypt.hashSync(input.password, 10) : null;

  return tx(() => {
    run(
      `INSERT INTO users (id, username, email, password_hash, avatar, role, is_guest, locale, token_version, settings_json, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      id,
      input.username,
      input.email ?? null,
      passwordHash,
      input.avatar ?? 'wolf',
      isAdmin ? 'admin' : 'player',
      int(Boolean(input.isGuest)),
      input.locale ?? 'ar',
      JSON.stringify({
        language: input.locale ?? 'ar',
        music: 0.5,
        sound: 0.7,
        animations: true,
        notifications: true,
        reducedMotion: false,
      }),
      now,
      now,
    );
    run(
      `INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)`,
      id,
      now,
    );
    const row = findUserById(id);
    if (!row) throw new Error('Failed to create user');
    return row;
  });
}

export function verifyPassword(user: UserRow, password: string): boolean {
  if (!user.password_hash) return false;
  return bcrypt.compareSync(password, user.password_hash);
}

export function setPassword(userId: string, password: string): void {
  run(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1, failed_logins = 0, locked_until = NULL WHERE id = ?',
    bcrypt.hashSync(password, 10),
    userId,
  );
}

export function touchUser(userId: string): void {
  run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), userId);
}

export function isOnline(userId: string, sockets: Map<string, Set<string>>): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0;
}

export function listAchievements() {
  return all<{ key: string; icon: string; xp: number; sort: number }>(
    'SELECT key, icon, xp, sort FROM achievements ORDER BY sort ASC',
  );
}

export function achievementsFor(userId: string) {
  return all<{ key: string; icon: string; xp: number; sort: number; unlocked_at: number }>(
    `SELECT a.key, a.icon, a.xp, a.sort, pa.unlocked_at
     FROM achievements a
     LEFT JOIN player_achievements pa ON pa.achievement_key = a.key AND pa.user_id = ?
     ORDER BY a.sort ASC`,
    userId,
  );
}

export function searchUsers(query: string, limit = 12) {
  const like = `%${query.replace(/[%_]/g, '')}%`;
  return all<{ id: string; username: string; avatar: string; last_seen: number }>(
    `SELECT id, username, avatar, last_seen FROM users
     WHERE username LIKE ? COLLATE NOCASE AND is_guest = 0
     ORDER BY last_seen DESC LIMIT ?`,
    like,
    limit,
  );
}
