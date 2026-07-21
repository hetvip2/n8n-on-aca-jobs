$ErrorActionPreference = "Stop"
$outputs = azd env get-values --output json | ConvertFrom-Json
Write-Host "Provisioning complete. Configure these non-secret values in the existing n8n environment:"
Write-Host "AZURE_SUBSCRIPTION_ID=$($outputs.AZURE_SUBSCRIPTION_ID)"
Write-Host "ACA_JOB_RESOURCE_GROUP=$($outputs.ACA_JOB_RESOURCE_GROUP)"
Write-Host "ACA_JOB_NAME=$($outputs.ACA_JOB_NAME)"
Write-Host "n8n itself was not deployed."