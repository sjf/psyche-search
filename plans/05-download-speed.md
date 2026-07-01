# Plan 05 — Download speed column

**Status:** Partial (progress + status shown, no speed) · **Priority:** Medium · **Scope:** backend + frontend

**Spec (notes.md):** Each download shows a status bar, speed, etc.

## Current state
- `DownloadsPage.tsx` columns: User, File, Size, Progress, Status, Added — **no speed**.
- The backend downloads snapshot (`state.py:_downloads_snapshot_main_thread`, ~line 366) omits speed even though the `Transfer` object has `.speed` (and `.avg_speed`).

## Key facts (verified)
- `Transfer` exposes `speed` and `avg_speed` (transfers.py:80–81). They're maintained during active transfers and reset to 0 when idle/finished.

## Backend changes (`state.py`)
1. Add `"speed": transfer.speed or 0` to the download dict in `_downloads_snapshot_main_thread` (and optionally `"avg_speed"`).

## Frontend changes (`DownloadsPage.tsx`)
2. Add `speed?: number` to `DownloadItem`.
3. Add a **Speed** column (between Progress and Status) using a `formatSpeed` helper — copy the one in `SearchPage.tsx`/`SearchResultsPage.tsx` (or lift it to a shared util).
4. Add `"speed"` to `SortKey` and the sort switch so the column is sortable (spec: sort by each column).
5. Show `-` (or blank) for finished/paused rows where speed is 0.

## Edge cases / unknowns
- **Units:** confirm whether `transfer.speed` is bytes/sec or KB/sec. `formatSpeed` currently assumes its input is already in **KB/s**. Verify against a live transfer and adjust (divide by 1024 if bytes/sec) so Downloads, Uploads (Plan 01), and Search all agree. Fix in one shared helper.
- Speed naturally reads 0 for queued/paused/finished — that's expected.

## Step-by-step
1. Add `speed` to the backend snapshot dict.
2. Extract a shared `formatSpeed`/`formatSize` util (`daemon-ui/src/util/format.ts`) and reuse across pages.
3. Add the sortable Speed column to Downloads.
4. Verify units against a real download.

## Verification
Start a download and confirm a live, sensibly-scaled speed (e.g. "1.2 MB/s") that sorts correctly and drops to `-`/0 when finished.
