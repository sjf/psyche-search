# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

"""Entry point for the frozen macOS desktop app (web UI in a native window)."""

import multiprocessing
import sys


def main():
    import pynicotine
    return pynicotine.run()


if __name__ == "__main__":
    # MUST run before anything touches sys.argv. In a frozen app, multiprocessing
    # spawns workers by re-launching this executable with a "--multiprocessing-fork"
    # marker in argv; freeze_support() intercepts those, runs the worker, and exits.
    # If we clobbered argv first, every worker would boot a fresh app window and
    # spawn more workers (fork bomb).
    multiprocessing.freeze_support()

    # macOS Finder passes no useful args (a -psn_* serial on older systems); force
    # desktop mode for the real launch only.
    sys.argv = [sys.argv[0], "--desktop"]
    sys.exit(main())
