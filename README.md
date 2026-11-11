# LOUP-GAROU DZ

**LOUP-GAROU DZ** - A complete premium real-time multiplayer Werewolf game built with modern web technologies.

## 🎮 Overview

A multiplayer Werewolf (Loup-Garou) game with:
- **Real-time multiplayer** via Socket.IO with server-authoritative game state
- **Hidden roles** with secure information flow
- **9 playable roles**: Villager, Seer, Werewolf, Witch, Hunter, Lion, Savior, Raven, Owl
- **Multiple game modes**: Classic, Ranked, Custom, Quick, Friends-only, Practice AI, Spectator
- **Arabic-only interface** with right-to-left layout
- **Complete screens**: Home, Room Browser, Waiting Room, Role Reveal, Night/Day, Voting, Results, Profile/Stats, Settings, Admin Dashboard

## 🛠 Tech Stack

### Server
- **Node 24** + **TypeScript**
- **Express 4** with **Socket.IO 4**
- **`node:sqlite`** (zero native deps, experimental)
- **bcryptjs**, **JWT**, **zod** for validation
- SQLite for persistence (games, users, stats)

### Client
- **React 18** + **Vite 5**
- **Tailwind 3** + **PostCSS**
- **framer-motion** for animations
- **i18next** + **react-i18next** for Arabic interface strings
- **react-router** v6
- **lucide-react** icons
- **WebAudio** synthesized sounds

### Shared
- Game engine is **pure and independently testable**
- UI translates role/event IDs via i18n
- Practice bots only in practice mode
- Single-instance limitation (Redis/shared store needed for multi-instance)

## 📦 Installation

```bash
# Clone and install
git clone <repo-url>
cd loupgarou

# Install root dependencies
npm install

# Install client dependencies
cd client && npm install

# Server will auto-compile and start
```

### Environment Variables

Copy `.env.example` and configure:

```
# Server
PORT=4000
NODE_ENV=development
JWT_SECRET=your-24-char-min-secret
ADMIN_PASSWORD=Admin@12345
MAINTENANCE_MODE=false

# Database
DATABASE_PATH=data/loupgarou.db

# Optional: SMTP for password recovery
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASS=password

# Optional: Google OAuth sign-in
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
```

Create a Google OAuth 2.0 Web client in Google Cloud Console. Add `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI for local development. In production, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the API host, and add the exact public HTTPS callback (for example, `https://your-service.onrender.com/api/auth/google/callback`) as an authorized redirect URI. On Render, the callback defaults to the service URL from `RENDER_EXTERNAL_URL`; set `GOOGLE_REDIRECT_URI` explicitly if the Google Console uses a different URL. The API also needs `CLIENT_ORIGIN` set to the deployed frontend origin.

## 🚀 Development

```bash
# Start both server and client (Vite dev server with proxy)
npm run dev

# Server only
cd server && npm run dev

# Client only  
cd client && npm run dev  # Vite on port 5173
```

### Netlify frontend

The repository includes `netlify.toml` for building the Vite frontend from the
repository root and serving client-side routes. Connect the GitHub repository
to Netlify and deploy the `main` branch. To let visitors access the site, turn
off Netlify team-only access with **Make public**.

Netlify only hosts the frontend. The API and Socket.IO game server must run on
a separate Node.js host that supports persistent WebSocket connections. Set
`VITE_API_URL` in Netlify's build environment to that server's HTTPS origin,
and set `CLIENT_ORIGIN` on the server to the Netlify site origin. The game
server uses SQLite, so use persistent storage for its `DATABASE_PATH`; an
ephemeral filesystem can lose accounts and game data after a restart.

### Android APK

The Android app packages the web client and connects to the game server over
the internet. It requires Node.js, Android Studio with the Android SDK, and the
JDK bundled with Android Studio. Build a debug APK with:

```bash
npm install
npm run android:apk
```

Google sign-in in Android uses the system browser and returns to the app through
the `dz.loupgarou.game://auth` deep link. Notification permission is requested
from the in-app notifications panel; Android notifications are generated while
the app is active and polling for account notifications. The API allows
Capacitor's local WebView origins (`https://localhost` and
`capacitor://localhost`) so native sign-in completion can exchange its code.

### Android app updates

The Android app checks `client/public/app-update.json` on launch and when it
returns to the foreground. Native updates use Android Download Manager, show
download progress, can be resumed or cancelled, and open the Android installer
when complete. To publish an update, increment `versionCode` and `versionName`
in `android/app/build.gradle`, update the manifest's version, build the APK, and
copy it to `app-release/loup-garou-dz.apk`. Netlify publishes this file at the
download URL in the manifest. Android asks the user to confirm installation;
uninstalling the previous app is not required. Updates must be signed with the
same signing key as the installed app.

