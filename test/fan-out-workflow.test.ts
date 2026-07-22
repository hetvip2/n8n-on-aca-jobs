import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type WorkflowNode = {
  name: string;
  parameters: { jsCode?: string };
};

const workflow = JSON.parse(
  readFileSync("workflows/fan-out-fan-in.json", "utf8"),
) as { nodes: WorkflowNode[] };
const createShardsCode = workflow.nodes.find(
  ({ name }) => name === "Create shards",
)?.parameters.jsCode;

function createShards(shardCount?: string): Array<{ json: { shard: number } }> {
  if (!createShardsCode) throw new Error("Create shards Code node is missing");
  const execute = new Function("$env", createShardsCode) as (
    environment: Record<string, string | undefined>,
  ) => Array<{ json: { shard: number } }>;
  return execute({ ACA_JOB_SHARD_COUNT: shardCount });
}

describe("fan-out workflow", () => {
  it("defaults to five shards", () => {
    expect(createShards()).toHaveLength(5);
  });

  it("accepts a 25-shard configuration", () => {
    const shards = createShards("25");
    expect(shards).toHaveLength(25);
    expect(shards.at(-1)?.json.shard).toBe(24);
  });

  it.each(["0", "51", "2.5", "invalid"])(
    "rejects invalid shard count %s",
    (shardCount) => {
      expect(() => createShards(shardCount)).toThrow(
        "ACA_JOB_SHARD_COUNT must be an integer from 1 to 50",
      );
    },
  );
});
