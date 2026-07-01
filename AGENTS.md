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

The daemon also binds a **Soulseek listen port**, which comes from the config
file (`[server] portrange`), not from `WEB_PORT`. Two daemons sharing a config
fight over that port, and the loser can never reach the Soulseek server — every
login through it fails with "Could not reach the Soulseek server". So:

- Never start a second daemon on the user's config
  (`~/.config/psycheseek/config`). Besides the port fight, it shares the user's
  Soulseek account (concurrent logins kick each other off the server) and races
  config writes on exit.
- Agent-started daemons must use an isolated config and data folder:
  `WEB_PORT=<port> .venv/bin/python pseek -d -c <scratch-config> -u <scratch-datadir>`.
  Seed the scratch config with `[server]` `login`/`passw` (the daemon refuses to
  start without them) and a unique `portrange = (N, N)` — pick a free port
  (e.g. in 2240–2399, check with `lsof -nP -iTCP:<N> -sTCP:LISTEN`) rather than
  copying a port number from an example.

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
