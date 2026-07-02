# syntax=docker/dockerfile:1

# --- Stage 1: build the web front-end -------------------------------------
FROM node:22-slim AS ui-build

WORKDIR /ui
COPY psyche-seek/package.json psyche-seek/package-lock.json ./
RUN npm ci

COPY psyche-seek/ ./
RUN npm run build

# --- Stage 2: runtime ------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WEB_HOST=0.0.0.0 \
    WEB_PORT=7007 \
    SLSK_CONFIG=/config/config \
    PUID=1000 \
    PGID=1000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pynicotine/ ./pynicotine/
COPY pseek ./pseek
COPY --from=ui-build /ui/dist ./psyche-seek/dist

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Non-root user; the entrypoint (running as root) remaps it to PUID/PGID,
# fixes volume ownership, then drops privileges via gosu.
RUN groupadd --gid 1000 pseek \
    && useradd --create-home --uid 1000 --gid 1000 --shell /usr/sbin/nologin pseek \
    && mkdir -p /config /downloads /incomplete /shares

VOLUME ["/config", "/downloads", "/incomplete", "/shares"]

# 7007: web UI  |  2234: Soulseek peer/listen port
EXPOSE 7007 2234

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["-d", "--isolated"]
