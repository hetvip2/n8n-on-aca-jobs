import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import {
  AcaJobsClient,
  type WorkloadOverrides,
} from "../../src/aca-jobs-client.js";
import { createTokenProvider } from "../../src/azure-token.js";

export class AzureContainerAppsJobs implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Azure Container Apps Jobs",
    name: "azureContainerAppsJobs",
    icon: "fa:tasks",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Start and monitor an existing Azure Container Apps Job",
    defaults: { name: "Azure Container Apps Jobs" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "azureContainerAppsJobsApi", required: true }],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        default: "startAndWait",
        noDataExpression: true,
        options: [
          { name: "Start", value: "start", action: "Start a job execution" },
          {
            name: "Get Status",
            value: "getStatus",
            action: "Get an execution status",
          },
          {
            name: "Start and Wait",
            value: "startAndWait",
            action: "Start or resume and wait for an execution",
          },
        ],
      },
      {
        displayName: "Subscription ID",
        name: "subscriptionId",
        type: "string",
        default: "",
        required: true,
      },
      {
        displayName: "Resource Group",
        name: "resourceGroup",
        type: "string",
        default: "",
        required: true,
      },
      {
        displayName: "Job Name",
        name: "jobName",
        type: "string",
        default: "",
        required: true,
      },
      {
        displayName: "Execution Name",
        name: "executionName",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { operation: ["getStatus"] } },
      },
      {
        displayName: "Resume Execution Name",
        name: "resumeExecutionName",
        type: "string",
        default: "",
        description: "Resume this execution instead of starting a duplicate",
        displayOptions: { show: { operation: ["startAndWait"] } },
      },
      {
        displayName: "Correlation ID",
        name: "correlationId",
        type: "string",
        default: "={{$execution.id}}",
        required: true,
        displayOptions: { show: { operation: ["start", "startAndWait"] } },
      },
      {
        displayName: "Container Name",
        name: "containerName",
        type: "string",
        default: "worker",
        displayOptions: { show: { operation: ["start", "startAndWait"] } },
      },
      {
        displayName: "Overrides",
        name: "overrides",
        type: "collection",
        placeholder: "Add Override",
        default: {},
        displayOptions: { show: { operation: ["start", "startAndWait"] } },
        options: [
          {
            displayName: "Arguments (JSON Array)",
            name: "args",
            type: "json",
            default: "[]",
          },
          {
            displayName: "Command (JSON Array)",
            name: "command",
            type: "json",
            default: "[]",
          },
          {
            displayName: "CPU",
            name: "cpu",
            type: "number",
            default: 0.5,
            typeOptions: { minValue: 0.25 },
          },
          {
            displayName: "Environment (JSON Array)",
            name: "env",
            type: "json",
            default: "[]",
          },
          {
            displayName: "Memory",
            name: "memory",
            type: "string",
            default: "1Gi",
          },
        ],
      },
      {
        displayName: "Poll Interval (Seconds)",
        name: "pollIntervalSeconds",
        type: "number",
        default: 5,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { operation: ["startAndWait"] } },
      },
      {
        displayName: "Timeout (Seconds)",
        name: "timeoutSeconds",
        type: "number",
        default: 1800,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { operation: ["startAndWait"] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const credentials = await this.getCredentials("azureContainerAppsJobsApi");

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const operation = this.getNodeParameter(
          "operation",
          itemIndex,
        ) as string;
        const client = new AcaJobsClient({
          job: {
            subscriptionId: this.getNodeParameter(
              "subscriptionId",
              itemIndex,
            ) as string,
            resourceGroup: this.getNodeParameter(
              "resourceGroup",
              itemIndex,
            ) as string,
            jobName: this.getNodeParameter("jobName", itemIndex) as string,
          },
          getToken: createTokenProvider(credentials),
          armEndpoint: process.env.ACA_JOBS_ARM_ENDPOINT,
        });

        let result: IDataObject;
        if (operation === "getStatus") {
          const executionName = this.getNodeParameter(
            "executionName",
            itemIndex,
          ) as string;
          result = {
            executionName,
            status: await client.status(executionName),
          };
        } else {
          const correlationId = this.getNodeParameter(
            "correlationId",
            itemIndex,
          ) as string;
          const overrides = buildOverrides(
            this.getNodeParameter("containerName", itemIndex) as string,
            this.getNodeParameter("overrides", itemIndex, {}) as Record<
              string,
              unknown
            >,
          );
          if (operation === "start") {
            result = {
              executionName: await client.start(correlationId, overrides),
              correlationId,
            };
          } else {
            const execution = await client.startAndWait({
              correlationId,
              overrides,
              executionName:
                (this.getNodeParameter(
                  "resumeExecutionName",
                  itemIndex,
                  "",
                ) as string) || undefined,
              pollIntervalMs:
                (this.getNodeParameter(
                  "pollIntervalSeconds",
                  itemIndex,
                ) as number) * 1_000,
              timeoutMs:
                (this.getNodeParameter("timeoutSeconds", itemIndex) as number) *
                1_000,
            });
            result = { ...execution };
          }
        }

        output.push({
          json: { ...items[itemIndex].json, ...result },
          pairedItem: itemIndex,
        });
      } catch (error) {
        const nodeError =
          error instanceof NodeOperationError
            ? error
            : new NodeOperationError(this.getNode(), error as Error, {
                itemIndex,
              });
        if (this.continueOnFail()) {
          output.push({
            json: items[itemIndex].json,
            error: nodeError,
            pairedItem: itemIndex,
          });
          continue;
        }
        throw nodeError;
      }
    }

    return [output];
  }
}

function buildOverrides(
  containerName: string,
  values: Record<string, unknown>,
): WorkloadOverrides | undefined {
  if (Object.keys(values).length === 0) return undefined;
  return {
    containerName,
    command: readJsonArray<string>(values.command),
    args: readJsonArray<string>(values.args),
    env: readJsonArray<{ name: string; value?: string; secretRef?: string }>(
      values.env,
    ),
    cpu: typeof values.cpu === "number" ? values.cpu : undefined,
    memory: typeof values.memory === "string" ? values.memory : undefined,
  };
}

function readJsonArray<T>(value: unknown): T[] | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed))
    throw new Error("Override fields must be JSON arrays.");
  return parsed as T[];
}
