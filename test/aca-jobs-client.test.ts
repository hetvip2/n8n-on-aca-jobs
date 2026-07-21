import { describe, expect, it, vi } from "vitest";

import { AcaJobsClient, AcaJobsError } from "../src/aca-jobs-client.js";

const job = { subscriptionId: "sub", resourceGroup: "rg", jobName: "job" };

function jsonResponse(
  status: number,
  body: object,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("AcaJobsClient", () => {
  it("starts once and polls the same execution to success", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { name: "job-abc" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { properties: { status: "Running" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { properties: { status: "Succeeded" } }),
      );
    const client = new AcaJobsClient({
      job,
      getToken: async () => "token",
      fetch,
      sleep: async () => {},
    });

    const result = await client.startAndWait({
      correlationId: "n8n-run-1",
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({
      executionName: "job-abc",
      status: "Succeeded",
      correlationId: "n8n-run-1",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0][0])).toContain(
      "/start?api-version=2024-03-01",
    );
    expect(fetch.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      "x-ms-client-request-id": "n8n-run-1",
    });
    expect(String(fetch.mock.calls[1][0])).toContain(
      "/executions/job-abc?api-version=2024-03-01",
    );
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
      "x-ms-client-request-id": "n8n-run-1",
    });
  });

  it("merges partial overrides without losing ACA container defaults", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          properties: {
            template: {
              containers: [
                {
                  name: "processor",
                  image: "example/work:1",
                  resources: { cpu: 0.25, memory: "512Mi" },
                  env: [
                    { name: "KEEP", value: "yes" },
                    { name: "MODE", value: "old" },
                  ],
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { name: "job-overridden" }));
    const client = new AcaJobsClient({
      job,
      getToken: async () => "token",
      fetch,
    });

    await client.start("n8n-run-override", {
      containerName: "processor",
      args: ["--shard", "4"],
      env: [{ name: "MODE", value: "batch" }],
      cpu: 0.5,
      memory: "1Gi",
    });

    expect(fetch.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      "x-ms-client-request-id": "n8n-run-override",
    });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      containers: [
        {
          name: "processor",
          image: "example/work:1",
          resources: { cpu: 0.25, memory: "512Mi" },
          args: ["--shard", "4"],
          env: [
            { name: "KEEP", value: "yes" },
            { name: "MODE", value: "batch" },
          ],
          cpu: 0.5,
          memory: "1Gi",
        },
      ],
    });
  });

  it("honors Retry-After and refreshes once after a 401", async () => {
    const sleep = vi.fn(async () => {});
    const getToken = vi
      .fn()
      .mockResolvedValueOnce("old")
      .mockResolvedValueOnce("new");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "Retry-After": "2" }))
      .mockResolvedValueOnce(jsonResponse(200, { name: "job-retried" }));
    const client = new AcaJobsClient({ job, getToken, fetch, sleep });

    await expect(client.start("run-2")).resolves.toBe("job-retried");
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("retries network failures and reports a repeated 401 without leaking tokens", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("socket included secret-token"))
      .mockResolvedValueOnce(
        jsonResponse(200, { name: "after-network-retry" }),
      );
    const client = new AcaJobsClient({
      job,
      getToken: async () => "secret-token",
      fetch,
      sleep,
    });

    await expect(client.start("network-run")).resolves.toBe(
      "after-network-retry",
    );
    expect(sleep).toHaveBeenCalledWith(1_000);

    const unauthorized = new AcaJobsClient({
      job,
      getToken: vi
        .fn()
        .mockResolvedValueOnce("expired")
        .mockResolvedValueOnce("still-expired"),
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(401, {}))
        .mockResolvedValueOnce(jsonResponse(401, {})),
    });
    await expect(unauthorized.start("auth-run")).rejects.toThrow(
      "HTTP 401 after token refresh",
    );
  });

  it("resumes an existing execution without starting a duplicate", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, { properties: { status: "Succeeded" } }),
      );
    const client = new AcaJobsClient({
      job,
      getToken: async () => "token",
      fetch,
    });

    await client.startAndWait({
      correlationId: "run-3",
      executionName: "existing",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/executions/existing");
  });

  it("maps terminal failure and unknown states to explicit errors", async () => {
    const failed = new AcaJobsClient({
      job,
      getToken: async () => "token",
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(200, { name: "failed" }))
        .mockResolvedValueOnce(
          jsonResponse(200, { properties: { status: "Failed" } }),
        ),
    });
    await expect(
      failed.startAndWait({ correlationId: "run-4" }),
    ).rejects.toThrow(AcaJobsError);

    const unknown = new AcaJobsClient({
      job,
      getToken: async () => "token",
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(200, { name: "odd" }))
        .mockResolvedValueOnce(
          jsonResponse(200, { properties: { status: "Mystery" } }),
        ),
    });
    await expect(
      unknown.startAndWait({ correlationId: "run-5" }),
    ).rejects.toThrow("unknown status 'Mystery'");
  });

  it("uses ACA execution timestamps when the service returns them", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { name: "timed" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          properties: {
            status: "Succeeded",
            startTime: "2026-07-15T10:00:00Z",
            endTime: "2026-07-15T10:01:00Z",
          },
        }),
      );
    const client = new AcaJobsClient({
      job,
      getToken: async () => "token",
      fetch,
    });

    await expect(
      client.startAndWait({ correlationId: "timed-run" }),
    ).resolves.toMatchObject({
      startedAt: "2026-07-15T10:00:00Z",
      completedAt: "2026-07-15T10:01:00Z",
    });
  });

  it("does not include response bodies or credentials in HTTP errors", async () => {
    const client = new AcaJobsClient({
      job,
      getToken: async () => "super-secret-token",
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(jsonResponse(403, { token: "leaked-secret" })),
    });

    await expect(client.start("run-6")).rejects.toThrow(
      "ARM request failed with HTTP 403.",
    );
    await expect(client.start("run-6")).rejects.not.toThrow(
      /super-secret-token|leaked-secret/,
    );
  });
});
