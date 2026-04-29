# 2b2t Queue Server

A self-hosted 2b2t queue proxy with web dashboard. Waits in queue on your server, lets you hop in with your modded client when ready.

## How it works

```
Your client (modded) ──► Proxy (Docker) ──► 2b2t
                              │
                         Mineflayer bot
                         (queue wait + anti-AFK
                          when you're not connected)
```

- Proxy stays connected to 2b2t 24/7 — no disconnects on handoff
- Mineflayer bot handles queue waiting and anti-AFK automatically
- Auto-respawns on death to keep the session alive
- Web dashboard (mobile-friendly) to start/stop and monitor queue position
- Connect any client — modded, vanilla, Baritone, whatever

## Requirements

- Docker + Docker Compose
- A server accessible via your local network or VPN
- A 2b2t account

## Setup

```bash
cp .env.example .env
# fill in your credentials
docker compose up -d
```

Then open `http://your-server-ip:3000` in your browser.

To connect your Minecraft client, point it at `your-server-ip:25565`.

## Usage

1. Open the dashboard and hit **Start**
2. Bot connects to 2b2t and waits in queue
3. Dashboard shows live queue position
4. When you're ready, connect your client to the proxy address
5. Bot steps aside, you're in — no disconnect from 2b2t

## Configuration

| Variable | Description |
|---|---|
| `MC_USERNAME` | Your Minecraft username |
| `MC_PASSWORD` | Your Minecraft password (or leave blank for offline/token auth) |
| `MC_AUTH` | Auth type: `microsoft` or `offline` |
| `PROXY_PORT` | Port your client connects to (default: `25565`) |
| `WEB_PORT` | Dashboard port (default: `3000`) |
| `ALLOWED_IPS` | Comma-separated IPs allowed to connect to proxy (leave blank to allow all) |
