import { randomUUID } from 'node:crypto';
import { all, get, int, run, tx } from '../db';
import type { Game } from '../game/types';
import { ROLES } from '../game/roles';
import { createNotification } from './notifications';
import { levelForXp, type ProfileRow } from './users';

export interface FinalizeOptions {
  roomCode: string;
}

interface RatedParticipant {
  id: string;
  rating: number;
  team: 'village' | 'werewolf' | 'independent';
  won: boolean;
}

function clampRating(value: number): number {
  return Math.max(100, Math.min(3000, Math.round(value)));
}

/** Shared-opponent check that dampens farming the same group of players. */
function rematchFactor(userId: string, opponentIds: string[], now: number): number {
  if (opponentIds.length === 0) return 1;
  const recent = all<{ game_id: string; opponents: string }>(
    `SELECT gp.game_id as game_id, GROUP_CONCAT(other.user_id) as opponents
     FROM games g
     JOIN game_players gp ON gp.game_id = g.id AND gp.user_id = ?
     JOIN game_players other ON other.game_id = g.id AND other.user_id <> gp.user_id
     WHERE g.ranked = 1 AND g.ended_at IS NOT NULL AND g.ended_at > ?
     GROUP BY gp.game_id
     ORDER BY g.ended_at DESC LIMIT 5`,
    userId,
    now - 6 * 60 * 60 * 1000,
  );
  const current = new Set(opponentIds);
  for (const row of recent) {
    const previous = new Set(String(row.opponents || '').split(',').filter(Boolean));
    let shared = 0;
    for (const id of previous) if (current.has(id)) shared += 1;
    if (shared >= Math.max(2, Math.ceil(current.size * 0.6))) return 0.4;
  }
  return 1;
}

