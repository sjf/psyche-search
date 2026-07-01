#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ] || [ ! -d daemon-ui/dist ]; then
  ./build.sh
fi

exec .venv/bin/python pseek
