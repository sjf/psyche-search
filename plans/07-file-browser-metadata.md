# Plan 07 — Audio metadata & attributes in the file browser

**Status:** Partial (only name + size inline; metadata only in footer for selected file) · **Priority:** Medium · **Scope:** backend + frontend

**Spec (notes.md):** The files browser shows file size and audio attributes plus metadata from
the audio file (artist, title, album, year, etc).

## Current state
- The Files tree (`FilesPage.tsx` → `FileTree`) renders only `name` + `size` per row.
- Metadata (artist/title/album/year) is fetched only for the **selected** file and shown in the footer `FileActionBar`, via `GET /api/media/audio-meta`.
- `/api/files/tree.json` (built in `api.py:_build_files_tree` / `trees.py`) returns only `{name, type, size, path}` for files — no tags/attributes.

## Design choice
Fetching tags for every file up front is expensive (TinyTag opens each file). Two viable approaches:
- **A — lazy per-row (recommended):** fetch `audio-meta` when a file row is expanded/hovered/selected and cache it; show a compact metadata line under the row. Cheap, scales to big trees.
- **B — eager in the tree:** have the backend read tags while walking. Simpler UI but slow on large shares; gate behind a query flag (`?meta=1`) and/or a file-count cap.

Recommend **A** for v1 (the browser is described as "simple" for now; richer album-art view is explicitly a v2).

## Backend changes
- If A: none required beyond the existing `audio-meta` endpoint (already returns title/artist/album/year/bitrate/samplerate/vbr/duration).
- If B: extend `trees.py`/`_build_files_node` to attach a `meta` object per audio file using `TinyTag.get(...)`, guarded by a flag + cap; reuse `TinyTag.is_supported`.

## Frontend changes (`FilesPage.tsx` / `FileTree`)
1. Add an on-demand metadata fetch keyed by `node.path` with an in-memory cache (mirror `FileActionBar`'s `metadataCache`).
2. Render a secondary line / columns on audio rows: **artist – title**, **album (year)**, and attributes (bitrate, VBR/CBR, sample rate) when available; fall back to just size when no tags.
3. Keep the existing size display; align columns so dirs (size only) and files (size + attrs) read cleanly.
4. Trigger fetch on expand or first render-in-view (IntersectionObserver) to avoid a burst.

## Edge cases
- Non-audio files: show name + size only (no meta fetch).
- Files with no tags: show filename + size (spec's fallback behavior, same as the player).
- Missing/deleted file mid-browse: `audio-meta` 404 → show size only, don't error.
- Throttle concurrent tag fetches (e.g. small concurrency limit) so expanding a big folder doesn't hammer the daemon.

## Step-by-step
1. Add a cached `useAudioMeta(path)` hook (lazy).
2. Render metadata/attribute line on audio rows; wire lazy trigger + cache.
3. Verify big folders stay responsive (no eager full-tree fetch).

## Verification
Open a folder of tagged audio; confirm each track shows artist/title/album/year + bitrate, untagged files show name+size, and scrolling a large folder doesn't stall.
