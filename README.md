<!--
  SPDX-FileCopyrightText: 2026 PsycheSeek Contributors
  SPDX-FileCopyrightText: 2013-2025 Nicotine+ Contributors
  SPDX-License-Identifier: GPL-3.0-or-later
-->

<p align="center">
  <img src="assets/banner.svg" alt="PsycheSeek — a neon web control plane for Soulseek" width="100%">
</p>

<p align="center">
  <b>PsycheSeek</b> (<code>pseek</code>) is a modern client for finding and downloading music over the
  <a href="https://www.slsknet.org/news/">Soulseek</a> network — a native <b>desktop app for macOS and Windows</b>,
  and a self-hosted <b>web app</b> you can run headless on your media server next to the *arr stack.
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white">
  <img alt="License GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-ff2e97?style=for-the-badge">
</p>

---

## What is this?

The *arr stack (Sonarr, Radarr, Lidarr…) automates almost everything on a home
media server — but **music is the gap**. Lidarr can't touch Soulseek, which is
where the rare, out-of-print and lossless releases actually live.

**PsycheSeek fills that gap.** It's a brand-new **React + TypeScript** front-end
and a small **FastAPI** daemon that turn a Soulseek connection into a clean, fast
app — search, download, browse and play. It gives you the full power of the classic
Soulseek client in a **far more modern, responsive interface**, and runs two ways:

