# PeTa — Penghasilan Tambahan

Indonesian micro-task earning platform. Members earn by commenting / upvoting on Reddit.

## Repo layout

```
.
├── peta/                  # The actual app (Vite + React + Supabase)
│   ├── src/
│   ├── supabase/migrations/   # Schema-as-code, applied via `supabase db push`
│   ├── package.json
│   └── vercel.json
├── CLAUDE.md              # Project state for AI sessions (auto-loaded)
├── DEPLOYMENT.md          # Step-by-step prod deploy to penghasilantambahan.com
└── README.md              # This file
```

## Local dev

```bash
cd peta
cp .env.example .env.local     # then fill in your staging Supabase keys
npm install
npm run dev                     # http://localhost:5173
```

Login as admin: `info@jetdigitalpro.com` / `peta` (staging only).

## Deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md). TL;DR:
- `staging` branch → `staging.penghasilantambahan.com` (Supabase project `peta-staging`)
- `main` branch → `penghasilantambahan.com` (Supabase project `peta-prod`)

## Stack

Vite 8 · React 19 · TypeScript · Tailwind v4 · Supabase · React Query · React Router 7
