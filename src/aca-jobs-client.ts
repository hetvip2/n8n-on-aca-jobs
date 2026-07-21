export const DEFAULT_API_VERSION = "2024-03-01";
export const USER_AGENT = "n8n-nodes-aca-jobs/0.1.0";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const TERMINAL_SUCCESS = new Set(["Succeeded"]);
const TERMINAL_FAILURE = new Set(["Failed", "Canceled"]);

export interface AcaJobRef {
  subscriptionId: string;
  resourceGroup: string;
  jobName: string;
}

export interface WorkloadOverrides {
  containerName: string;
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value?: string; secretRef?: string }>;
  cpu?: number;
  memory?: string;
}

export interface AcaExecutionResult {
  executionName: string;
  status: string;
  correlationId: string;
  startedAt: string;
  completedAt: string;
}

export interface AcaJobsClientOptions {
  job: AcaJobRef;
  getToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  armEndpoint?: string;
  apiVersion?: string;
  maxRetries?: number;
}

export class AcaJobsError extends Error {}

interface AcaExecutionState {
  status: string;
  startTime?: string;
  endTime?: string;
}

export class AcaJobsClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly apiVersion: string;
  private readonly maxRetries: number;

  constructor(private readonly options: AcaJobsClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.maxRetries = options.maxRetries ?? 6;
  }

  async startAndWait(input: {
    correlationId: string;
    overrides?: WorkloadOverrides;
    pollIntervalMs?: number;
    timeoutMs?: number;
    executionName?: string;
  }): Promise<AcaExecutionResult> {
    const startedAt = new Date().toISOString();
    const executionName =
      input.executionName ??
      (await this.start(input.correlationId, input.overrides));
    const deadline = Date.now() + (input.timeoutMs ?? 30 * 60_000);

    while (Date.now() < deadline) {
      const state = await this.execution(executionName, input.correlationId);
      if (TERMINAL_SUCCESS.has(state.status)) {
        return {
          executionName,
          status: state.status,
          correlationId: input.correlationId,
          startedAt: state.startTime ?? startedAt,
          completedAt: state.endTime ?? new Date().toISOString(),
        };
      }
      if (TERMINAL_FAILURE.has(state.status)) {
        throw new AcaJobsError(
          `ACA Job execution '${executionName}' finished with status '${state.status}'.`,
        );
      }
      if (
        !["Running", "Processing", "Pending", "Unknown"].includes(state.status)
      ) {
        throw new AcaJobsError(
          `ACA Job execution '${executionName}' returned unknown status '${state.status}'.`,
        );
      }
      await this.sleep(input.pollIntervalMs ?? 5_000);
    }

    throw new AcaJobsError(
      `Timed out waiting for ACA Job execution '${executionName}'.`,
    );
  }

  async start(
    correlationId: string,
    overrides?: WorkloadOverrides,
  ): Promise<string> {
    const body = overrides
      ? await this.mergeOverrides(correlationId, overrides)
      : undefined;
    const response = await this.request("POST", "start", correlationId, body);
    const payload = await parseObject(response);
    const bodyName =
      typeof payload.name === "string" ? payload.name : undefined;
    const location = response.headers.get("location");
    const locationName = location?.match(/\/executions\/([^/?]+)/)?.[1];
    const executionName = bodyName ?? locationName;
    if (!executionName) {
      throw new AcaJobsError(
        "ACA start response did not include an execution name in its body or Location header.",
      );
    }
    return executionName;
  }

  private async mergeOverrides(
    correlationId: string,
    overrides: WorkloadOverrides,
  ): Promise<object> {
    const response = await this.request("GET", "", correlationId);
    const payload = await parseObject(response);
    const properties = isObject(payload.properties) ? payload.properties : {};
    const template = isObject(properties.template) ? properties.template : {};
    const containers = Array.isArray(template.containers)
      ? template.containers
      : [];
    const current = containers.find(
      (container) =>
        isObject(container) && container.name === overrides.containerName,
    );
    if (!isObject(current)) {
      throw new AcaJobsError(
        `ACA Job definition has no container named '${overrides.containerName}'.`,
      );
    }

    const container = structuredClone(current);
    for (const key of ["command", "args", "cpu", "memory"] as const) {
      const value = overrides[key];
      if (value !== undefined) container[key] = value;
    }
    if (overrides.env !== undefined) {
      const environment = new Map<string, Record<string, unknown>>();
      if (Array.isArray(container.env)) {
        for (const item of container.env) {
          if (isObject(item) && typeof item.name === "string") {
            environment.set(item.name, structuredClone(item));
          }
        }
      }
      for (const item of overrides.env) {
        environment.set(item.name, { ...item });
      }
      container.env = [...environment.values()];
    }
    return { containers: [container] };
  }

  async status(executionName: string): Promise<string> {
    return (await this.execution(executionName, executionName)).status;
  }

  private async execution(
    executionName: string,
    correlationId: string,
  ): Promise<AcaExecutionState> {
    const response = await this.request(
      "GET",
      `executions/${encodeURIComponent(executionName)}`,
      correlationId,
    );
    const payload = await parseObject(response);
    const properties = isObject(payload.properties) ? payload.properties : {};
    if (typeof properties.status !== "string" || !properties.status) {
      throw new AcaJobsError(
        "ACA execution response did not include properties.status.",
      );
    }
    return {
      status: properties.status,
      startTime:
        typeof properties.startTime === "string"
          ? properties.startTime
          : undefined,
      endTime:
        typeof properties.endTime === "string" ? properties.endTime : undefined,
    };
  }

  private async request(
    method: string,
    path: string,
    correlationId: string,
    body?: object,
  ): Promise<Response> {
    let token = await this.options.getToken();
    let refreshed = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.baseUrl}/${path}?api-version=${this.apiVersion}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "User-Agent": USER_AGENT,
              "x-ms-client-request-id": correlationId,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
      } catch {
        if (attempt >= this.maxRetries) {
          throw new AcaJobsError("ARM network request failed after retries.");
        }
        await this.sleep(Math.min(1_000 * 2 ** attempt, 60_000));
        continue;
      }

      if (response.status === 401 && !refreshed) {
        token = await this.options.getToken();
        refreshed = true;
        continue;
      }
      if (response.status === 401) {
        throw new AcaJobsError(
          "ARM authentication failed with HTTP 401 after token refresh.",
        );
      }
      if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
        const delayMs = retryDelayMs(
          response.headers.get("retry-after"),
          attempt,
        );
        await this.sleep(delayMs);
        continue;
      }
      if (!response.ok) {
        throw new AcaJobsError(
          `ARM request failed with HTTP ${response.status}.`,
        );
      }
      return response;
    }
    throw new AcaJobsError("ARM request exhausted its retry budget.");
  }

  private get baseUrl(): string {
    const { subscriptionId, resourceGroup, jobName } = this.options.job;
    const armEndpoint = (
      this.options.armEndpoint ?? "https://management.azure.com"
    ).replace(/\/$/, "");
    return (
      `${armEndpoint}/subscriptions/${encodeURIComponent(subscriptionId)}` +
      `/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.App/jobs/${encodeURIComponent(jobName)}`
    );
  }
}

async function parseObject(
  response: Response,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AcaJobsError("ARM returned malformed JSON.");
  }
  if (!isObject(value)) {
    throw new AcaJobsError("ARM returned a non-object JSON response.");
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1_000, 60_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date))
      return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  return Math.min(1_000 * 2 ** attempt, 60_000);
}
