#!/usr/bin/env sh
set -eu

echo "Provisioning complete. Run 'azd env get-values' and configure AZURE_SUBSCRIPTION_ID, ACA_JOB_RESOURCE_GROUP, and ACA_JOB_NAME in the existing n8n environment."
echo "n8n itself was not deployed."