The APK that predates the update checker cannot display its own update prompt.
Install the first APK that includes the checker manually; later versions can
notify users from inside the app.

The APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. This debug-signed APK can
be installed directly for testing; publishing on Google Play requires a
separately signed release build. Set the server origin in
`client/.env.production` before building if it changes. Android launcher icons
and installable-web-app icons are generated from the supplied wolf artwork.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server + client with Vite |
| `npm run build` | Build both server (TS -> dist-server) and client (Vite -> dist) |
| `npm run android:apk` | Build the web client and a debug Android APK |
| `npm run typecheck` | Run TypeScript type check |
| `npm run test` | Run vitest tests (27 passing) |
| `npm run seed` | Seed database with default admin user |

## 🏗 Deployment

### Single Instance (Recommended for starting)

```bash
# Production build
npm run build

# Start production server
node server/dist-server/index.js
```

### Multi-Instance (Redis Required)

For scaling beyond single instance, add Redis or shared store for:
- Room state synchronization
- Matchmaking queue coordination
- Player session persistence

### Docker

```bash
# Build and run with docker-compose
docker build -t loupgarou .
docker run -p 4100:4100 -p 5173:5173 loupgarou
```

### Production Checklist

- [ ] Set `JWT_SECRET` to ≥24 random characters
- [ ] Configure `ADMIN_PASSWORD` or disable admin auth
- [ ] Set production `NODE_ENV=production`
- [ ] Configure domain/SSL if using custom domain
- [ ] Set up PM2 or systemd service for the server
- [ ] Configure CDN for static assets (dist/)
- [ ] Set up domain SSL certificate
- [ ] Configure cron or systemd timer for game cleanup
- [ ] Test with real players

## 📁 Project Structure

```
loupgarou/
├── package.json          # Root config, scripts, dependencies
├── server/              # Node/Express/Socket.IO server
│   ├── src/
│   │   ├── index.ts     # Entry point, middleware, routes
│   │   ├── game/        # Game engine, roles, rooms manager
│   │   ├── auth/        # JWT auth, password handling
│   │   ├── db/          # SQLite wrapper & schema
│   │   └── routes/      # REST API routes
│   └── dist/            # Compiled output
├── client/              # React Vite frontend
│   ├── src/
│   │   ├── pages/       # All page components
│   │   ├── contexts/    # React contexts (Auth, Socket, Settings, Toast)
│   │   ├── components/  # UI components, cards, panels
│   │   ├── lib/         # Utils: api, format, roles, audio
│   │   ├── i18n/        # Arabic interface strings
│   │   └── App.tsx      # Router + providers
│   ├── index.html       # SPA entry HTML
│   ├── vite.config.ts   # Vite config with proxy
│   └── tailwind.config.js
├── .env.example        # Environment variables template
├── scripts/            # Asset copy/build scripts
└── data/               # SQLite database (generated at runtime)
```

## 👤 Default Admin Credentials

- **Username**: `admin`
- **Password**: `Admin@12345` (configurable via `ADMIN_PASSWORD` env var)

## 🎯 Features Status

### Completed
- ✅ 27 automated tests passing (engine + rooms)
- ✅ Server boots successfully, `/api/health` verified
- ✅ Game engine with nine playable roles and Arabic role descriptions
- ✅ Room management (lobbies, matchmaking, practice bots, rematch)
- ✅ Socket.IO handlers for room lifecycle, chat, typing, game actions
- ✅ Auth system (JWT, register, login, forgot/password reset)
- ✅ Profile/Stats/Elo system with achievements
- ✅ Arabic-only interface with RTL layout
- ✅ Settings persistence via PATCH /api/profile/me
- ✅ Chat system with channels (lobby/day/dead/system)
- ✅ Admin dashboard with overview, users, games
- ✅ Matchmaking (quick, ranked queues)
- ✅ Practice AI bots
- ✅ Reconnections with stored reconnect tokens
- ✅ Rate limiting, CORS, Helmet security
- ✅ Graceful shutdown handling

### Known Limitations
- ⚠️ Single-instance only (in-memory room state)
- ⚠️ No Redis/shared store for multi-instance scaling
- ⚠️ SMTP email requires production setup
- ⚠️ SQLite experimental warning on Node 24

## 🧪 Tests

Run: `npm run test`

27 tests covering:
- Game engine: all phases, voting, hunter, night resolution, victory conditions
- Room manager: create/join, settings, chat, spectators, reconnect, matchmaking
- 20 required scenarios + live vote privacy test

## 📄 License

MIT - Copyright (c) 2026 LOUP-GAROU DZ