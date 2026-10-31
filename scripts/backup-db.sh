#!/usr/bin/env bash
# Backup the production D1 database to a timestamped SQL dump.
# Usage: ./scripts/backup-db.sh [output_dir]   (default: ./backups)
set -euo pipefail

OUT_DIR="$(cd "${1:-backups}" 2>/dev/null || mkdir -p "${1:-backups}" && cd "${1:-backups}" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${OUT_DIR}/omnicast-d1-${STAMP}.sql"

cd "$(dirname "$0")/../core/cloudflare"
echo "Exporting social-auto-db → ${OUT_FILE}"
./node_modules/.bin/wrangler d1 export social-auto-db --remote --output "${OUT_FILE}"
echo "Done: ${OUT_FILE}"
