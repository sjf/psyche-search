<!--
  SPDX-FileCopyrightText: 2016-2025 Nicotine+ Contributors
  SPDX-License-Identifier: GPL-3.0-or-later
-->

# Packaging

> **NOTE**: For distribution packagers: There is a standard feature of GitHub
> which enables you to be notified of new package releases: In the top right
> bar there is the **Watch** option, which has the suboption to be notified of
> *releases only*. Please subscribe so you won't miss any of our new releases.
> Thanks!


## Dependencies

Dependencies for Nicotine+ are described in [DEPENDENCIES.md](DEPENDENCIES.md).


## GNU/Linux Instructions

### Building a Source Distribution

To build a source distribution archive `.tar.gz` from the Git repository, run:

```sh
python3 -m build --sdist
```

The source distribution archive will be located in the `dist/` subfolder.

### Building a Debian Package

Unstable and stable PPAs are already provided for pre-compiled packages.
However, if you wish to build your own package, perform the following steps.

Start by installing the build dependencies:

```sh
sudo apt build-dep .
```

Generate the "upstream" tarball:

```sh
python3 -m build --sdist
mk-origtargz dist/nicotine-plus-*.tar.gz
```

Build the Debian package:

```sh
debuild -sa -us -uc
```


## Windows and macOS Desktop App

The Windows and macOS desktop apps are the web UI wrapped in a native
[pywebview](https://pywebview.flowlib.org/) window. They contain no GTK. They
are frozen with [PyInstaller](https://pyinstaller.org/) from the shared spec at
`build-aux/macos/psyche-seek.spec`, and CI builds them in the `windows` and
`macos` jobs of `.github/workflows/packaging.yml`.

To build the app on your own machine, see [DESKTOP_APP.md](DESKTOP_APP.md). In
short:

```sh
# Build the web UI
( cd psyche-seek && npm ci && npm run build )

# Install build dependencies (macOS shown; on Windows use pythonnet
# instead of pyobjc-framework-WebKit)
pip install fastapi uvicorn python-multipart pywebview pyobjc-framework-WebKit pyinstaller

# Freeze the app (output lands in dist/)
pyinstaller --noconfirm --clean build-aux/macos/psyche-seek.spec
```

On macOS, `build-aux/macos/build-desktop.sh` wraps these steps and also produces
a `.dmg`.

