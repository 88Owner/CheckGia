#!/bin/sh
set -eu
mkdir -p backups
stamp=$(date +%F)
docker compose exec -T postgres pg_dump -U auditor --no-owner price_auditor > "backups/price_auditor_${stamp}.sql"
echo "backups/price_auditor_${stamp}.sql"
