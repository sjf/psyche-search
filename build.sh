#!/usr/bin/env bash
set -euo pipefail

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install -r requirements.txt

cd psyche-seek

if [ ! -d node_modules ]; then
  npm install
fi

npm run build
