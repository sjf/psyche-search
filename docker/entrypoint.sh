#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${SLSK_CONFIG:-/config/config}"
DATA_HOME="${NICOTINE_DATA_HOME:-/config/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Remap the pseek user/group to the requested host uid/gid so files written to
# the mounted volumes are owned sensibly on the host.
if [ "$(id -g pseek)" != "$PGID" ]; then
  groupmod -o -g "$PGID" pseek
fi
if [ "$(id -u pseek)" != "$PUID" ]; then
  usermod -o -u "$PUID" pseek
fi

mkdir -p "$(dirname "$CONFIG_FILE")" "$DATA_HOME" /downloads /incomplete /shares

# Own the writable volumes (not /shares — that's read-only media).
chown -R pseek:pseek /config /downloads /incomplete /home/pseek 2>/dev/null || true

# Build the shared-folder list from the immediate subdirectories of /shares.
# Each mounted subdir becomes one share, named after the directory. Mount as
# many as you like, e.g. -v /music:/shares/music -v /podcasts:/shares/podcasts
build_shares() {
  local entries="" name
  for dir in /shares/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    entries="${entries}${entries:+, }('${name}', '/shares/${name}')"
  done
  printf '[%s]' "$entries"
}

# Seed a minimal config on first run. If a config is already mounted, leave it
# untouched. Credentials come from SLSK_USERNAME / SLSK_PASSWORD.
if [ ! -f "$CONFIG_FILE" ]; then
  if [ -z "${SLSK_USERNAME:-}" ] || [ -z "${SLSK_PASSWORD:-}" ]; then
    echo "No config at $CONFIG_FILE and SLSK_USERNAME/SLSK_PASSWORD not set." >&2
    echo "Set both env vars, or mount an existing config to $CONFIG_FILE." >&2
    exit 1
  fi

  cat > "$CONFIG_FILE" <<EOF
[server]
login = ${SLSK_USERNAME}
passw = ${SLSK_PASSWORD}

[transfers]
downloaddir = /downloads
incompletedir = /incomplete
shared = $(build_shares)
EOF
  chown pseek:pseek "$CONFIG_FILE"
  echo "Seeded new config at $CONFIG_FILE (user: ${SLSK_USERNAME})."
  echo "Shares: $(build_shares)"
fi

exec gosu pseek python pseek -c "$CONFIG_FILE" "$@"
