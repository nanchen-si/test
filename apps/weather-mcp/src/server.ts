import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { resolveCoordinates, resolvePlaces } from "./places.js";
import {
  getCurrentWeather,
  getDailyForecast,
  type WeatherFailureMode,
  WeatherProviderError,
} from "./weather.js";

const host = process.env.WEATHER_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.WEATHER_MCP_PORT ?? 3101);

type FailureMode = WeatherFailureMode | "mcp_unavailable";

function readFailureMode(request: import("node:http").IncomingMessage): FailureMode | undefined {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.WEATHER_MCP_FAILURE_TEST_MODE !== "1"
  ) {
    return undefined;
  }

  const value = request.headers["x-weather-mcp-failure"];
  if (typeof value !== "string") {
    return undefined;
  }

  const modes: FailureMode[] = [
    "mcp_unavailable",
    "configuration",
    "timeout",
    "unauthorized",
    "unavailable",
    "invalid_data",
  ];
  return modes.includes(value as FailureMode) ? value as FailureMode : undefined;
}

function readRequestId(request: import("node:http").IncomingMessage): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && value.length > 0 ? value : randomUUID();
}

const confirmedPlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  administrativeArea: z.string().min(1),
  country: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timeZone: z.string().min(1),
});

function createWeatherServer(
  failureMode?: FailureMode,
  requestId?: string,
) {
  const server = new McpServer({ name: "weather-mcp", version: "0.1.0" });

  server.registerTool(
    "resolve_place",
    {
      description: "Resolve a user-provided place name into confirmed-place candidates.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100),
      }),
    },
    async ({ query }) => {
      const startedAt = Date.now();
      try {
        const candidates = resolvePlaces(query);
        console.info({
          requestId: requestId ?? randomUUID(),
          tool: "resolve_place",
          durationMs: Date.now() - startedAt,
          status: "success",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ candidates }),
            },
          ],
        };
      } catch {
        console.error({
          requestId: requestId ?? randomUUID(),
          tool: "resolve_place",
          durationMs: Date.now() - startedAt,
          status: "failed",
          errorCategory: "unavailable",
        });
        throw new Error("WEATHER_PROVIDER_ERROR:unavailable");
      }
    },
  );

  server.registerTool(
    "resolve_coordinates",
    {
      description: "Resolve browser coordinates into confirmed-place candidates.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    },
    async ({ latitude, longitude }) => {
      const startedAt = Date.now();
      try {
        const candidates = resolveCoordinates(latitude, longitude);
        console.info({
          requestId: requestId ?? randomUUID(),
          tool: "resolve_coordinates",
          durationMs: Date.now() - startedAt,
          status: "success",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ candidates }),
            },
          ],
        };
      } catch {
        console.error({
          requestId: requestId ?? randomUUID(),
          tool: "resolve_coordinates",
          durationMs: Date.now() - startedAt,
          status: "failed",
          errorCategory: "unavailable",
        });
        throw new Error("WEATHER_PROVIDER_ERROR:unavailable");
      }
    },
  );

  server.registerTool(
    "current_weather",
    {
      description: "Get current weather for an explicitly confirmed place.",
      inputSchema: z.object({
        place: confirmedPlaceSchema,
        range: z.literal("current"),
      }),
    },
    async ({ place }) => {
      const toolRequestId = requestId ?? randomUUID();
      const startedAt = Date.now();

      try {
        const weather = await getCurrentWeather(
          place,
          failureMode === "mcp_unavailable" ? undefined : failureMode,
        );
        console.info({
          requestId: toolRequestId,
          tool: "current_weather",
          durationMs: Date.now() - startedAt,
          status: "success",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ weather }),
            },
          ],
        };
      } catch (error) {
        const category =
          error instanceof WeatherProviderError ? error.category : "unavailable";
        console.error({
          requestId: toolRequestId,
          tool: "current_weather",
          durationMs: Date.now() - startedAt,
          status: "failed",
          errorCategory: category,
        });
        throw new Error(`WEATHER_PROVIDER_ERROR:${category}`);
      }
    },
  );

  server.registerTool(
    "daily_forecast",
    {
      description: "Get a daily forecast for an explicitly confirmed place.",
      inputSchema: z.object({
        place: confirmedPlaceSchema,
        range: z.object({
          type: z.literal("daily"),
          days: z.number().int().min(1).max(7).default(7),
          startDaysAhead: z.number().int().min(0).max(7).default(1),
          targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
        }),
      }),
    },
    async ({ place, range }) => {
      const toolRequestId = requestId ?? randomUUID();
      const startedAt = Date.now();

      try {
        const forecast = await getDailyForecast(
          place,
          range.days,
          range.startDaysAhead,
          range.targetDate,
          failureMode === "mcp_unavailable" ? undefined : failureMode,
        );
        console.info({
          requestId: toolRequestId,
          tool: "daily_forecast",
          durationMs: Date.now() - startedAt,
          status: "success",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ forecast }),
            },
          ],
        };
      } catch (error) {
        const category =
          error instanceof WeatherProviderError ? error.category : "unavailable";
        console.error({
          requestId: toolRequestId,
          tool: "daily_forecast",
          durationMs: Date.now() - startedAt,
          status: "failed",
          errorCategory: category,
        });
        throw new Error(`WEATHER_PROVIDER_ERROR:${category}`);
      }
    },
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

  const startedAt = Date.now();
  const requestId = readRequestId(request);
  const failureMode = readFailureMode(request);
  if (failureMode === "mcp_unavailable") {
    console.error({
      requestId,
      tool: "mcp_transport",
      durationMs: Date.now() - startedAt,
      status: "failed",
      errorCategory: "mcp_unavailable",
    });
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Weather MCP unavailable" }));
    return;
  }

  const server = createWeatherServer(failureMode, requestId);
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
    console.error({
      requestId,
      tool: "mcp_transport",
      durationMs: Date.now() - startedAt,
      status: "failed",
      errorCategory: "unavailable",
    });
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
