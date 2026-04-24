# Saarthi PMS — Deployment & Setup Guide

## Architecture Overview

```
[Vercel]          [Railway / Render]       [Supabase / Neon]
Frontend          Backend API              PostgreSQL DB
Next.js 14   →   Express.js         →   saarthi database
Port 3000         Port 4000
```

---

## Part 1 — Local Development

### Prerequisites
- Node.js 18+
- A PostgreSQL database (local or Supabase free tier)

### 1. Clone and install

```bash
git clone <your-repo>
cd saarthi-app

# Install backend deps
cd backend
npm install

# Install frontend deps
cd ../frontend
npm install
```

### 2. Backend environment

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/saarthi
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### 3. Database setup

```bash
cd backend

# Run migrations (creates all tables)
npm run db:migrate

# Create admin user (edit email/password in src/db/seed.js first!)
node src/db/seed.js
```

### 4. Frontend environment

```bash
cd frontend
cp .env.example .env.local
```

Edit `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### 5. Run both services

Terminal 1:
```bash
cd backend
npm run dev
# → Running on http://localhost:4000
```

Terminal 2:
```bash
cd frontend
npm run dev
# → Running on http://localhost:3000
```

### 6. First login
- Open: http://localhost:3000/login
- Email: social@uppercrustwealth.com
- Password: ChangeMe@123  ← (whatever you set in seed.js)

---

## Part 2 — Production Deployment

### Step 1: Database — Supabase (Free)

1. Go to https://supabase.com → New project
2. Name it "saarthi", pick a strong DB password
3. Go to Settings → Database → Connection String (URI mode)
4. Copy the `postgresql://...` string (this is your DATABASE_URL)
5. In Supabase SQL Editor, paste and run the contents of `backend/schema.sql`

### Step 2: Backend — Railway

1. Go to https://railway.app → New Project → Deploy from GitHub
2. Select your repo, set root directory to `/backend`
3. Add environment variables:
   ```
   DATABASE_URL     = <from Supabase>
   JWT_SECRET       = <64-char random hex>
   NODE_ENV         = production
   FRONTEND_URL     = https://your-app.vercel.app   (set after Step 3)
   PORT             = 4000
   ```
4. Deploy — Railway auto-detects Node.js and runs `npm start`
5. Copy the generated URL: `https://saarthi-backend.railway.app`

6. Run seed via Railway shell (once):
   ```bash
   node src/db/seed.js
   ```

### Step 3: Frontend — Vercel

1. Go to https://vercel.com → New Project → Import from GitHub
2. Set framework to "Next.js", root directory to `/frontend`
3. Add environment variable:
   ```
   NEXT_PUBLIC_API_URL = https://saarthi-backend.railway.app
   ```
4. Deploy

5. Copy Vercel URL: `https://saarthi.vercel.app`

### Step 4: Update CORS

Go back to Railway → Environment Variables:
```
FRONTEND_URL = https://saarthi.vercel.app
```
Redeploy backend.

---

## Part 3 — User Management

Only admins can create users. Use the API directly or build an admin UI:

```bash
# Create a team member
curl -X POST https://your-backend.railway.app/api/auth/create-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"email":"team@example.com","password":"Pass@123","name":"Analyst","role":"team"}'
```

Or call `authAPI.createUser()` from the frontend with an admin-logged-in session.

---

## Part 4 — Daily Workflow

1. Admin logs in → clicks "Upload Data" in sidebar
2. Drag-drop the daily Excel file
3. Backend parses it, stores to DB (old data replaced automatically per upload_id)
4. All team members see updated data immediately on refresh

---

## Part 5 — API Reference

