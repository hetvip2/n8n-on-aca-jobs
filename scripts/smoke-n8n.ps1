$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root ".n8n-smoke"
$custom = Join-Path $runtime "custom"
$containerName = "n8n-aca-smoke-$PID"
$previousNpmCache = $env:npm_config_cache

try {
  Write-Host "[smoke] Checking built community node"
  if (-not (Test-Path (Join-Path $root "dist\nodes\AzureContainerAppsJobs\AzureContainerAppsJobs.node.js"))) {
    throw "Built node not found. Run 'npm run build' before the smoke test."
  }

  Write-Host "[smoke] Creating isolated n8n user folder"
  Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
  New-Item $custom -ItemType Directory -Force | Out-Null
  $env:npm_config_cache = Join-Path $runtime "npm-cache"
  $packageArchive = npm pack --pack-destination $runtime --silent
  if ($LASTEXITCODE -ne 0) { throw "Community node package creation failed." }
  npm install --prefix $custom --ignore-scripts --legacy-peer-deps --no-save (Join-Path $runtime $packageArchive) n8n-workflow@2.30.1
  if ($LASTEXITCODE -ne 0) { throw "Community node package installation failed." }

  Write-Host "[smoke] Executing workflow through n8n 2.30.1 with a loopback ARM stub"
  docker run --name $containerName --rm --entrypoint /bin/sh `
    -e N8N_USER_FOLDER=/home/node/.n8n `
    -e N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom/node_modules/n8n-nodes-aca-jobs/dist `
    -e N8N_RUNNERS_ENABLED=false `
    -e ACA_JOBS_ARM_ENDPOINT=http://127.0.0.1:4010 `
    -v "${custom}:/home/node/.n8n/custom:ro" `
    -v "$(Join-Path $root 'workflows'):/smoke/workflows:ro" `
    -v "$(Join-Path $root 'scripts'):/smoke/scripts:ro" `
    n8nio/n8n:2.30.1 -c 'node /smoke/scripts/mock-arm-server.mjs & mock=$!; trap "kill $mock 2>/dev/null || true" EXIT; sleep 1; n8n import:credentials --input=/smoke/scripts/local-smoke-credentials.json; n8n import:workflow --input=/smoke/workflows/local-smoke.json; n8n execute --id=aca-jobs-local-smoke; node /smoke/scripts/assert-smoke-evidence.mjs'
  if ($LASTEXITCODE -ne 0) { throw "n8n runtime execution failed." }
  Write-Host "[smoke] n8n workflow succeeded"
} catch {
  Write-Error "n8n smoke failed: $($_.Exception.Message)"
  throw
} finally {
  docker rm --force $containerName 2>$null | Out-Null
  $env:npm_config_cache = $previousNpmCache
  Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
}