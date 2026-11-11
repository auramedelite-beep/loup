import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import i18n from '@/i18n';
import { API_BASE, getReconnect, setReconnect } from '@/lib/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import type {
  ChatMessage,
  GameMode,
  GameSettings,
  GameView,
  GameWinner,
  RoleId,
  RoomPublic,
  Team,
} from '@/types';

export interface Ack {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface GameEndSummary {
  id: string;
  username: string;
  role: RoleId;
  team: Team;
  alive: boolean;
  won: boolean;
  isMvp: boolean;
  isBot: boolean;
}

export interface GameEndPayload {
  roomId: string;
  winner: GameWinner | null;
  mvpId: string | null;
  summary: GameEndSummary[];
}

export interface QueueStatus {
  inQueue: boolean;
  mode: string;
  players: number;
  needed: number;
  waiting: number;
}

export interface MatchFound {
  roomCode: string;
  roomId: string;
  mode: GameMode;
}

export interface NightActionInput {
  type: string;
  target?: string | null;
  targets?: [string, string];
  heal?: string | null;
  poison?: string | null;
}

export interface RoomSnapshot {
  room: RoomPublic;
  game: GameView | null;
  chat: ChatMessage[];
  reconnectToken?: string;
  isSpectator?: boolean;
}

interface SocketContextValue {
  connected: boolean;
  room: RoomPublic | null;
  game: GameView | null;
  gameEnd: GameEndPayload | null;
  chat: ChatMessage[];
  typing: Record<string, string>;
  isHost: boolean;
  isSpectator: boolean;
  queue: QueueStatus | null;
  matched: MatchFound | null;
  reconnectToken: string | null;
  createRoom: (options: {
    name?: string;
    isPrivate?: boolean;
    mode?: GameMode;
    isController?: boolean;
    settings?: Partial<GameSettings>;
  }) => Promise<Ack>;
  joinRoom: (code: string, asSpectator?: boolean) => Promise<Ack>;
  subscribe: (code: string) => Promise<Ack>;
  leaveRoom: () => Promise<Ack>;
  setReady: (ready: boolean) => Promise<Ack>;
  setController: (controllerId: string | null) => Promise<Ack>;
  startGame: () => Promise<Ack>;
  advanceAsController: () => Promise<Ack>;
  kick: (targetId: string) => Promise<Ack>;
  transferHost: (targetId: string) => Promise<Ack>;
  updateSettings: (settings: Partial<GameSettings>, name?: string, isPrivate?: boolean) => Promise<Ack>;
  rematch: () => Promise<Ack>;
  sendChat: (body: string) => Promise<Ack>;
  sendTyping: (typing: boolean) => void;
  gameAction: (action: NightActionInput) => Promise<Ack>;
  gameVote: (targetId: string) => Promise<Ack>;
  gameHunter: (targetId: string | null) => Promise<Ack>;
  joinQueue: (mode: 'quick' | 'ranked', locale: string) => Promise<Ack>;
  leaveQueue: () => Promise<Ack>;
  clearMatch: () => void;
  clearRoom: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const SOCKET_URL = API_BASE || undefined;

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, token, updateUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [gameEnd, setGameEnd] = useState<GameEndPayload | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [isHost, setIsHost] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [matched, setMatched] = useState<MatchFound | null>(null);
  const [reconnectToken, setReconnectTokenState] = useState<string | null>(() => getReconnect()?.token ?? null);
  const typingTimers = useRef<Record<string, number>>({});
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const clearRoom = useCallback(() => {
    setRoom(null);
    setGame(null);
    setGameEnd(null);
    setChat([]);
    setTyping({});
    setIsHost(false);
    setIsSpectator(false);
  }, []);

