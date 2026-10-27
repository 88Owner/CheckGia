$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path backups | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$target = "backups/price_auditor_$stamp.sql"
docker compose exec -T postgres pg_dump -U auditor --no-owner price_auditor | Set-Content -Encoding utf8 $target
Write-Output $target
