import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { resolvePlaces } from "./places.js";
import {
  getCurrentWeather,
  getDailyForecast,
  WeatherProviderError,
} from "./weather.js";

const host = process.env.WEATHER_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.WEATHER_MCP_PORT ?? 3101);

const confirmedPlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  administrativeArea: z.string().min(1),
  country: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timeZone: z.string().min(1),
});

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
      const requestId = randomUUID();
      const startedAt = Date.now();

      try {
        const weather = await getCurrentWeather(place);
        console.info({
          requestId,
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
          requestId,
          tool: "current_weather",
          durationMs: Date.now() - startedAt,
          status: "failed",
          errorCategory: category,
        });
        throw new Error("当前天气暂时无法确认");
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
      const requestId = randomUUID();
      const startedAt = Date.now();

      try {
        const forecast = await getDailyForecast(
          place,
          range.days,
          range.startDaysAhead,
          range.targetDate,
        );
        console.info({
          requestId,
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
          requestId,
          tool: "daily_forecast",
          durationMs: Date.now() - startedAt,
          status: "failed",
          errorCategory: category,
        });
        throw new Error("每日预报暂时无法确认");
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
