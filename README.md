<img width="2556" height="1286" alt="Screenshot 2026-04-20 at 12 54 23 PM" src="https://github.com/user-attachments/assets/0d6ebdb3-2d54-4a39-b958-f09b54f6e68e" />

# GridDock — Local Container Dashboard

A sleek, resizable grid dashboard for managing local container web UIs. All tile positions and sizes persist in SQLite. Using it for studying since all my windows get very messy very quickly on mac os and I just use docker containers anyway. Wish for better window management. 

## Features

- **Add tiles** — paste any URL, optionally give it a label
- **Resize tiles** — drag the corner handle; neighbors reflow automatically
- **Remove tiles** — one-click ×
- **Rename tiles** — pencil icon in the header
- **Background image** — upload any JPG/PNG/WebP via the 📷 toolbar button
- **Persistent** — SQLite database survives restarts

## Quick Start

### With Docker Compose (recommended)

```bash
docker compose up -d
```

Open http://localhost:3000

### Local dev (Node 18+)

```bash
npm install
npm start          # or: npm run dev (with auto-reload)
```

## Accessing other containers

If your other containers expose ports on the **host**, use `http://localhost:PORT` or `http://host.docker.internal:PORT` (see the commented `extra_hosts` in `docker-compose.yml`).

For containers on the **same Docker network**, use the service name: `http://myservice:PORT`.

## Ports & volumes

| Item | Default |
|------|---------|
| HTTP port | `3000` |
| SQLite DB | Docker volume `dashboard_data` |
| Uploaded images | Docker volume `dashboard_uploads` |

Override the port by changing `3000:3000` in `docker-compose.yml`.

## Tech stack

- **Backend** — Node.js + Express + better-sqlite3
- **Frontend** — Vanilla JS, CSS Grid, no framework needed
- **Persistence** — SQLite (single file, zero config)
