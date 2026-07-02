# Frontend gap plans

Implementation plans for the functional gaps found auditing the UI against `notes.md`
(the requirements spec, in the main-worktree root). One file per gap, ordered by priority.

| # | Plan | Spec area | Scope | Priority |
|---|------|-----------|-------|----------|
| 01 | [Uploads page](01-uploads-page.md) | uploads page | backend + frontend | High |
| 02 | [Directory configuration](02-directory-configuration.md) | files / settings | backend + frontend | High |
| 03 | [File & folder download](03-file-folder-download.md) | files page | backend + frontend | High |
| 04 | [Recent searches list](04-recent-searches.md) | search page | frontend | Medium |
| 05 | [Download speed](05-download-speed.md) | downloads page | backend + frontend | Medium |
| 06 | [Free-downloads-only filter](06-free-downloads-filter.md) | search results | backend | Medium |
| 07 | [File-browser metadata](07-file-browser-metadata.md) | files page | backend + frontend | Medium |
| 08 | [Player → open directory](08-player-open-directory.md) | audio bar | frontend | Low |
| 09 | [Search-result file icons](09-search-result-icons.md) | search results | frontend | Low |
| 10 | [Advanced search filters](10-advanced-search-filters.md) | search filter doc | backend + frontend | Low / future |

Not covered here (cosmetic, not functional): app renaming to **NSEEK** and the stale unrouted
`SearchResultsPage.tsx`. Ask if you want those planned too.

Key files referenced throughout:
- Backend API: `pynicotine/daemon/api.py` · state: `pynicotine/daemon/state.py` · trees: `pynicotine/daemon/trees.py`
- Frontend pages: `psyche-seek/src/pages/` · components: `psyche-seek/src/components/` · player/state: `psyche-seek/src/state/`
