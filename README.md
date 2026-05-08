<img width="2556" height="1286" alt="Screenshot 2026-04-20 at 12 54 23 PM" src="https://github.com/user-attachments/assets/0d6ebdb3-2d54-4a39-b958-f09b54f6e68e" />

# GridDock — Local Container Dashboard

A sleek, resizable grid dashboard for managing local container web UIs. All tile positions and sizes persist in SQLite. Using it for studying since all my windows get very messy very quickly on mac os and I just use docker containers anyway. Wish for better window management. 


## Features

- **Multiple workspaces** — tab bar at the top; create, rename, and delete workspaces
- **Add tiles** — paste any URL, optionally give it a label
- **Resize tiles** — drag the E / S / SE handles; layout snaps to a 12-column grid
- **Drag to reposition** — grab the tile header and drop anywhere on the grid
- **Zoom per tile** — `−` / `+` buttons in the tile header scale iframe content from 25% to 300%; fills the tile at every zoom level. Persists across reloads.
- **Force dark mode per tile** — moon icon inverts the iframe's colors (CSS filter trick). Persists across reloads.
- **Proxy mode per tile** — globe icon rewrites all requests through the built-in reverse proxy to bypass `X-Frame-Options` headers
- **PDF widgets** — upload PDFs and embed them as tiles via the ⊕ PDF toolbar button
- **Background image** — upload any JPG/PNG/WebP via the 🖼 toolbar button
- **Hide toolbar** — collapse the top bar; a small tab re-expands it
- **Toggle borders** — hide tile borders for a cleaner look
- **Persistent** — SQLite database with automatic schema migrations; survives restarts and upgrades

## Quick Start

### With Docker Compose (recommended)

```bash
docker compose up -d
```

Open http://localhost:3006

### Local dev (Node 18+)

```bash
npm install
npm start          # or: npm run dev  (nodemon auto-reload)
```

Open http://localhost:3006

## Accessing other containers

If your other containers expose ports on the **host**, use `http://localhost:PORT` or `http://host.docker.internal:PORT` (see the commented `extra_hosts` in `docker-compose.yml`).

For containers on the **same Docker network**, use the service name: `http://myservice:PORT`.

If a service blocks embedding via `X-Frame-Options`, enable **Proxy mode** on that tile — the built-in proxy strips those headers and rewrites HTML/JS/CSS URLs transparently.

## Ports & volumes

| Item | Value |
|------|-------|
| HTTP port | `3006` (hardcoded) |
| SQLite DB | Docker volume `dashboard_data` |
| Uploaded files | Docker volume `dashboard_uploads` |

## Tech stack

- **Backend** — Node.js + Express + better-sqlite3
- **Frontend** — Vanilla JS, CSS Grid, no build step
- **Persistence** — SQLite with append-only migrations (safe on existing databases)
