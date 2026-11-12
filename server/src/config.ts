import 'dotenv/config';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const port = num(process.env.PORT, 4000);
const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.trim();
const googleRedirectUri =
  process.env.GOOGLE_REDIRECT_URI?.trim() ||
  (renderExternalUrl
    ? new URL('/api/auth/google/callback', renderExternalUrl).toString()
    : `http://localhost:${port}/api/auth/google/callback`);

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)) {
  throw new Error('JWT_SECRET must be set to a strong random value (>= 24 chars) in production.');
}

export const config = {
  isProduction,
  port,
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-please-1234567890',
  databasePath: process.env.DATABASE_PATH || 'data/loupgarou.db',
  adminUsernames: (process.env.ADMIN_USERNAMES || 'admin')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@12345',
  trustProxy:
    process.env.TRUST_PROXY === 'true' ||
    (isProduction && process.env.TRUST_PROXY !== 'false'),
  maxRooms: Number(process.env.MAX_ROOMS || 500),
  botFillTimeoutMs: Number(process.env.BOT_FILL_TIMEOUT_MS || 8000),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri,
};
