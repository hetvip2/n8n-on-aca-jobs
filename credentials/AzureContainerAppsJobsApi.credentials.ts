import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class AzureContainerAppsJobsApi implements ICredentialType {
  name = "azureContainerAppsJobsApi";

  displayName = "Azure Container Apps Jobs";

  documentationUrl = "https://learn.microsoft.com/azure/container-apps/jobs";

  properties: INodeProperties[] = [
    {
      displayName: "Authentication",
      name: "authentication",
      type: "options",
      default: "managedIdentity",
      options: [
        {
          name: "Managed Identity / Default Azure Credential (Production)",
          value: "managedIdentity",
        },
        {
          name: "Azure CLI (Local Development Only)",
          value: "azureCli",
        },
        {
          name: "Static Access Token (Local Smoke Test Only)",
          value: "accessToken",
        },
      ],
    },
    {
      displayName: "Managed Identity Client ID",
      name: "managedIdentityClientId",
      type: "string",
      default: "",
      description: "Optional client ID for a user-assigned managed identity",
      displayOptions: { show: { authentication: ["managedIdentity"] } },
    },
    {
      displayName: "Access Token",
      name: "accessToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description: "Short-lived ARM token. Never use this mode in production.",
      displayOptions: { show: { authentication: ["accessToken"] } },
    },
  ];
}
