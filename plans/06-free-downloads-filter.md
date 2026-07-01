# Plan 06 — Show only free downloads in search results

**Status:** Partial (all results shown, busy ones just flagged) · **Priority:** Medium · **Scope:** backend (small)

**Spec (notes.md):** Only show free downloads.

## Current state
- Search results include **all** users; those without free upload slots are shown with a red "busy" dot (`user-status-busy`) in `SearchPage.tsx`/`SearchResultsPage.tsx`.
- `trees.py:build_search_tree` stores `free_slots` per file but never filters on it. `state.py:add_search_results` records `free_slots` from `msg.freeulslots`.

## Decision to make
The literal spec says only show free results. Two options:
- **A (spec-literal):** filter out non-free results at tree build.
- **B (safer UX):** default to free-only but keep a "show all" toggle. Recommended, since result volume can be low and the busy/ready dot already exists — but implement A first if you want to match the spec exactly.

## Backend changes
- In `trees.py:build_search_tree(results)`, skip entries where `entry.get("free_slots")` is falsy (i.e. no free upload slot). Keep the field on surviving nodes for the ready/busy dot.
- If going with option B, thread a `free_only` flag from the `/api/search/{term}/tree.json` query string (`api.py:162`) down into `build_search_tree` (default `True`).

## Frontend changes (option B only)
- Add a "Free only" toggle above the results table; pass `?free_only=0` when off. With option A, no frontend change is needed (busy rows simply stop appearing).

## Edge cases
- `free_slots` semantics: it's per-user free upload slots at response time; a user can flip busy/free between polls, so results may shift — acceptable.
- Don't drop a whole user's folder if *some* files are free — filter at the file level (as above), then prune empty folders/users in `_sort_tree`/build.

## Step-by-step
1. Add the file-level free filter in `build_search_tree`.
2. Prune now-empty folder/user nodes.
3. (Optional B) add the query flag + toggle.

## Verification
Run a popular search; confirm only ready (free-slot) results appear (all dots green), and — if you built the toggle — that "show all" brings back busy rows.
