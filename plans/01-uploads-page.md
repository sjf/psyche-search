# Plan 01 — Uploads page

**Status:** Not implemented (stub) · **Priority:** High · **Scope:** backend + frontend

**Spec (notes.md):** Uploads page lists recently active and in-progress uploads, showing
relevant info (speed, progress, etc.).

## Current state
- `daemon-ui/src/pages/UploadsPage.tsx` is a placeholder panel ("Uploads are not exposed in the daemon API yet").
- No `/api/uploads` endpoint in `pynicotine/daemon/api.py`.
- `Sidebar.tsx` has **no** `/uploads` nav item (route exists in `App.tsx` but is unreachable via UI).
- `application.py:_on_upload_finished` only logs; nothing is recorded in `DaemonState`.

## Key facts (verified)
- `core.uploads` is an `Uploads(Transfers)` with a `.transfers` dict, exactly mirroring `core.downloads`.
- A `Transfer` exposes `username, virtual_path, status, size, current_byte_offset, folder_path, queued_at, speed, avg_speed, time_left`.
- The downloads snapshot pattern to copy is `DaemonState._downloads_snapshot_main_thread` (state.py:349) — it runs on the main thread via `events.invoke_main_thread` and waits on an event.

## Backend changes
1. **`state.py`** — add `request_uploads_snapshot()` + `_uploads_snapshot_main_thread(request_id)` mirroring the downloads pair, iterating `core.uploads.transfers.values()`. Emit dicts:
   ```python
   {"user", "path"/"virtual_path", "status", "size",
    "offset": transfer.current_byte_offset or 0,
    "speed": transfer.speed or 0, "folder": transfer.folder_path or "",
    "queued_at": transfer.queued_at or 0}
   ```
   (No `local_path` needed — uploads read from shares, not the download dir.)
2. **`api.py`** — add `@api.get("/uploads")` returning `JSONResponse(self.state.request_uploads_snapshot())`. Auth is already enforced for `/api/*` by the middleware.

## Frontend changes
3. **`Sidebar.tsx`** — add `{ to: "/uploads", label: "Uploads" }` to `navItems` (place after Downloads).
4. **`UploadsPage.tsx`** — replace the stub with a polling table modeled on `DownloadsPage.tsx`:
   - Poll `/api/uploads` every ~2s.
   - Columns: User, File, Size, Progress (offset/size bar), **Speed** (reuse `formatSpeed`), Status, Added.
   - Sortable columns (reuse the `requestSort`/`sortArrow` pattern).
   - Empty state: "No uploads yet."
   - No row actions required by the spec (uploads are driven by remote peers), so this is read-only.

## Edge cases
- Uploads with `queued_at is None` — backfill like downloads does (state.py:352).
- `transfer.speed` units: confirm bytes/sec vs KB/s against `formatSpeed` (see Plan 05 — same question) and normalize once, consistently, for both pages.
- Large numbers of finished uploads: consider capping/behind "recent" (spec says "recently active").

## Step-by-step
1. Add the two state methods (backend).
2. Add the `/api/uploads` route; smoke-test with `curl` (after login cookie) — expect `[]` when idle.
3. Add the nav link.
4. Build the Uploads table (copy DownloadsPage, strip pause/cancel/clear actions).
5. Trigger an upload from another Soulseek client and confirm rows/speed/progress update.

## Verification
Run the dev loop (daemon :7007 + `npm run dev`). Have a peer download one of your shared files; confirm the row appears with live progress + speed, and that the nav link highlights correctly.
