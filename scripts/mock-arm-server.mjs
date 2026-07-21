import { createServer } from "node:http";

const port = Number(process.env.MOCK_ARM_PORT ?? 4010);
const executions = new Map();
let counter = 0;

const server = createServer(async (request, response) => {
  const body = await readBody(request);
  const startMatch = request.url?.match(/\/jobs\/([^/]+)\/start\?/);
  const statusMatch = request.url?.match(
    /\/jobs\/([^/]+)\/executions\/([^?]+)\?/,
  );

  response.setHeader("Content-Type", "application/json");
  if (request.headers.authorization !== "Bearer local-smoke-token") {
    response.writeHead(401).end("{}");
    return;
  }
  if (request.method === "POST" && startMatch) {
    const executionName = `local-${++counter}`;
    executions.set(executionName, { polls: 0, body });
    response.writeHead(200).end(JSON.stringify({ name: executionName }));
    return;
  }
  if (request.method === "GET" && statusMatch) {
    const execution = executions.get(decodeURIComponent(statusMatch[2]));
    if (!execution) {
      response.writeHead(404).end("{}");
      return;
    }
    execution.polls += 1;
    const status = execution.polls > 1 ? "Succeeded" : "Running";
    response.writeHead(200).end(JSON.stringify({ properties: { status } }));
    return;
  }
  if (request.method === "GET" && request.url === "/evidence") {
    response.writeHead(200).end(JSON.stringify([...executions.entries()]));
    return;
  }
  response.writeHead(404).end("{}");
});

server.listen(port, "127.0.0.1", () =>
  console.log(`Mock ARM listening on http://127.0.0.1:${port}`),
);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
