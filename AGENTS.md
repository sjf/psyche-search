# Repository Guidelines

## Project Structure & Module Organization

- `pynicotine/` holds the core application code. The user-facing UI is the web front-end in `daemon-ui/`, served by the FastAPI daemon in `pynicotine/daemon/`; `pynicotine/desktop/` wraps that web UI in a native pywebview window. Headless logic lives in `pynicotine/headless/`. There is no GTK desktop UI.
- Tests live in `pynicotine/tests/` (`unit/` and `integration/`).
- Assets and packaging metadata are under `data/` (icons, desktop files, man page).
- Translation files are in `po/`, and developer docs are in `doc/`.

## Build, Test, and Development Commands

- `./nicotine` runs the app directly from the repo.
- `python3 -m unittest` runs unit and integration tests.
- `python3 -m pycodestyle` checks formatting (line length and basic style).
- `python3 -m pylint --recursive=y .` runs linting across the tree.
- `python3 -m build` builds an sdist/wheel for packaging checks.
- Desktop app (`pseek --desktop`, macOS/Windows via pywebview): see `doc/DESKTOP_APP.md`.
- Never run servers on the default ports (FastAPI daemon 7007, Vite dev server 5173) — those are reserved for human developers. Always pick alternate ports (e.g. 7017 and 5183) when starting the daemon or front-end.

### Web UI dev servers (alternate ports)

The web UI runs two processes: the daemon and the Vite dev server. Per the note
above, start both on alternate ports (and check they're free first, e.g.
`lsof -nP -iTCP:<port> -sTCP:LISTEN`):

- Daemon: `WEB_PORT=<port> .venv/bin/python pseek -d`
- Vite: `VITE_DAEMON_PORT=<daemon-port> npm run dev -- --port <port> --strictPort`
  (`VITE_DAEMON_PORT` points Vite's `/api` + `/auth` proxy at your daemon port).

### Test daemons (multiple can coexist)

A daemon instance owns three exclusive resources. Give every instance its own
copy of each, and any number of test daemons can run side by side:

1. **A config + data folder** (`-c <config> -u <datadir>`). Never point two
   daemons (or two sessions) at the same config: the daemon rewrites the file
   on exit and after a successful web login, so concurrent owners corrupt each
   other. Never start a second daemon on the human's config
   (`~/.config/psycheseek/config`). Create a fresh directory per daemon and
   seed the config only while that daemon is stopped.
2. **A Soulseek listen port** (`[server] portrange = (N, N)` in the config,
   independent of `WEB_PORT`). When two daemons want the same port, the loser
   can never reach the Soulseek server: it loops logging "Cannot listen on
   port N" and every login through it fails with "Could not reach the Soulseek
   server". The fight is intermittent — a reconnect releases the port for a
   few seconds and the other daemon steals it — so it can look like a code
   bug. Probe for a free port at launch; never copy one from an example.
3. **A Soulseek account** (`[server] login`/`passw`; the daemon refuses to
   start without them). Most test daemons don't need to be online: seed
   deliberately wrong credentials (any taken username + wrong password) — the
   startup login fails harmlessly and the daemon idles offline while the web
   UI and API still work. When a daemon genuinely needs to be online, use one
   of the designated test accounts in `.creds` at the repo root (untracked;
   `username/password` per line, ask the human if it's missing), and accept
   that only one daemon can be online per account at a time — the
   server allows one session per account, and a second login kicks the first
   offline. Do NOT register new Soulseek accounts (logging in with an unused
   username silently creates one) — and never use the human's real account in
   a test daemon.

Launch recipe:

```bash
free_port() { local p=$1; while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null; do p=$((p + 1)); done; echo "$p"; }

DIR=$(mktemp -d)                                  # or a session-scratchpad subdir
SLSK_PORT=$(free_port $((2300 + RANDOM % 90)))    # random base to avoid cross-session collisions
WEB_PORT=$(free_port $((7040 + RANDOM % 50)))

cat > "$DIR/config" <<EOF
[server]
login = <see account rules above>
passw = <see account rules above>
portrange = ($SLSK_PORT, $SLSK_PORT)
EOF

WEB_PORT=$WEB_PORT WEB_HOST=127.0.0.1 .venv/bin/python pseek -d -c "$DIR/config" -u "$DIR/data"
```

Shut down your own daemon by PID (`kill <pid>`). Never `pkill -f pseek` — that
kills other sessions' daemons and the human's.

## Coding Style & Naming Conventions

- Python is the only language for core logic; follow PEP 8 with a 120-character
  line length (see `setup.cfg`).
- Use 4-space indentation and prefer descriptive, module-scoped names.
- Core modules are grouped by feature (e.g., `pynicotine/daemon/`, `pynicotine/headless/`); the web UI is grouped by feature under `daemon-ui/`.
- Keep dependencies minimal; standard library modules are preferred.

## Testing Guidelines

- Tests use the standard library `unittest` runner.
- Place new tests in `pynicotine/tests/unit/` or `pynicotine/tests/integration/`
  mirroring the feature area.
- Name test files `test_*.py` to match discovery expectations.

## Commit & Mainline Merge Guidelines

- Recent commits favor short, imperative summaries with optional scope prefixes,
  e.g. `GUI: strip whitespace from more text entries` or
  `dialogs/roomlist.py: stricter validation for room names`.
- Translation updates are typically labeled `Translated using Weblate (...)`.
- This repo does not use pull requests; merge changes directly to `main`.
