# Plan 02 — Directory configuration (edit download dir + add/remove shares)

**Status:** Not implemented (display-only) · **Priority:** High · **Scope:** backend + frontend

**Spec (notes.md):** The user can configure the download and shared directories — change the
download directory, and add/remove share directories.

## Current state
- `components/DirectoriesModal.tsx` renders the download dir and each shared dir as `readOnly disabled` inputs. No add/remove/change controls, no save.
- `api.py` has only `GET /api/config/directories` — no write endpoint.
- Opened read-only from both `SettingsPage.tsx` and `FilesPage.tsx`.

## Key facts (verified)
- Download dir lives at `config.sections["transfers"]["downloaddir"]` (set exactly this way in `gtkgui/dialogs/fastconfigure.py:166`).
- Shares live at `config.sections["transfers"]["shared"]` as a list of `[virtual_name, folder_path, ...]` tuples (iterated as `for virtual_name, folder_path, *_ in ...["shared"]` in fastconfigure.py:338).
- Apply changes with `core.shares.rescan_shares()` and persist with `config.write_configuration()`.
- Config mutation + rescan must run on the **main thread** → wrap in `events.invoke_main_thread` like the other `DaemonState` mutators.

## Backend changes (`api.py` + `state.py`)
Add write endpoints (all `POST`, form-encoded, 204 on success):
1. `POST /api/config/download-dir` — form `path`. Validate it's an existing absolute directory (`os.path.isdir`). Set `downloaddir`, `write_configuration()`.
2. `POST /api/config/shares/add` — form `path` (+ optional `name`). Reject if not a dir or already shared. Derive a virtual name from the basename if none given; ensure uniqueness. Append `[name, path]` to `shared`, `rescan_shares()`, `write_configuration()`.
3. `POST /api/config/shares/remove` — form `path`. Remove the matching entry from `shared`, `rescan_shares()`, `write_configuration()`.

Implement the mutations as `DaemonState` methods (`set_download_dir`, `add_share`, `remove_share`) that hop to the main thread, so config is never mutated from the web thread.

> Path input: the daemon is headless, so there's no native folder picker. The user types an absolute server path. Validate server-side and return a 400 with a clear message on a bad path.

## Frontend changes (`DirectoriesModal.tsx`)
Convert to an editable modal (lift or add local state; it currently takes props only):
- **Download**: editable text input + "Save" (calls `/api/config/download-dir`).
- **Shared**: list with a "Remove" (trash) button per row + an "Add folder" input with an "Add" button.
- On success, refetch `/api/config/directories` and update; toast success/failure via `useToast`.
- After changes, callers (`FilesPage`) should refetch `/api/files/tree.json` so the browser reflects new shares.

## Edge cases
- Removing the download dir is not allowed (there's always exactly one) — only *change* it.
- Adding a nested path already inside an existing share, or a non-existent path → validate + 400.
- Virtual-name collisions across shares → enforce unique names.
- Rescan is async (`use_thread=True` default); the UI should indicate "rescanning…" and the shares/files list will populate shortly (the status endpoint already surfaces scanning state via `share_status`).

## Step-by-step
1. Add the three `DaemonState` mutators (main-thread) + persistence.
2. Add the three routes; `curl`-test each (bad path → 400, good path → 204).
3. Make `DirectoriesModal` editable; wire the three calls + refetch.
4. Confirm `SettingsPage` and `FilesPage` both open the editable modal and refresh after edits.

## Verification
Add a share pointing at a folder with audio, Save, and confirm it appears under **Shared** in the Files tree after the rescan; change the download dir and confirm new downloads land there.