| Method | Endpoint               | Auth     | Description                    |
|--------|------------------------|----------|--------------------------------|
| POST   | /api/auth/login        | Public   | Get JWT token                  |
| GET    | /api/auth/me           | Any      | Current user info              |
| POST   | /api/auth/create-user  | Admin    | Create team member             |
| POST   | /api/upload            | Admin    | Upload Excel file              |
| GET    | /api/upload/logs       | Admin    | Upload history                 |
| GET    | /api/upload/status/:id | Any      | Poll upload status             |
| GET    | /api/dashboard         | Any      | KPIs, sectors, top stocks      |
| GET    | /api/clients           | Any      | Client list (search, sort)     |
| GET    | /api/clients/:id       | Any      | Client detail + holdings       |
| GET    | /api/stocks            | Any      | Stock list (search, sort)      |
| GET    | /api/stocks/:symbol    | Any      | Stock detail + client map      |
| GET    | /api/risk              | Any      | Risk alerts + summary          |
| GET    | /api/tags              | Any      | Symbol tags                    |
| PUT    | /api/tags/:symbol      | Admin    | Update symbol tag              |
| GET    | /api/tags/sector-limits| Any      | Sector limit config            |
| PUT    | /api/tags/sector-limits/:sector | Admin | Update sector limit   |

---

## Part 6 — Security Notes

- JWT expires in 12 hours — users re-login daily
- Passwords are bcrypt-hashed (cost 12)
- Rate limiting: 200 req/15min globally, 20 req/15min on login
- CORS locked to FRONTEND_URL only
- Helmet sets security headers
- File upload max 20MB, xlsx/xls only
- DB transactions used for upload atomicity (all-or-nothing)

---

## Part 7 — Troubleshooting

| Problem | Fix |
|---------|-----|
| "No portfolio loaded" | Admin hasn't uploaded yet, or upload failed |
| Upload stuck in "processing" | Check Railway logs for parse errors |
| CORS errors | Verify FRONTEND_URL in backend env matches Vercel URL exactly |
| 401 on all requests | JWT_SECRET mismatch between deploys, or token expired |
| Charts not rendering | Chart.js is client-side only — confirm 'use client' on page |
| DB connection error | Check DATABASE_URL format and SSL setting |

---

## Directory Structure

```
saarthi-app/
├── backend/
│   ├── schema.sql              # Run once to create DB tables
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── server.js           # Express entry point
│       ├── config/
│       │   └── db.js           # Postgres pool
│       ├── middleware/
│       │   ├── auth.js         # JWT verify
│       │   └── upload.js       # Multer config
│       ├── routes/
│       │   ├── auth.js         # Login, create user
│       │   ├── upload.js       # Excel upload + processing
│       │   ├── dashboard.js    # Aggregated KPIs
│       │   ├── clients.js      # Client list + detail
│       │   ├── stocks.js       # Stock list + detail
│       │   ├── risk.js         # Risk engine output
│       │   └── tags.js         # Symbol tags + sector limits
│       ├── services/
│       │   ├── parser.js       # Excel → structured data (ported 1:1)
│       │   └── riskEngine.js   # Risk rules (ported 1:1)
│       └── db/
│           ├── migrate.js      # Run schema.sql
│           └── seed.js         # Create admin user
│
└── frontend/
    ├── next.config.js
    ├── package.json
    ├── .env.example
    └── src/
        ├── app/
        │   ├── layout.jsx        # Root layout + fonts
        │   ├── page.jsx          # Redirects → /dashboard
        │   ├── login/page.jsx    # Login screen
        │   ├── dashboard/page.jsx
        │   ├── clients/
        │   │   ├── page.jsx      # Client list
        │   │   └── [id]/page.jsx # Client detail
        │   ├── stocks/page.jsx
        │   ├── risk/page.jsx
        │   └── upload/page.jsx   # Admin only
        ├── components/
        │   ├── layout/
        │   │   ├── Sidebar.jsx
        │   │   └── DashboardShell.jsx
        │   └── ui/
        │       └── KPICard.jsx
        ├── lib/
        │   ├── api.js           # All fetch calls
        │   ├── auth.js          # Session helpers
        │   └── formatters.js    # ₹ formatters, colours
        └── styles/
            └── globals.css      # Design tokens + utility classes
```
