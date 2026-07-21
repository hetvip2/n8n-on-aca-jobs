import { AzureCliCredential, DefaultAzureCredential } from "@azure/identity";
import type { ICredentialDataDecryptedObject } from "n8n-workflow";

const ARM_SCOPE = "https://management.azure.com/.default";

export type AzureAuthentication =
  "managedIdentity" | "azureCli" | "accessToken";

export function createTokenProvider(
  credentials: ICredentialDataDecryptedObject,
): () => Promise<string> {
  const authentication = credentials.authentication as AzureAuthentication;

  if (authentication === "accessToken") {
    const accessToken = String(credentials.accessToken ?? "");
    if (!accessToken) {
      throw new Error(
        "Static access token authentication requires an access token.",
      );
    }
    return async () => accessToken;
  }

  const credential =
    authentication === "azureCli"
      ? new AzureCliCredential()
      : new DefaultAzureCredential({
          managedIdentityClientId:
            String(credentials.managedIdentityClientId ?? "") || undefined,
        });

  return async () => {
    const token = await credential.getToken(ARM_SCOPE);
    if (!token?.token) {
      throw new Error("Azure credential did not return an ARM access token.");
    }
    return token.token;
  };
}
