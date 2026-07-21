#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
runtime="$root/.n8n-smoke"
custom="$runtime/custom"
container_name="n8n-aca-smoke-$$"

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  rm -rf "$runtime"
}
trap cleanup EXIT INT TERM

if [ ! -f "$root/dist/nodes/AzureContainerAppsJobs/AzureContainerAppsJobs.node.js" ]; then
  echo "Built node not found. Run 'npm run build' before the smoke test." >&2
  exit 1
fi

rm -rf "$runtime"
mkdir -p "$custom"
package_archive="$(npm pack --pack-destination "$runtime" --silent)"
npm install --prefix "$custom" --ignore-scripts --legacy-peer-deps --no-save \
  "$runtime/$package_archive" n8n-workflow@2.30.1

docker run --name "$container_name" --rm --entrypoint /bin/sh \
  -e N8N_USER_FOLDER=/home/node/.n8n \
  -e N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom/node_modules/n8n-nodes-aca-jobs/dist \
  -e N8N_RUNNERS_ENABLED=false \
  -e ACA_JOBS_ARM_ENDPOINT=http://127.0.0.1:4010 \
  -v "$custom:/home/node/.n8n/custom:ro" \
  -v "$root/workflows:/smoke/workflows:ro" \
  -v "$root/scripts:/smoke/scripts:ro" \
  n8nio/n8n:2.30.1 -c 'node /smoke/scripts/mock-arm-server.mjs & mock=$!; trap "kill $mock 2>/dev/null || true" EXIT; sleep 1; n8n import:credentials --input=/smoke/scripts/local-smoke-credentials.json; n8n import:workflow --input=/smoke/workflows/local-smoke.json; n8n execute --id=aca-jobs-local-smoke; node /smoke/scripts/assert-smoke-evidence.mjs'