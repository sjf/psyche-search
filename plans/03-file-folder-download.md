# Plan 03 — Download files & folders from the browser (folder → zip)

**Status:** Not implemented · **Priority:** High · **Scope:** backend + frontend

**Spec (notes.md):** On the Files page you can download files or folders to your computer;
downloading a folder zips the files first, and the zips are written to `/tmp/nseek/`.

## Current state
- No download-to-browser affordance anywhere. `FileActionBar.tsx` has Play/Queue/Rename/Delete only.
- No zip endpoint; grep for `zip`/`nseek`/`/tmp` in the backend returns nothing.
- `/api/media` streams a file for the audio player but isn't wired for "save as", and there's no folder support.

## Key facts (verified)
- Path safety already exists: `DaemonAPI._resolve_media_path` + `_is_path_allowed` + `_get_media_roots` restrict access to the download dir and shared dirs. **Reuse these** for both endpoints.
- `_stream_media` (api.py) already does ranged streaming; a plain attachment download can reuse `FileResponse` with a `Content-Disposition` header.

## Backend changes (`api.py`)
1. **Single file** — `GET /api/download-file?path=<abs>`:
   - `resolved = self._resolve_media_path(path)`; 403 if not allowed, 404 if missing.
   - Return `FileResponse(resolved, filename=os.path.basename(resolved), media_type="application/octet-stream")` (sets `Content-Disposition: attachment`).
2. **Folder → zip** — `GET /api/download-zip?path=<abs dir>`:
   - Validate with `_is_path_allowed`; 404 if not a dir.
   - Ensure output dir `/tmp/nseek/` exists (`os.makedirs(exist_ok=True)`).
   - Build a zip at `/tmp/nseek/<foldername>-<token>.zip` using `zipfile.ZipFile` (`ZIP_DEFLATED`), walking the folder and storing files under paths relative to the folder's parent (so the archive contains the top folder).
   - Return `FileResponse(zip_path, filename="<foldername>.zip", media_type="application/zip")`.
   - Skip files filtered by the existing share-filter regex (`_get_share_filter_regex`) for consistency with the tree, if sharing.

## Frontend changes
3. **`FileActionBar.tsx`** — add a **Download** button (lucide `Download`). For a file it calls the file endpoint; hide/disable for non-downloadable selections.
4. **`FilesPage.tsx`** — the tree also selects folders (`type === "dir"`). When a **folder** is selected, show a folder action (either in the footer bar or a small inline button on the tree row) that hits `/api/download-zip`.
   - Trigger the browser download by navigating to the URL (`window.location.href = url` or an `<a download>` element) — these are GET endpoints so a direct link works and streams through the Vite proxy in dev.
5. Consider a subtle "preparing zip…" toast for large folders (the request blocks while zipping).

## Edge cases & considerations
- **Disk usage / cleanup:** zips accumulate in `/tmp/nseek/`. Add a cleanup strategy — delete zips older than N hours on each zip request, or `tempfile` + background unlink after send. Document the choice.
- **Path traversal:** never trust `path`; always go through `_is_path_allowed` (which realpath-normalizes and checks `commonpath` against roots).
- **Large folders:** zipping is synchronous and CPU/IO heavy; a streaming zip (e.g. chunked) is a later optimization. For v1, block + return the file.
- **Filenames:** sanitize the `Content-Disposition` filename (quote, strip control chars).
- **Symlinks:** the tree walker skips symlinks (`follow_symlinks=False`); mirror that in the zip walk.

## Step-by-step
1. Add `/api/download-file`; test `curl -OJ` through the proxy.
2. Add `/api/download-zip` + `/tmp/nseek/` handling + cleanup; test a folder downloads a valid zip.
3. Add the file Download button in `FileActionBar`.
4. Add the folder download affordance + "preparing…" toast in `FilesPage`.
5. Verify traversal is blocked (a `path` outside roots → 403).

## Verification
From the Files page, download a single track (saves the file) and a folder (saves a `.zip` containing the folder's audio); confirm the zip lands in `/tmp/nseek/` and the archive structure is correct.
