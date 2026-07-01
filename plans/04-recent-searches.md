# Plan 04 — Recent searches list (up to 50)

**Status:** Not implemented (data fetched, never rendered) · **Priority:** Medium · **Scope:** frontend only

**Spec (notes.md):** The search page has a search box and a list of recent searches (up to 50).

## Current state
- `SearchPage.tsx` already fetches searches from `/api/status`, sorts by `started_at`, and slices to 50 into `searches` state (line ~132–135).
- That state is only used to auto-select the latest term — it is **never rendered**.
- So the backend support is already there (`/api/status` returns `searches: Record<token, {term, started_at, results}>`); this is purely a UI addition.

## Frontend changes (`SearchPage.tsx`)
1. When there is no `activeTerm` (or always, below the search bar), render the `searches` list:
   - Each row: term, result count (`entry.results`), and relative/absolute time from `started_at`.
   - Clicking a row sets the term and navigates to `/search/<term>` (reuse the existing `handleSearch` path or `navigate`).
   - A per-row remove (✕) calling the existing `POST /api/search/remove` with `term`, plus a "Clear all" that posts with an empty term (the endpoint already clears all when `term` is empty — see api.py:153).
2. Keep it capped at 50 (already sliced).
3. Style consistent with the existing tables/cards.

## Edge cases
- De-dupe by term (the same term can have multiple tokens over time) — keep the most recent `started_at`.
- Empty state: "No recent searches yet."
- The list refreshes on the existing 5s `/api/status` poll — ensure removing an item updates optimistically so it doesn't reappear until the next poll.

## Step-by-step
1. Add a `RecentSearches` section rendered from `searches`.
2. Wire click-to-run, per-row remove, and clear-all.
3. Confirm the 50 cap and de-dupe.

## Verification
Run several searches, confirm they appear in the list (newest first, ≤50), clicking one re-runs it, and remove/clear work.
