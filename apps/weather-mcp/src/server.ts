import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { resolvePlaces } from "./places.js";

const host = process.env.WEATHER_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.WEATHER_MCP_PORT ?? 3101);

function createWeatherServer() {
  const server = new McpServer({ name: "weather-mcp", version: "0.1.0" });

  server.registerTool(
    "resolve_place",
    {
      description: "Resolve a user-provided place name into confirmed-place candidates.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100),
      }),
    },
    async ({ query }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ candidates: resolvePlaces(query) }),
        },
      ],
    }),
  );

  return server;
}

const httpServer = createServer(async (request, response) => {
  if (request.url === "/health" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (request.url !== "/mcp") {
    response.writeHead(404);
    response.end();
    return;
  }

  const server = createWeatherServer();
  const transport = new NodeStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json" });
    }
    response.end(JSON.stringify({ error: "Weather MCP request failed" }));
    console.error({ requestId: randomUUID(), error });
  }
});

httpServer.listen(port, host, () => {
  console.log(`Weather MCP listening on http://${host}:${port}/mcp`);
});

async function shutdown() {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
