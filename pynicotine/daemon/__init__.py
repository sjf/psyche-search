# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

"""Run application in daemon mode with a built-in web UI."""

from pynicotine.daemon.application import Application


def run():
    return Application().run()
