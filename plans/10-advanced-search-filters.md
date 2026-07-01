# Plan 10 — Advanced search-result filters

**Status:** Not implemented · **Priority:** Low / future · **Scope:** backend + frontend

**Spec (notes.md):** The "documentation for search filters" block — a filter box over results
supporting word include/exclude and attribute tokens.

Supported syntax to implement:
- Plain words → folder/file path must contain **all** of them (match against file **and** its folder).
- `-word` → exclude results whose name/folder contains the word.
- `minbitrate:N` (alias `mbr:`) — min audio bitrate.
- `minfilesize:N` (alias `mfs:`) — min file size in **MB**.
- `minfilesinfolder:N` (alias `mfif:`) — folders with ≥ N visible files.
- `isvbr` / `iscbr` — variable / constant bitrate only.

## Current state
- No filter box on the results view; no token parsing anywhere.
- Attributes exist per result only as an opaque `attributes` string (`add_search_results` stores `msg.list` attrs; the UI shows a combined string). To filter on bitrate/VBR we need those broken out.

## Backend changes
1. **Expose structured attributes.** In `state.py:add_search_results` / `trees.py:build_search_tree`, parse the Soulseek file-attribute list into fields: `bitrate`, `is_vbr`, `sample_rate`, `duration`, `length`. (Nicotine already has attribute-parsing helpers used by the GTK search view — reuse those rather than re-deriving.) Attach them to each file node.
2. **Filter application.** Add a filter parser (words, `-exclude`, `min*`, `is(v|c)br`, shorthands) and apply it when building/serving the tree for `/api/search/{term}/tree.json`. Pass the raw filter string as a query param; parse server-side (keeps the client thin and matches how the tree is already built server-side).
   - `minfilesinfolder` is a **folder-level** predicate — apply after grouping, dropping folders with too few surviving files.
   - Word match considers the full `folder + filename` path (per the spec's "considering the folder they are in").

## Frontend changes
- Add a filter input above the results table (both the results section in `SearchPage.tsx` and, if kept, `SearchResultsPage.tsx`), debounced, passing `?filter=<raw>` to the tree fetch.
- Show attribute columns (bitrate, VBR/CBR) now that they're structured — overlaps with search-results column spec.
- A small "?" popover documenting the syntax (the notes text) is a nice touch.

## Edge cases
- Non-audio files: attribute tokens (`minbitrate`, `isvbr`) should exclude files that have no bitrate, unless only word filters are used.
- Empty/whitespace filter → no filtering.
- Unknown tokens → treat as plain words (don't error).
- Keep parsing tolerant and case-insensitive; support both long and shorthand forms.

## Why low priority / future
This is the largest of the gaps and depends on breaking out structured attributes first. The notes present it as a documentation block rather than a numbered page requirement, so it reads as a later enhancement. Do **06 (free-only)** and the results **attribute columns** first; land this once structured attributes exist.

## Step-by-step
1. Parse Soulseek attributes into structured fields on each result node (reuse core helpers).
2. Build a tolerant filter parser; apply server-side in the tree endpoint via `?filter=`.
3. Add the debounced filter box + attribute columns + syntax help popover.
4. Test each token + shorthand + exclusion + folder-count predicate.

## Verification
Enter `lackluster container iscbr mbr:320 mfs:10 mfif:8` and confirm only CBR files ≥320 kbps and ≥10 MB, in folders with ≥8 visible files whose path contains both words, remain.
