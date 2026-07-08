#!/bin/bash
# CME.exe — Backup Script
# Backs up the JSON data store (data/) as a single gzipped tarball.
set -euo pipefail

BACKUP_DIR="${BACKUP_PATH:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATA_DIR="${DATA_DIR:-./data}"
BACKUP_FILE="$BACKUP_DIR/cme-exe_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

if [ ! -d "$DATA_DIR" ]; then
  echo "❌ Data directory not found: $DATA_DIR"
  exit 1
fi

echo "📦 Creating backup…"
tar -czf "$BACKUP_FILE" "$DATA_DIR"
echo "✓ Backup: $BACKUP_FILE"

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "cme-exe_*.tar.gz" -mtime +30 -delete
echo "✓ Old backups pruned (>30 days)"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "📊 Size: $SIZE"
echo ""
echo "📁 All backups:"
ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null | awk '{print $9, "("$5")"}'
