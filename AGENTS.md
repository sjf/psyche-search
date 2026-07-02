# Repository Guidelines

## Project Structure & Module Organization

- `pynicotine/` holds the core application code. The user-facing UI is the web front-end in `psyche-seek/`, served by the FastAPI daemon in `pynicotine/daemon/`; `pynicotine/desktop/` wraps that web UI in a native pywebview window. Headless logic lives in `pynicotine/headless/`. There is no GTK desktop UI.
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

Use `./dev.sh` — it starts the daemon and the Vite dev server together (with
Vite's `/api` + `/auth` proxy pointed at the daemon), refuses to start if
either port is taken, and takes the daemon down when it exits. Per the note
above, override both ports, and launch it detached — session teardown SIGTERMs
tracked children, and dev.sh's exit trap would take the daemon down with it:

```bash
export WEB_PORT=<port> VITE_PORT=<port>
nohup ./dev.sh > /tmp/dev-$WEB_PORT.log 2>&1 < /dev/null &
```

Extra arguments are passed through to `pseek -d` (e.g. `-c <config> -u <datadir>`
for a test daemon's own config). To stop it, kill both listeners by port:
`kill $(lsof -t -iTCP:$VITE_PORT -sTCP:LISTEN) $(lsof -t -iTCP:$WEB_PORT -sTCP:LISTEN)`.

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
   UI and API still work. When a daemon genuinely needs to be online, claim
   one of the test accounts in `.creds` (see "Claiming a `.creds` account"
   below). Only one daemon can be online per account at a time — the server
   allows one session per account, and a second login kicks the first offline.
   Do NOT register new Soulseek accounts (logging in with an unused username
   silently creates
   one) — and never use the human's real account in a test daemon.

Unlike those three, the **transfer directories are shared**: every daemon uses
the same download/incomplete/shared folders as the human's setup, so files land
in one place no matter which daemon fetched them. Copy the `[transfers]` paths
(`downloaddir`, `incompletedir`, `uploaddir`, `shared`) verbatim from
`~/.config/psycheseek/config` into each seeded config — only the config file
and data/cache folder stay per-daemon.

### Claiming a `.creds` account

`.creds` lives at the root of the MAIN checkout (untracked and gitignored; ask
the human if it's missing). Worktree sessions must use the main checkout's copy
(`git worktree list` — first entry), so every session coordinates through the
same file. Each non-comment line is one account:

- `username/password` — free
- `username/password/port` — in use by the daemon on that web port

Read or edit the file only while holding its lock, so concurrent sessions
don't trample each other's claims — and hold it just long enough for the edit:

```bash
MAIN=$(git worktree list | head -1 | awk '{print $1}')
until mkdir "$MAIN/.creds.lock" 2>/dev/null; do sleep 0.5; done
# ... read/edit $MAIN/.creds ...
rmdir "$MAIN/.creds.lock"
```

If the lock is more than a minute old (check `stat`), its owner crashed while
holding it — remove it and take it yourself.

- **Claim**: pick a line with no port and append `/<web port>` (the port you
  are about to start the daemon on).
- **No free lines?** Probe each claimed port with
  `lsof -nP -iTCP:<port> -sTCP:LISTEN`. A claimed port with no listener is
  stale — that session died without releasing — so replace its port with
  yours. If every port has a live listener, all accounts are genuinely busy;
  ask the human rather than kicking someone's daemon offline.
- **Release**: when you shut the daemon down (and in any end-of-session
  cleanup), strip your port from the line, leaving `username/password`.

Launch recipe:

```bash
free_port() { local p=$1; while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null; do p=$((p + 1)); done; echo "$p"; }

DIR=$(mktemp -d)                                  # or a session-scratchpad subdir
SLSK_PORT=$(free_port $((2300 + RANDOM % 90)))    # random base to avoid cross-session collisions

WEB_PORT=$(free_port $((7040 + RANDOM % 50)))
VITE_PORT=$(free_port $((5180 + RANDOM % 40)))

# Offline daemon (the default): wrong creds.
SLSK_USER=john SLSK_PASS=wrong-password

# Online daemon: claim a free account in $MAIN/.creds with $WEB_PORT (see
# "Claiming a .creds account" above) and use its username/password here.

cat > "$DIR/config" <<EOF
[server]
login = $SLSK_USER
passw = $SLSK_PASS
portrange = ($SLSK_PORT, $SLSK_PORT)

[transfers]
$(grep -E '^(downloaddir|incompletedir|uploaddir|shared) =' ~/.config/psycheseek/config)
EOF

WEB_PORT=$WEB_PORT VITE_PORT=$VITE_PORT WEB_HOST=127.0.0.1 nohup ./dev.sh \
  -c "$DIR/config" -u "$DIR/data" > "$DIR/dev.log" 2>&1 < /dev/null &

until curl -sf "http://127.0.0.1:$WEB_PORT/auth/me" >/dev/null; do sleep 1; done
```

Launch with `nohup ... &` (detached, log to a file) rather than as a supervised
background job — session teardown sends SIGTERM to tracked children, which
silently kills the daemon mid-use.

To shut down your own daemon, resolve its PID from the web port —
`kill $(lsof -t -iTCP:$WEB_PORT -sTCP:LISTEN)`. Do not trust the launcher's
`$!`: pseek forks, so the shell's child PID is not the daemon, and killing it
leaves the real process holding both ports (and rewriting the config on its
eventual exit, clobbering any reseeding you did in between). Never
`pkill -f pseek` — that kills other sessions' daemons and the human's. Kill
the Vite server by its port the same way, and if the daemon was on a `.creds`
account, release the claim (strip your port from its line, under the lock).

## Coding Style & Naming Conventions

- Python is the only language for core logic; follow PEP 8 with a 120-character
  line length (see `setup.cfg`).
- Use 4-space indentation and prefer descriptive, module-scoped names.
- Core modules are grouped by feature (e.g., `pynicotine/daemon/`, `pynicotine/headless/`); the web UI is grouped by feature under `psyche-seek/`.
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
- Never add `Co-Authored-By: Claude ...` (or any other Claude Code / AI
  collaborator trailer) to commit messages.
