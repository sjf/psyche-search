# Plan 08 — Player title → open the containing directory

**Status:** Partial (links to Files, doesn't focus the directory) · **Priority:** Low · **Scope:** frontend only

**Spec (notes.md):** Clicking the track name in the audio bar goes to the directory containing the file.

## Current state
- `PlayerBar.tsx` links the title to `/files?path=<encoded file path>` (line ~56).
- `FilesPage.tsx` never reads the `path` query param, so it just lands on Files with the tree in its default/last-persisted expansion — the specific directory is not opened, selected, or scrolled into view.

## Frontend changes (`FilesPage.tsx`)
1. Read the `path` param (`useSearchParams` or `useLocation`).
2. On load (and when `path` changes):
   - Find the node whose `path` matches (walk the loaded tree).
   - Expand all ancestor directories (set their ids `true` in `expandedState`).
   - Select the file node (`setSelectedNode`) so the footer action bar shows it.
   - Scroll it into view (`ref.scrollIntoView`).
3. Handle the tree-not-loaded-yet race: the tree loads async, so run the focus effect after `tree` is populated (depend on `tree` + `path`).

## Nice-to-have
- Also make `PlayerBar`'s `<a href>` a client-side `navigate()` (react-router) instead of a full-page `<a>` so it doesn't reload the SPA (currently it's a plain anchor → full reload, which also interrupts nothing because audio persists, but SPA nav is cleaner and keeps player state in memory rather than rehydrating from localStorage).

## Edge cases
- File under a **shared** dir vs the **download** dir — both are in the tree; matching by absolute `path` covers both.
- Path present but not found in the tree (deleted, or filtered by the search box) → no-op, don't crash; optionally toast "file not found in browser".
- Windows-style separators in stored paths — normalize when matching (the tree uses OS paths for local files).

## Step-by-step
1. Parse `path` in FilesPage.
2. Add an "focus/reveal node by path" effect (expand ancestors + select + scroll), gated on `tree` being loaded.
3. Switch PlayerBar to router `navigate`.

## Verification
Play a track, click its name in the player bar; confirm Files opens with the containing folder expanded, the file selected, and scrolled into view.
