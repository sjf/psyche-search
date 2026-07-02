# Plan 09 — Distinct file-type icons in search results

**Status:** Partial (audio vs generic + folder only) · **Priority:** Low · **Scope:** frontend only

**Spec (notes.md):** Use different icons for different file types — audio, folder, expanded
folder, text file, generic file.

## Current state
- `SearchPage.tsx`/`SearchResultsPage.tsx` `getFileIcon` returns `Music2` for audio, else `FileText` for everything — so text and generic are the same, and there's no "expanded folder" distinction (search folders always use `Folder`).
- The **Files** tree already does open/closed folders (`FolderOpen`/`Folder`) — good reference.

## Frontend changes
1. Extract a shared `fileIcon(name, {expanded}?)` helper into `psyche-seek/src/util/icons.tsx` and use it in both search pages and the Files tree:
   - **Audio** (`mp3|flac|ogg|opus|wav|aac|m4a|wma|alac|aiff|ape`) → `Music2`.
   - **Text** (`txt|nfo|md|log|cue|m3u|m3u8`) → `FileText`.
   - **Generic** (everything else) → `File`.
   - **Folder collapsed** → `Folder`; **folder expanded** → `FolderOpen`.
2. Search results group by user→folder and list files; folders in results are static (not expandable), so "expanded folder" mainly applies to the Files tree — align the icon set so both use the same helper. If search folders become expandable later, the helper already covers it.

## Edge cases
- Case-insensitive extension match (already the case with the `/i` regex).
- Files with no extension → generic.

## Step-by-step
1. Add the shared icon helper.
2. Swap both search pages + Files tree to use it.
3. Eyeball each type renders a distinct icon.

## Verification
Run a search that returns mixed types (audio, `.nfo`/`.txt`, other) and confirm three distinct file icons plus folder icons; confirm the Files tree still shows open/closed folders via the same helper.
