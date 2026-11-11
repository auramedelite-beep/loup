import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { config } from './config';
import { closeDb, getSetting } from './db';
import { optionalAuth } from './auth/middleware';
import { authRouter } from './auth/routes';
import { profileRouter } from './routes/profile';
import { socialRouter } from './routes/social';
import { roomsRouter, matchmakingRouter, publicStatsRouter } from './routes/rooms';
import { adminRouter } from './routes/admin';
import { roomManager, RoomManager } from './game/rooms';
import { registerSocketHandlers } from './realtime/socket';
import { seedDatabase } from './services/notifications';
import { ROLE_IDS } from './game/roles';
import type { RoleId } from './game/types';

const app = express();
const server = http.createServer(app);

const allowedOrigins = new Set([
  ...config.clientOrigins,
  ...(config.isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
]);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || allowedOrigins.has('*')) {
        callback(null, true);
        return;
      }
      callback(new Error('origin_not_allowed'));
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 100_000,
});

if (config.trustProxy) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || allowedOrigins.has('*')) {
        callback(null, true);
        return;
      }
      callback(new Error('origin_not_allowed'));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '32kb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'LOUP-GAROU DZ',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
    at: Date.now(),
    maintenance: getSetting('maintenance_mode', 'false') === 'true',
    rooms: roomManager.metrics(),
  });
});

app.use('/api', apiLimiter, optionalAuth);

app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/social', socialRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/matchmaking', matchmakingRouter);
app.use('/api/public', publicStatsRouter);
app.use('/api/admin', adminRouter);

app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Static client (built with `npm run build:client`).
const distDir = path.resolve(process.cwd(), 'dist');
const indexHtml = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: config.isProduction ? '1y' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .contentType('text/plain')
      .send(
        'LOUP-GAROU DZ API is running. Build the client with `npm run build:client` to serve the UI from this server, or use the Vite dev server on http://localhost:5173.',
      );
  });
}

// Centralized error handler — never leak stack traces in production.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.message === 'origin_not_allowed') {
    res.status(403).json({ error: 'origin_not_allowed' });
    return;
  }
  console.error('[http] unhandled error', err);
  res.status(500).json({ error: 'internal_error' });
});

roomManager.setIo(io);
registerSocketHandlers(io);

async function start(): Promise<void> {
  seedDatabase(config.adminUsernames, config.adminPassword);

  // Restore runtime state that must survive a restart.
  RoomManager.recoverStaleState();
  try {
    const stored = getSetting('game_config', '');
    if (stored) {
      const parsed = JSON.parse(stored) as { disabledRoles?: string[] };
      const disabled = (parsed.disabledRoles ?? []).filter((role) => ROLE_IDS.includes(role as RoleId));
      roomManager.setDisabledRoles(disabled as RoleId[]);
      if (disabled.length > 0) console.log(`[boot] disabled roles: ${disabled.join(', ')}`);
    }
  } catch (error) {
    console.warn('[boot] could not read game_config', error);
  }

  server.listen(config.port, () => {
    console.log(`\n  🐺 LOUP-GAROU DZ`);
    console.log(`  ────────────────────────────────────────────`);
    console.log(`  API + sockets : http://localhost:${config.port}`);
    console.log(`  Client (dev)  : http://localhost:5173`);
    console.log(`  Mode          : ${config.isProduction ? 'production' : 'development'}`);
    console.log(`  Database      : ${config.databasePath}`);
    console.log(`  ────────────────────────────────────────────\n`);
  });
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] received ${signal}, closing gracefully…`);
  io.close();
  server.close(() => {
    try {
      closeDb();
    } catch {
      /* ignore */
    }
    console.log('[shutdown] done');
    process.exit(0);
  });
  // Hard stop if connections refuse to drain.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[process] uncaught exception', error);
});

start().catch((error) => {
  console.error('[boot] failed to start', error);
  process.exit(1);
});