  useEffect(() => {
    if (!token || !user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      clearRoom();
      setQueue(null);
      setMatched(null);
      return;
    }

    const stored = getReconnect();
    const socket = io(SOCKET_URL, {
      auth: {
        token,
        reconnectToken: stored?.token,
      },
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    const rememberRoom = (snapshot: RoomSnapshot) => {
      setRoom(snapshot.room);
      setGame(snapshot.game ?? null);
      if (snapshot.chat) setChat(snapshot.chat);
      if (typeof snapshot.isSpectator === 'boolean') setIsSpectator(snapshot.isSpectator);
      if (snapshot.reconnectToken) {
        setReconnectTokenState(snapshot.reconnectToken);
        setReconnect({ roomId: snapshot.room.id, roomCode: snapshot.room.code, token: snapshot.reconnectToken });
      }
    };

    const onConnect = () => {
      setConnected(true);
      const resume = getReconnect();
      if (resume) {
        socket.emit('room:subscribe', { code: resume.roomCode }, (ack: Ack) => {
          if (!ack?.ok) {
            setReconnect(null);
            setReconnectTokenState(null);
          }
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (error: Error) => {
      setConnected(false);
      const code = error?.message ?? 'network_error';
      if (code === 'unauthorized' || code === 'banned' || code === 'maintenance') {
        toast.error(i18n.t(`errors.${code}`, { defaultValue: i18n.t('errors.unknown_error') }));
      }
    };

    const onRoomState = (state: RoomPublic) => {
      setRoom(state);
      const me = state.players.find((p) => p.id === user.id);
      setIsHost(state.hostId === user.id);
      if (me) setIsSpectator(false);
      else if (state.spectators && Array.isArray(state.spectators)) {
        setIsSpectator(state.spectators.some((s) => s.id === user.id));
      }
      if (state.status === 'waiting') {
        setGameEnd(null);
      }
    };

    const onRoomYou = (payload: { roomId: string; isHost: boolean }) => setIsHost(payload.isHost);

    const onSnapshot = (snapshot: RoomSnapshot) => {
      rememberRoom(snapshot);
      setIsHost(snapshot.room.hostId === user.id);
    };

    const onGameState = (state: GameView) => {
      setGame(state);
      if (state.phase !== 'ended') setGameEnd(null);
    };

    const onGameEnded = (payload: GameEndPayload) => {
      setGameEnd(payload);
      setQueue(null);
    };

    const onHistory = (payload: { roomId: string; messages: ChatMessage[] }) => setChat(payload.messages ?? []);

    const onChatMessage = (payload: { roomId: string; message: ChatMessage }) => {
      setChat((current) => {
        if (current.some((m) => m.id === payload.message.id)) return current;
        return [...current.slice(-199), payload.message];
      });
    };

    const onChatDeleted = (payload: { roomId: string; messageId: string }) => {
      setChat((current) =>
        current.map((message) =>
          message.id === payload.messageId ? { ...message, body: '', deleted: true } as ChatMessage : message,
        ),
      );
    };

    const onTyping = (payload: { userId: string; username: string; typing: boolean }) => {
      setTyping((current) => {
        const next = { ...current };
        if (typingTimers.current[payload.userId]) {
          window.clearTimeout(typingTimers.current[payload.userId]);
          delete typingTimers.current[payload.userId];
        }
        if (payload.typing) {
          next[payload.userId] = payload.username;
          typingTimers.current[payload.userId] = window.setTimeout(() => {
            setTyping((value) => {
              const copy = { ...value };
              delete copy[payload.userId];
              return copy;
            });
          }, 4000);
        } else {
          delete next[payload.userId];
        }
        return next;
      });
    };

    const onKicked = (payload: { roomId: string }) => {
      clearRoom();
      setReconnect(null);
      setReconnectTokenState(null);
      toast.warning(i18n.t('errors.kicked_from_room'));
      navigateRef.current('/rooms');
      void payload;
    };

    const onQueueStatus = (payload: QueueStatus) => setQueue(payload);

    const onMatched = (payload: MatchFound) => {
      setMatched(payload);
      setQueue(null);
      toast.success(i18n.t('rooms.matchFound'));
      navigateRef.current(`/room/${payload.roomCode}`);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:state', onRoomState);
    socket.on('room:you', onRoomYou);
    socket.on('room:snapshot', onSnapshot);
    socket.on('game:state', onGameState);
    socket.on('game:ended', onGameEnded);
    socket.on('chat:history', onHistory);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:deleted', onChatDeleted);
    socket.on('chat:typing', onTyping);
    socket.on('room:kicked', onKicked);
    socket.on('matchmaking:status', onQueueStatus);
    socket.on('matchmaking:matched', onMatched);

    return () => {
      for (const timer of Object.values(typingTimers.current)) window.clearTimeout(timer);
      typingTimers.current = {};
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token, user?.id, clearRoom, toast]);

  const emitAck = useCallback(<T extends Ack = Ack>(event: string, payload: unknown = {}): Promise<T> => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return Promise.resolve({ ok: false, error: 'network_error' } as T);
    }
    return new Promise<T>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: 'timeout' } as T);
        }
      }, 12_000);
      socket.emit(event, payload, (ack: T) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(ack ?? ({ ok: false, error: 'unknown_error' } as T));
      });
    });
  }, []);

  const createRoom = useCallback(
    async (options: {
      name?: string;
      isPrivate?: boolean;
      mode?: GameMode;
      isController?: boolean;
      settings?: Partial<GameSettings>;
    }) => {
      clearRoom();
      const ack = await emitAck('room:create', options);
      if (ack.ok) {
        const roomId = String(ack.roomId ?? '');
        const roomCode = String(ack.roomCode ?? '');
        const tokenValue = typeof ack.reconnectToken === 'string' ? ack.reconnectToken : undefined;
        if (tokenValue) {
          setReconnectTokenState(tokenValue);
          setReconnect({ roomId, roomCode, token: tokenValue });
        }
      }
      return ack;
    },
    [emitAck, clearRoom],
  );

  const joinRoom = useCallback(
    async (code: string, asSpectator = false) => {
      clearRoom();
      const ack = await emitAck('room:join', { code: code.trim().toUpperCase(), asSpectator });
      if (ack.ok) {
        setIsSpectator(Boolean(ack.isSpectator));
        const roomId = String(ack.roomId ?? '');
        const roomCode = String(ack.roomCode ?? code);
        const tokenValue = typeof ack.reconnectToken === 'string' ? ack.reconnectToken : undefined;
        if (tokenValue) {
          setReconnectTokenState(tokenValue);
          setReconnect({ roomId, roomCode, token: tokenValue });
        }
      }
      return ack;
    },
    [emitAck, clearRoom],
  );

  const subscribe = useCallback(async (code: string) => emitAck('room:subscribe', { code }), [emitAck]);

  const leaveRoom = useCallback(async () => {
    const ack = await emitAck('room:leave');
    clearRoom();
    setReconnect(null);
    setReconnectTokenState(null);
    return ack;
  }, [emitAck, clearRoom]);

  const setReady = useCallback((ready: boolean) => emitAck('room:ready', { ready }), [emitAck]);
  const setController = useCallback((controllerId: string | null) => emitAck('room:controller', { controllerId }), [emitAck]);
  const startGame = useCallback(() => emitAck('room:start'), [emitAck]);
  const advanceAsController = useCallback(() => emitAck('game:advance'), [emitAck]);
  const kick = useCallback((targetId: string) => emitAck('room:kick', { targetId }), [emitAck]);
  const transferHost = useCallback((targetId: string) => emitAck('room:transfer', { targetId }), [emitAck]);
  const updateSettings = useCallback(
    (settings: Partial<GameSettings>, name?: string, isPrivate?: boolean) =>
      emitAck('room:settings', { settings, name, isPrivate }),
    [emitAck],
  );
  const rematch = useCallback(async () => {
    const ack = await emitAck('room:rematch');
    if (ack.ok) setGameEnd(null);
    return ack;
  }, [emitAck]);
  const sendChat = useCallback((body: string) => emitAck('chat:send', { body }), [emitAck]);
  const sendTyping = useCallback((writing: boolean) => {
    socketRef.current?.emit('chat:typing', { typing: writing });
  }, []);
  const gameAction = useCallback((action: NightActionInput) => emitAck('game:action', action), [emitAck]);
  const gameVote = useCallback((targetId: string) => emitAck('game:vote', { targetId }), [emitAck]);
  const gameHunter = useCallback((targetId: string | null) => emitAck('game:hunter', { targetId }), [emitAck]);
  const joinQueue = useCallback(
    async (mode: 'quick' | 'ranked', locale: string) => {
      const ack = await emitAck<Ack & { queue?: QueueStatus | null }>('matchmaking:queue', { mode, locale });
      if (ack.ok && ack.queue) setQueue(ack.queue);
      return ack;
    },
    [emitAck],
  );
  const leaveQueue = useCallback(async () => {
    const ack = await emitAck('matchmaking:leave');
    setQueue(null);
    return ack;
  }, [emitAck]);

  const clearMatch = useCallback(() => setMatched(null), []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      socketRef.current?.emit('app:ping', () => {});
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (!room || !user) return;
    if (room.players.some((p) => p.id === user.id)) {
      setIsHost(room.hostId === user.id);
    }
  }, [room, user]);

  const value = useMemo<SocketContextValue>(
    () => ({
      connected,
      room,
      game,
      gameEnd,
      chat,
      typing,
      isHost,
      isSpectator,
      queue,
      matched,
      reconnectToken,
      createRoom,
      joinRoom,
      subscribe,
      leaveRoom,
      setReady,
      setController,
      startGame,
      advanceAsController,
      kick,
      transferHost,
      updateSettings,
      rematch,
      sendChat,
      sendTyping,
      gameAction,
      gameVote,
      gameHunter,
      joinQueue,
      leaveQueue,
      clearMatch,
      clearRoom,
    }),
    [
      connected,
      room,
      game,
      gameEnd,
      chat,
      typing,
      isHost,
      isSpectator,
      queue,
      matched,
      reconnectToken,
      createRoom,
      joinRoom,
      subscribe,
      leaveRoom,
      setReady,
      setController,
      startGame,
      advanceAsController,
      kick,
      transferHost,
      updateSettings,
      rematch,
      sendChat,
      sendTyping,
      gameAction,
      gameVote,
      gameHunter,
      joinQueue,
      leaveQueue,
      clearMatch,
      clearRoom,
    ],
  );

  // The unused variable is intentional: it keeps the user reference fresh for closures.
  void updateUser;

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used inside <SocketProvider>');
  return context;
}
