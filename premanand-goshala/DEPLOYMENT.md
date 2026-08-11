# Premanand Goshala — Deployment & Operations Guide

How to run the app locally, how to deploy to the production server, and how to
safely reset (clean) production data — without ever losing data on a redeploy.

---

## 0. Which database file is which  ⭐ read this first

There are **two completely separate databases**. They never touch each other.
To avoid confusion, each has a **different file name** and lives in a **different
place**:

| | LOCAL (your PC) | PRODUCTION (server) |
|---|---|---|
| **File name** | `goshala-local.db` | `goshala-production.db` |
| **Folder** | `E:/TestGo/GoshalaData/` | `~/goshala-data/` (e.g. `/home/USER/goshala-data/`) |
| **Full path** | `E:/TestGo/GoshalaData/goshala-local.db` | `/home/USER/goshala-data/goshala-production.db` |
| **Set in** | local `.env` → `DB_PATH` | server `.env` → `DB_PATH` |
| **Contains** | test/demo data you play with | real member/donation data |

Both folders are **outside the app/repo folder**, so a `git pull` / redeploy can
never overwrite or delete either one. When the app starts it prints exactly which
file it is using:

```
Database: E:/TestGo/GoshalaData/goshala-local.db          ← local
Database: /home/USER/goshala-data/goshala-production.db    ← production
```

> **Rule of thumb:** if the path has `-local.db` you are on your PC; if it has
> `-production.db` you are on the live server. Never copy one over the other by
> accident.

---

## 1. How it works

The app is a **Node.js + Express** server (`server.js`) using a **SQLite**
database via `better-sqlite3`. It serves the static HTML pages and a JSON API.

Each database is a single file (e.g. `goshala-local.db`) plus two temporary
sidecar files (`...-wal` and `...-shm`) that exist only while the app runs.

**The golden rule:** the database, uploaded images, and backups must live
**outside** the folder that gets replaced on every deploy. This project is now
configured that way:

| Data | Where it lives | Controlled by |
|------|----------------|----------------|
| Database file | Outside the repo (see §0) | `DB_PATH` in `.env` |
| Backups | Outside the repo | `BACKUP_DIR` in `.env` |
| Uploaded images | `uploads/` (gitignored) | fixed |
| Login-token secret | `data/.jwt_secret` (gitignored) | `JWT_SECRET` in `.env` (optional) |

Because these are all gitignored / outside the repo, a `git pull` on the server
can never touch them.

---

## 2. Environment variables (`.env`)

Both local and production read settings from a `.env` file in the app folder.
This file is **gitignored** — it is never committed, and local and production
each keep their **own** copy. Start from `.env.example`.

| Variable | Required | Purpose |
|----------|----------|---------|
| `DB_PATH` | Recommended | Full path to the database file. Point it **outside** the deploy folder. Local: `...goshala-local.db`; Production: `...goshala-production.db`. |
| `BACKUP_DIR` | Recommended | Folder where DB backups are written. Keep it outside the deploy folder. |
| `BACKUP_RETENTION` | Optional | How many recent backups to keep (default `14`). |
| `JWT_SECRET` | Prod: yes | Long random string used to sign login tokens. If unset, one is generated and saved to `data/.jwt_secret`. |
| `ADMIN_EMAIL` | First run | Email of the admin account created on the **first run with an empty database**. |
| `ADMIN_PASSWORD` | First run | Password for that admin account. **Set this** — otherwise the insecure default `admin123` is used. |
| `NODE_ENV` | Prod: yes | Set to `production` on the server. Leave unset locally. |
| `ALLOWED_ORIGINS` | Optional | Comma-separated browser origins allowed to call the API. Empty = same-origin only. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Optional | Online payments. Leave blank to disable (UPI QR still works). |
| `PORT` | Optional | Port to listen on. Hostinger usually provides this; defaults to `3000`. |

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 3. Running LOCALLY (your PC — Windows)

Your local machine is already set up. The local database is
**`E:/TestGo/GoshalaData/goshala-local.db`**, configured in `.env`:

```ini
DB_PATH=E:/TestGo/GoshalaData/goshala-local.db
BACKUP_DIR=E:/TestGo/GoshalaData/backups
```

### First-time setup (only if starting fresh)

```powershell
cd E:\TestGo\Goshala\premanand-goshala
npm install
copy .env.example .env      # then edit .env: set DB_PATH / BACKUP_DIR / ADMIN_PASSWORD
```

### Start the app

```powershell
cd E:\TestGo\Goshala\premanand-goshala
npm start
```

Open **http://localhost:3000/**. On startup the console confirms the LOCAL file:

```
Database initialized
Server running at http://localhost:3000/
Database: E:/TestGo/GoshalaData/goshala-local.db
```

- Admin login: **http://localhost:3000/admin-login.html**
- Stop the server with **Ctrl+C**.

> **Tip:** `EADDRINUSE: address already in use :::3000` means a copy is still
> running. Stop it with `taskkill /F /IM node.exe`, then start again.

---

## 4. Deploying to PRODUCTION (Hostinger, git-pull)

Production deploys by pulling from GitHub. Two phases:

- **4A. One-time setup** — put the live database outside the deploy folder, with
  the name `goshala-production.db`.
- **4B. Every future deploy** — just pull and restart.

### 4A. One-time setup (run once on the server)

SSH into the server and go to the app folder (adjust the path to yours):

```bash
cd ~/premanand-goshala          # wherever the app is deployed
```

**Step 1 — Move the live database out of the repo, with the production name:**

```bash
mkdir -p ~/goshala-data
cp data/goshala.db ~/goshala-data/goshala-production.db   # your real data, renamed
```

**Step 2 — Point the production `.env` at it.** Production keeps its **own**
`.env` (never the local one). Add / set these lines:

