# Repository Guidelines

## Project Structure & Module Organization

- `pynicotine/` holds the core application code, with GUI modules under `pynicotine/gtkgui/` and headless logic under `pynicotine/headless/`.
- Tests live in `pynicotine/tests/` (`unit/` and `integration/`).
- Assets and packaging metadata are under `data/` (icons, desktop files, man page).
- Translation files are in `po/`, and developer docs are in `doc/`.

## Build, Test, and Development Commands

- `./nicotine` runs the app directly from the repo.
- `python3 -m unittest` runs unit and integration tests.
- `python3 -m pycodestyle` checks formatting (line length and basic style).
- `python3 -m pylint --recursive=y .` runs linting across the tree.
- `python3 -m build` builds an sdist/wheel for packaging checks.

## Coding Style & Naming Conventions

- Python is the only language for core logic; follow PEP 8 with a 120-character
  line length (see `setup.cfg`).
- Use 4-space indentation and prefer descriptive, module-scoped names.
- UI modules are grouped by feature (e.g., `pynicotine/gtkgui/dialogs/`).
- Keep dependencies minimal; standard library modules are preferred.

## Testing Guidelines

- Tests use the standard library `unittest` runner.
- Place new tests in `pynicotine/tests/unit/` or `pynicotine/tests/integration/`
  mirroring the feature area.
- Name test files `test_*.py` to match discovery expectations.

## Commit & Pull Request Guidelines

- Recent commits favor short, imperative summaries with optional scope prefixes,
  e.g. `GUI: strip whitespace from more text entries` or
  `dialogs/roomlist.py: stricter validation for room names`.
- Translation updates are typically labeled `Translated using Weblate (...)`.
- No explicit PR template is present; include a concise problem/solution
  description, list tests run, and attach screenshots for UI changes when
  applicable.