export function finalizeGame(game: Game, options: FinalizeOptions): void {
  const already = get<{ id: string }>('SELECT id FROM games WHERE id = ? AND ended_at IS NOT NULL', game.id);
  if (already) return;

  const endedAt = game.endedAt ?? Date.now();
  const winner = game.winner;
  const winnerIds = new Set(winner?.playerIds ?? []);
  const ranked = game.mode === 'ranked';
  const humans = game.players.filter((p) => !p.isBot);
  const now = Date.now();

  tx(() => {
    run(
      `INSERT INTO games (id, room_id, room_code, mode, started_at, ended_at, winner_team, winner_ids_json, reason, mvp_id,
        duration_seconds, player_count, day_count, ranked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ended_at = excluded.ended_at,
         winner_team = excluded.winner_team,
         winner_ids_json = excluded.winner_ids_json,
         reason = excluded.reason,
         mvp_id = excluded.mvp_id,
         duration_seconds = excluded.duration_seconds,
         player_count = excluded.player_count,
         day_count = excluded.day_count,
         ranked = excluded.ranked`,
      game.id,
      game.roomId,
      options.roomCode,
      game.mode,
      game.startedAt,
      endedAt,
      winner?.team ?? null,
      JSON.stringify(winner?.playerIds ?? []),
      winner?.reason ?? null,
      game.mvpId,
      Math.max(1, Math.round((endedAt - game.startedAt) / 1000)),
      game.players.length,
      game.day,
      int(ranked),
      now,
    );

    for (const p of game.players) {
      run(
        `INSERT INTO game_players (game_id, user_id, username, seat, role, team, alive, won, is_mvp, is_bot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, user_id) DO NOTHING`,
        game.id,
        p.id,
        p.username,
        p.seat,
        p.role,
        p.team,
        int(p.alive),
        int(winnerIds.has(p.id)),
        int(game.mvpId === p.id),
        int(p.isBot),
      );
    }

    // Audit trail: every game event becomes a game_action row.
    for (const event of game.events) {
      run(
        `INSERT INTO game_actions (id, game_id, day, phase, actor_id, action_type, target_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        game.id,
        event.day,
        event.phase,
        event.userId ?? null,
        `event:${event.type}`,
        typeof event.data.targetId === 'string' ? event.data.targetId : null,
        JSON.stringify({ visibility: event.visibility, data: event.data }),
        event.at,
      );
    }

    // Ratings computed before profile updates so all before-values are stable.
    const profilesBefore = new Map<string, ProfileRow>();
    for (const p of humans) {
      if (p.isBot) continue;
      const profile = get<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', p.id);
      if (profile) profilesBefore.set(p.id, profile);
    }

    const participantTeam = (p: Game['players'][number]): 'village' | 'werewolf' | 'independent' =>
      p.team === 'werewolf' ? 'werewolf' : p.team === 'village' ? 'village' : 'independent';

    let ratingDeltas = new Map<string, number>();
    if (ranked) {
      const rated = humans.filter((p) => {
        const profile = profilesBefore.get(p.id);
        const registered = get<{ is_guest: number }>('SELECT is_guest FROM users WHERE id = ?', p.id);
        return Boolean(profile) && registered?.is_guest === 0;
      });
      const winners = rated.filter((p) => winnerIds.has(p.id));
      const losers = rated.filter((p) => !winnerIds.has(p.id));
      const avg = (list: typeof rated) =>
        list.length ? list.reduce((sum, p) => sum + (profilesBefore.get(p.id)?.rating ?? 1000), 0) / list.length : 1000;
      const winnerAvg = avg(winners);
      const loserAvg = avg(losers);

      for (const p of rated) {
        const before = profilesBefore.get(p.id)!.rating;
        const won = winnerIds.has(p.id);
        const opponents = rated.filter((o) => o.id !== p.id);
        const opponentIds = opponents.map((o) => o.id);
        const opponentAvg = won ? loserAvg : winnerAvg;
        const teamAvg = won ? winnerAvg : loserAvg;
        const expected = 1 / (1 + 10 ** ((opponentAvg - teamAvg) / 400));
        const K = 28;
        const factor = rematchFactor(p.id, opponentIds, now);
        const delta = Math.round(K * (factor) * ((won ? 1 : 0) - expected));
        ratingDeltas.set(p.id, delta);
      }
    }

    const achievementsToAward: { userId: string; key: string }[] = [];

    for (const p of humans) {
      if (p.isBot) continue;
      const profile = profilesBefore.get(p.id);
      if (!profile) continue;
      const won = winnerIds.has(p.id);
      const team = participantTeam(p);
      const mvp = game.mvpId === p.id;
      const impact = game.impact[p.id] ?? 0;
      const baseXp = 20 + (won ? 40 : 10) + (mvp ? 25 : 0) + Math.min(40, impact * 2);
      const delta = ratingDeltas.get(p.id) ?? 0;
      const newRating = ranked ? clampRating(profile.rating + delta) : profile.rating;
      const newXp = profile.xp + baseXp;
      const newGames = profile.games_played + 1;
      const newWins = profile.wins + (won ? 1 : 0);
      const newLosses = profile.losses + (won ? 0 : 1);
      const newVillageGames = profile.village_games + (team === 'village' ? 1 : 0);
      const newVillageWins = profile.village_wins + (team === 'village' && won ? 1 : 0);
      const newWolfGames = profile.wolf_games + (team === 'werewolf' ? 1 : 0);
      const newWolfWins = profile.wolf_wins + (team === 'werewolf' && won ? 1 : 0);
      const peak = Math.max(profile.peak_rating, newRating);

      const favorite = get<{ role: string }>(
        `SELECT role, COUNT(*) as c FROM game_players WHERE user_id = ? GROUP BY role ORDER BY c DESC LIMIT 1`,
        p.id,
      );

      run(
        `UPDATE profiles SET games_played = ?, wins = ?, losses = ?, village_games = ?, village_wins = ?,
           wolf_games = ?, wolf_wins = ?, xp = ?, level = ?, rating = ?, peak_rating = ?,
           favorite_role = COALESCE(?, favorite_role), updated_at = ?
         WHERE user_id = ?`,
        newGames,
        newWins,
        newLosses,
        newVillageGames,
        newVillageWins,
        newWolfGames,
        newWolfWins,
        newXp,
        levelForXp(newXp),
        newRating,
        peak,
        favorite?.role ?? null,
        now,
        p.id,
      );

      if (ranked) {
        run(
          `INSERT INTO ratings (id, user_id, game_id, rating_before, rating_after, delta, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, user_id) DO NOTHING`,
          randomUUID(),
          p.id,
          game.id,
          profile.rating,
          newRating,
          delta,
          now,
        );
      }

      if (newGames === 1) achievementsToAward.push({ userId: p.id, key: 'first_game' });
      if (won && newWins === 1) achievementsToAward.push({ userId: p.id, key: 'first_win' });
      if (won && team === 'village' && newVillageWins === 1) {
        achievementsToAward.push({ userId: p.id, key: 'village_win' });
      }
      if (won && team === 'werewolf' && newWolfWins === 1) {
        achievementsToAward.push({ userId: p.id, key: 'wolf_win' });
      }
      if (newGames === 10) achievementsToAward.push({ userId: p.id, key: 'veteran_10' });
      if (newGames === 50) achievementsToAward.push({ userId: p.id, key: 'veteran_50' });
      if (won && p.alive) achievementsToAward.push({ userId: p.id, key: 'survivor' });
      if (mvp) achievementsToAward.push({ userId: p.id, key: 'mvp' });
      if (newRating >= 1400) achievementsToAward.push({ userId: p.id, key: 'ranked_gold' });
      if (game.day >= 3) achievementsToAward.push({ userId: p.id, key: 'night_owl' });
      const friendCount = get<{ c: number }>(
        'SELECT COUNT(*) as c FROM friendships WHERE user_id = ?',
        p.id,
      )?.c;
      if ((friendCount ?? 0) > 0) achievementsToAward.push({ userId: p.id, key: 'social' });
    }

    for (const award of achievementsToAward) {
      const inserted = run(
        `INSERT INTO player_achievements (user_id, achievement_key, unlocked_at)
         VALUES (?, ?, ?) ON CONFLICT(user_id, achievement_key) DO NOTHING`,
        award.userId,
        award.key,
        now,
      );
      if (inserted.changes > 0) {
        const achievement = get<{ xp: number }>('SELECT xp FROM achievements WHERE key = ?', award.key);
        const bonus = achievement?.xp ?? 0;
        if (bonus > 0) {
          const profile = get<{ xp: number }>('SELECT xp FROM profiles WHERE user_id = ?', award.userId);
          const total = (profile?.xp ?? 0) + bonus;
          run('UPDATE profiles SET xp = ?, level = ? WHERE user_id = ?', total, levelForXp(total), award.userId);
        }
        createNotification(award.userId, 'achievement', { key: award.key, xp: bonus });
      }
    }
  });
}

export function gameHistoryFor(userId: string, limit = 25) {
  return all<{
    game_id: string;
    mode: string;
    winner_team: string | null;
    started_at: number;
    ended_at: number | null;
    duration_seconds: number | null;
    player_count: number;
    role: string;
    won: number;
    is_mvp: number;
    rating_delta: number | null;
  }>(
    `SELECT g.id as game_id, g.mode, g.winner_team, g.started_at, g.ended_at, g.duration_seconds,
            g.player_count, gp.role, gp.won, gp.is_mvp,
            (SELECT r.delta FROM ratings r WHERE r.game_id = g.id AND r.user_id = gp.user_id) as rating_delta
     FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = ? AND g.ended_at IS NOT NULL
     ORDER BY g.ended_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export function roleLabel(role: string): string {
  return ROLES[role as keyof typeof ROLES]?.name ?? role;
}

export function leaderboard(limit = 50) {
  return all<{
    id: string;
    username: string;
    avatar: string;
    level: number;
    xp: number;
    rating: number;
    games_played: number;
    wins: number;
    wolf_win_rate: number;
    village_win_rate: number;
  }>(
    `SELECT u.id, u.username, u.avatar, p.level, p.xp, p.rating, p.games_played, p.wins,
       CASE WHEN p.wolf_games > 0 THEN ROUND(p.wolf_wins * 100.0 / p.wolf_games) ELSE 0 END as wolf_win_rate,
       CASE WHEN p.village_games > 0 THEN ROUND(p.village_wins * 100.0 / p.village_games) ELSE 0 END as village_win_rate
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.games_played > 0 AND u.is_guest = 0
     ORDER BY p.rating DESC, p.xp DESC LIMIT ?`,
    limit,
  );
}