```ini
DB_PATH=/home/USER/goshala-data/goshala-production.db
BACKUP_DIR=/home/USER/goshala-data/backups
NODE_ENV=production
JWT_SECRET=<paste a long random string>
ADMIN_EMAIL=admin@yourdomain.org
ADMIN_PASSWORD=<a strong password>
```

(Replace `/home/USER/` with your real home path — run `echo $HOME` to see it.)

**Step 3 — Clean the working tree so the pull applies, then pull.**
(Your real data is already safe in `~/goshala-data` from Step 1.)

```bash
git checkout -- data/goshala.db 2>/dev/null || true
git pull origin main
```

**Step 4 — Install dependencies (if changed) and restart:**

```bash
npm install --omit=dev
pm2 restart all          # or the Hostinger Node panel "Restart" button
```

Confirm the logs show the PRODUCTION file:

```
Database: /home/USER/goshala-data/goshala-production.db
```

From now on the database lives outside the deploy folder — **no future deploy
can overwrite or delete it.**

### 4B. Every future deploy (the normal routine)

```bash
cd ~/premanand-goshala
git pull origin main
npm install --omit=dev      # only if dependencies changed
pm2 restart all             # or the Hostinger "Restart" button
```

Database, backups, and uploaded images are untouched.

---

## 5. Cleaning / resetting PRODUCTION data (start fresh)

Use this to **wipe all production data** (members, donations, events, gallery…)
and start with an empty database and a fresh admin login.

> ⚠️ **This deletes everything in the production database.** Take a backup first —
> you can restore it later if needed. Double-check you are on the **production**
> server and the file name is `goshala-production.db`.

On the server:

```bash
cd ~/premanand-goshala

# 1. Stop the app first (so the DB isn't in use)
pm2 stop all                 # or stop it from the Hostinger panel

# 2. Safety backup of current data (timestamped)
cp ~/goshala-data/goshala-production.db ~/goshala-data/goshala-production-BEFORE-RESET.db

# 3. Delete the database files (app will recreate an empty one)
rm -f ~/goshala-data/goshala-production.db \
      ~/goshala-data/goshala-production.db-wal \
      ~/goshala-data/goshala-production.db-shm

# 4. (Optional) also remove uploaded images to fully clean the site
#    Skip this line to keep existing images.
rm -f uploads/*

# 5. Ensure the admin login is set in .env (used because the DB is now empty):
#    ADMIN_EMAIL=admin@yourdomain.org
#    ADMIN_PASSWORD=<a strong password>

# 6. Start the app again
pm2 start all                # or the Hostinger "Restart" button
```

On this next start the app recreates all tables empty and creates the admin
account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Log in at
`https://yourdomain/admin-login.html` and begin with clean data.

> **Default admin:** if `ADMIN_EMAIL` / `ADMIN_PASSWORD` are not set, the app
> falls back to `admin@goshala.org` / `admin123` — **insecure**. Always set your
> own before the first start on an empty database.

### Cleaning LOCAL data instead

Same idea on your PC — note the **local** file name:

```powershell
cd E:\TestGo\Goshala\premanand-goshala
taskkill /F /IM node.exe 2>$null
del "E:\TestGo\GoshalaData\goshala-local.db" "E:\TestGo\GoshalaData\goshala-local.db-wal" "E:\TestGo\GoshalaData\goshala-local.db-shm"
npm start
```

---

## 6. Backups & restore

- **Automatic:** the app writes a backup to `BACKUP_DIR` on startup and keeps the
  most recent `BACKUP_RETENTION` (default 14). Because `BACKUP_DIR` is outside the
  deploy folder, backups survive redeploys.
- **Manual backup (production):**
  ```bash
  cp ~/goshala-data/goshala-production.db ~/goshala-data/goshala-production-$(date +%Y%m%d).db
  ```
- **Restore a backup (production):**
  ```bash
  pm2 stop all
  cp ~/goshala-data/backups/goshala-YYYYMMDD-HHMMSS.db ~/goshala-data/goshala-production.db
  rm -f ~/goshala-data/goshala-production.db-wal ~/goshala-data/goshala-production.db-shm
  pm2 start all
  ```

---

## 7. Troubleshooting

**`fatal: unable to write new index file` (git on Windows).**
The `.git` folder is owned by `Administrators` and your user lacks Delete rights.
Fix once, from an **elevated** PowerShell (Run as Administrator):

```powershell
icacls "E:\TestGo\Goshala" /grant "$env:USERNAME:(OI)(CI)F" /T /C
```

**`EADDRINUSE: address already in use :::3000`.**
Another instance is running. `taskkill /F /IM node.exe` (Windows) or
`pm2 restart all` (server), then start again.

**The database keeps getting overwritten on deploy.**
Confirm `DB_PATH` in the server's `.env` points **outside** the deploy folder and
that `git ls-files | grep goshala` returns **nothing** (it must not be tracked).

**Everyone gets logged out after a restart.**
Set a fixed `JWT_SECRET` in `.env` so it doesn't regenerate each restart.

**Not sure which DB the app is using?**
Look at the `Database: ...` line it prints on startup — `-local.db` = your PC,
`-production.db` = the live server.

---

## 8. Quick reference

| Task | Command |
|------|---------|
| Run locally | `npm start` → http://localhost:3000/ |
| Deploy update (server) | `git pull origin main && npm install --omit=dev && pm2 restart all` |
| Back up prod DB | `cp ~/goshala-data/goshala-production.db ~/goshala-data/goshala-production-$(date +%Y%m%d).db` |
| Reset production data | Stop → delete `goshala-production.db*` in `~/goshala-data` → start |
| Check DB is untracked | `git ls-files \| grep goshala` (should be empty) |
| Which DB am I using? | Read the `Database: ...` line on startup |
