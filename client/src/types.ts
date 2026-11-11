export type Team = 'village' | 'werewolf' | 'independent';

export type RoleId =
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter'
  | 'savior'
  | 'lion'
  | 'owl'
  | 'cupid'
  | 'bodyguard'
  | 'little_girl'
  | 'elder'
  | 'idiot'
  | 'raven'
  | 'werewolf'
  | 'big_bad_wolf'
  | 'white_wolf'
  | 'wolf_father'
  | 'black_wolf'
  | 'assassin'
  | 'piper'
  | 'angel'
  | 'wild_child';

export type NightActionType =
  | 'kill'
  | 'protect'
  | 'witch'
  | 'investigate'
  | 'weaken_vote'
  | 'lovers'
  | 'spy'
  | 'mark'
  | 'charm'
  | 'model'
  | 'infect'
  | 'big_bad_kill'
  | 'white_wolf_kill'
  | 'curse'
  | 'contract'
  | 'hunter_shot';

export type Phase =
  | 'role_reveal'
  | 'night'
  | 'dawn'
  | 'discussion'
  | 'voting'
  | 'vote_result'
  | 'hunter'
  | 'ended';

export type GameMode = 'classic' | 'ranked' | 'custom' | 'quick' | 'friends' | 'practice';

export interface GameSettings {
  mode: GameMode;
  minPlayers: number;
  maxPlayers: number;
  nightSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  revealRoleOnDeath: boolean;
  allowVoteChange: boolean;
  tieRule: 'no_elimination' | 'random';
  loversWin: boolean;
  witchSelfHeal: boolean;
  allowSpectators: boolean;
  voiceChat: boolean;
  language?: 'ar';
  roleCounts: Partial<Record<RoleId, number>>;
}

export interface PublicPlayerView {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  alive: boolean;
  revealedRole: RoleId | null;
  isLover: boolean;
  isSelf: boolean;
  connected: boolean;
  isBot: boolean;
  deathDay: number | null;
}

export interface NightPrompt {
  action: NightActionType;
  submitted: boolean;
  canSkip: boolean;
  minTargets: number;
  maxTargets: number;
  targetIds: string[];
  note?: string;
  extra?: Record<string, unknown>;
}

export interface GameEvent {
  id: number;
  day: number;
  phase: Phase;
  at: number;
  type: string;
  visibility: 'public' | 'werewolf' | 'private';
  userId?: string;
  data: Record<string, unknown>;
}

export interface VoteResult {
  eliminatedId: string | null;
  savedByIdiotId: string | null;
  tie: boolean;
  counts: Record<string, number>;
  day: number;
}

export interface GameWinner {
  team: Team | 'lovers';
  playerIds: string[];
  reason:
    | 'village_all_wolves_dead'
    | 'werewolves_parity'
    | 'white_wolf_alone'
    | 'piper_all_charmed'
    | 'assassin_contract'
    | 'angel_lynched'
    | 'lovers_last_two';
}

export interface GameView {
  id: string;
  isController?: boolean;
  day: number;
  phase: Phase;
  pendingHunterId?: string | null;
  phaseEndsAt: number;
  serverNow: number;
  mode: GameMode;
  settings: Pick<
    GameSettings,
    'revealRoleOnDeath' | 'allowVoteChange' | 'tieRule' | 'loversWin' | 'allowSpectators'
  >;
  players: PublicPlayerView[];
  self: {
    id: string;
    role: RoleId;
    team: Team;
    alive: boolean;
    isLover: boolean;
    loverId: string | null;
    charmed: boolean;
    infected: boolean;
    canVote: boolean;
    uses: Record<string, number>;
    contractTarget: string | null;
    modelId: string | null;
  } | null;
  wolfTeammates: { id: string; username: string; role: RoleId; alive: boolean }[];
  prompt: NightPrompt | null;
  night: {
    deaths: { id: string; name: string; role: RoleId | null }[];
    wolfTargetId: string | null;
    wolfVotes: Record<string, string> | null;
    seerHistory: { targetId: string; targetName: string; isWolf: boolean; day: number }[];
    witchVictimId: string | null;
  };
  vote: {
    hasVoted: boolean;
    ownVote: string | null;
    counts: Record<string, number>;
    voterCount: number;
    votedCount: number;
    markedId: string | null;
    weakenedId: string | null;
    result: VoteResult | null;
  };
  events: GameEvent[];
  winner: GameWinner | null;
  mvpId: string | null;
  roomCode: string;
  roomName: string;
}

export interface RoomPlayer {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isController: boolean;
  isBot: boolean;
  isGuest: boolean;
  level: number;
  rating: number;
}

export interface RoomSpectator {
  id: string;
  username: string;
  avatar: string;
}

export interface RoomSummary {
  id: string;
  code: string;
  name: string;
  hostId: string;
  hostName: string;
  controllerId: string | null;
  mode: GameMode;
  isPrivate: boolean;
  status: 'waiting' | 'playing' | 'finished';
  players: number;
  bots: number;
  maxPlayers: number;
  minPlayers: number;
  spectators: number;
  language: 'ar';
  voiceChat: boolean;
  createdAt: number;
  game: { day: number; phase: Phase; playersAlive: number } | null;
}

export interface RoomPublic {
  id: string;
  code: string;
  name: string;
  hostId: string;
  hostName: string;
  controllerId: string | null;
  mode: GameMode;
  isPrivate: boolean;
  status: 'waiting' | 'playing' | 'finished';
  players: RoomPlayer[];
  bots?: number;
  maxPlayers: number;
  minPlayers: number;
  spectators: RoomSpectator[] | number;
  settings: GameSettings;
  language: 'ar';
  voiceChat?: boolean;
  createdAt: number;
  game: { id?: string; day: number; phase: Phase; phaseEndsAt?: number; winner?: GameWinner | null; playersAlive?: number; aliveCount?: number } | null;
}

export interface ChatMessage {
  id: string;
  channel: 'lobby' | 'day' | 'dead' | 'system';
  userId: string | null;
  username: string;
  body: string;
  at: number;
  deleted?: boolean;
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
  private?: boolean;
}

export interface Achievement {
  key: string;
  icon: string;
  xp: number;
  sort: number;
  unlocked_at: number | null;
}

export interface GameHistoryRow {
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
}

export interface NotificationItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: number | null;
  createdAt: number;
}

export interface LeaderboardRow {
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
}

export interface FriendRow {
  id: string;
  username: string;
  avatar: string;
  level: number;
  rating: number;
  last_seen: number;
  online: boolean;
}

export interface FriendRequest {
  id: string;
  from_user_id?: string;
  to_user_id?: string;
  username: string;
  avatar: string;
  created_at: number;
}

export interface MatchmakingQueueInfo {
  mode: GameMode;
  position: number;
  size: number;
  waitedMs: number;
}

export interface AppStats {
  players: number;
  matches: number;
  rooms: number;
  liveGames: number;
}