- 🖥️ **As a native desktop app** for **macOS and Windows** — [download a build](https://github.com/sjf/psyche-search/releases)
  and open it like any other app, in its own window.
- 🌐 **As a self-hosted web app** on a headless server — no desktop environment, no GTK,
  just a browser tab, right next to Plex or Jellyfin.

Under the hood it uses **[Nicotine+](https://github.com/nicotine-plus/nicotine-plus)**
purely as the Soulseek protocol engine. Everything you see and touch is new.

> Think of it as **Lidarr's missing Soulseek companion**: park it next to Plex or
> Jellyfin, point it at your download directory, and pull music straight into your
> library.

<p align="center">
  <img src="assets/search-results.png" alt="Search results grouped by user and folder, with size, bitrate and sample-rate attributes" width="100%">
</p>
<p align="center">
  <img src="assets/search-home.png" alt="The search home page with recent searches" width="100%">
</p>

## Highlights

- 🔎 **Search** the Soulseek network with recent-search history and a filter syntax
  (`minbitrate:`, `minfilesize:`, `isvbr`, …).
- 🗂️ **Results** grouped by user and folder, with size, bitrate, encoding and
  attributes — every column sortable, free slots surfaced, one-click downloads.
- 👤 **Browse a user's whole share** straight from a result, and grab any folder.
- ⬇️ **Downloads manager** — live progress and speed, pause / cancel, clear
  completed, sort by any column.
- 📁 **File browser** for your downloaded and shared directories: an expanding tree
  with audio metadata (artist / title / album / year), rename, delete, and
  configurable download + share folders.
- ▶️ **Built-in player** that keeps playing as you move between pages (Spotify-style),
  reads tags for artist/title/album, and lets you queue tracks — with an animated
  canary-song equalizer while it plays.
- 💬 **Chat** view for recently received messages.
- ⚙️ **Settings** for your session, connection status and directories.

## Desktop app

PsycheSeek runs as a **native desktop app** on **macOS and Windows** — the same UI in
its own window, plus local touches like *Reveal in Finder / Explorer* and *Open in the
default app* for your downloads.

- **Download** a prebuilt app from the [releases page](https://github.com/sjf/psyche-search/releases)
  — macOS `.dmg`, Windows `.zip`. Builds are currently unsigned, so on first launch macOS
  needs right‑click → **Open** and Windows SmartScreen needs **More info → Run anyway**.
- **From source**, launch the native window instead of the web server:

  ```bash
  .venv/bin/python pseek --desktop
  ```

## Design

PsycheSeek ships a flat **"neon-wire" cyberpunk** look. The full design system —
palette, typography and motion — is documented in **[DESIGN.md](DESIGN.md)**.

## Architecture

```
┌──────────────────────────────┐
│  daemon-ui/  React 19 + TS    │  Vite SPA — the entire UI
└──────────────┬───────────────┘
               │  /api  /auth   (REST + SPA served on :7007)
┌──────────────┴───────────────┐
│  pynicotine/daemon/  FastAPI  │  headless daemon (this project)
└──────────────┬───────────────┘
               │
┌──────────────┴───────────────┐
│  pynicotine/  Nicotine+ core  │  Soulseek protocol engine (dependency)
└──────────────────────────────┘
```

- `daemon-ui/` — the React + TypeScript + Vite single-page app.
- `pynicotine/daemon/` — a FastAPI daemon that exposes the REST API and serves the
  built SPA on `127.0.0.1:7007`.
- `pynicotine/` — the vendored **Nicotine+** core, used only as the Soulseek engine.

## Quick start

**Requirements:** Python 3 and Node.js.

```bash
# 1. Bootstrap: creates .venv, installs deps, builds the web UI
./build.sh

# 2. Configure your Soulseek credentials in ~/.config/nicotine/config
#    (the [server] section: login / passw)

# 3. Run the daemon (must use the venv Python)
.venv/bin/python pseek -d
```

Then open **http://localhost:7007** and sign in with your Soulseek credentials.
On a server, put it behind your reverse proxy of choice.

## Running with Docker

The image builds the web UI and runs the daemon headless — ideal for a media
server. Your share, download and in-progress directories are mounted in as
volumes.

**With Docker Compose** (recommended). Edit the volume paths in
[`docker-compose.yml`](docker-compose.yml), then:

```bash
SLSK_USERNAME=your_user SLSK_PASSWORD=your_pass docker compose up -d --build
```

**With `docker run`:**

```bash
docker build -t psyche-search:latest .

docker run -d --name psyche-search --restart unless-stopped \
  -p 7007:7007 \        # web UI
  -p 2234:2234 \        # Soulseek peer port (forward this on your router)
  -e PUID=1000 -e PGID=1000 \
  -e SLSK_USERNAME=your_user -e SLSK_PASSWORD=your_pass \
  -v /srv/psyche-search/config:/config \       # config file + app state
  -v /srv/downloads:/downloads \               # completed downloads
  -v /srv/incomplete:/incomplete \             # in-progress downloads
  -v /srv/music/albums:/shares/albums:ro \     # a share
  -v /srv/music/singles:/shares/singles:ro \   # another share
  psyche-search:latest
```

Then open **http://your-server:7007** and sign in with your Soulseek credentials.

`SLSK_USERNAME` / `SLSK_PASSWORD` are **optional** — if you omit them the
container still starts and you sign in on the login page; the daemon saves those
credentials to `/config/config` and reuses them on later starts.

**How the volumes work:**

| Mount | Purpose |
| --- | --- |
| `/config` | Config file and app state (logs, database). Persist this. |
| `/downloads` | Completed downloads. |
| `/incomplete` | In-progress downloads. |
| `/shares/<name>` | Each subdirectory becomes one share, named after the folder. Mount as many as you like; keep them `:ro`. |

Notes:

- `SLSK_USERNAME` / `SLSK_PASSWORD` only **seed** `/config/config` on first run
  (and can be omitted — see above). After that the mounted config is
  authoritative — change credentials, shares or directories there (or in the
  **Settings** page) and restart.
- `PUID` / `PGID` set the uid/gid that owns files written to the mounted volumes
  (default `1000:1000`). Set them to match your host user.
- Forward port **2234** on your router so peers can connect for uploads.

### Developing the UI

Run the daemon for the API, then start Vite with hot-reload:

```bash
cd daemon-ui
npm run dev        # http://localhost:5173, proxies /api and /auth → :7007
```

Edit `.tsx` files for instant HMR. Restart the daemon after Python changes.
Lint with `npm run lint`; run backend tests with `python3 -m unittest`.

## License

PsycheSeek is free software, released under the
[GNU General Public License v3.0 or later](https://www.gnu.org/licenses/gpl-3.0-standalone.html),
inherited from Nicotine+.

© 2026 PsycheSeek Contributors · © 2001–2025 Nicotine+, Nicotine and PySoulSeek Contributors
