import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { PlaceCandidate } from "./place";
import { isPlaceCandidate } from "./place";
import {
  isDailyForecast,
  isWeatherFact,
  type DailyForecast,
  type WeatherFact,
} from "./weather";

const weatherMcpUrl =
  process.env.WEATHER_MCP_URL ?? "http://127.0.0.1:3101/mcp";

export type WeatherServiceErrorCategory =
  | "mcp_unavailable"
  | "configuration"
  | "timeout"
  | "unauthorized"
  | "unavailable"
  | "invalid_data";

export class WeatherServiceError extends Error {
  constructor(public readonly category: WeatherServiceErrorCategory) {
    super("Weather service request failed");
    this.name = "WeatherServiceError";
  }
}

export type WeatherMcpFailureMode = WeatherServiceErrorCategory;

export type WeatherMcpRequestOptions = {
  failureMode?: WeatherMcpFailureMode;
  requestId?: string;
};

function createTransport(options?: WeatherMcpRequestOptions) {
  const headers: Record<string, string> = {};
  if (options?.requestId) {
    headers["x-request-id"] = options.requestId;
  }
  if (options?.failureMode) {
    headers["x-weather-mcp-failure"] = options.failureMode;
  }

  return new StreamableHTTPClientTransport(new URL(weatherMcpUrl), {
    requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
  });
}

function parseErrorCategory(text: string): WeatherServiceErrorCategory {
  const category = text.match(/^WEATHER_PROVIDER_ERROR:(\w+)$/u)?.[1];
  if (
    category === "configuration" ||
    category === "timeout" ||
    category === "unauthorized" ||
    category === "unavailable" ||
    category === "invalid_data"
  ) {
    return category;
  }

  return "unavailable";
}

async function callWeatherTool<T>(
  name: string,
  args: Record<string, unknown>,
  parse: (text: string) => T,
  options?: WeatherMcpRequestOptions,
): Promise<T> {
  const client = new Client({ name: "weather-chat", version: "0.1.0" });
  const transport = createTransport(options);
  const startedAt = Date.now();
  const requestId = options?.requestId ?? "unknown";

  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (result.isError) {
      throw new WeatherServiceError(
        text ? parseErrorCategory(text) : "unavailable",
      );
    }
    if (!text) {
      throw new WeatherServiceError("invalid_data");
    }

    const parsed = parse(text);
    console.info({
      requestId,
      tool: name,
      durationMs: Date.now() - startedAt,
      status: "success",
    });
    return parsed;
  } catch (error) {
    const serviceError = error instanceof WeatherServiceError
      ? error
      : new WeatherServiceError("mcp_unavailable");
    console.error({
      requestId,
      tool: name,
      durationMs: Date.now() - startedAt,
      status: "failed",
      errorCategory: serviceError.category,
    });
    throw serviceError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function parseCandidates(text: string): PlaceCandidate[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new WeatherServiceError("invalid_data");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { candidates?: unknown }).candidates)
  ) {
    throw new WeatherServiceError("invalid_data");
  }

  const candidates = (payload as { candidates: unknown[] }).candidates;
  if (!candidates.every(isPlaceCandidate)) {
    throw new WeatherServiceError("invalid_data");
  }

  return candidates;
}

export function resolvePlace(
  query: string,
  options?: WeatherMcpRequestOptions,
): Promise<PlaceCandidate[]> {
  return callWeatherTool(
    "resolve_place",
    { query },
    parseCandidates,
    options,
  );
}

export function resolveCoordinates(
  latitude: number,
  longitude: number,
  options?: WeatherMcpRequestOptions,
): Promise<PlaceCandidate[]> {
  return callWeatherTool(
    "resolve_coordinates",
    { latitude, longitude },
    parseCandidates,
    options,
  );
}

function parseWeather(text: string): WeatherFact {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new WeatherServiceError("invalid_data");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !isWeatherFact((payload as { weather?: unknown }).weather)
  ) {
    throw new WeatherServiceError("invalid_data");
  }

  return (payload as { weather: WeatherFact }).weather;
}

export function getCurrentWeather(
  place: PlaceCandidate,
  options?: WeatherMcpRequestOptions,
): Promise<WeatherFact> {
  return callWeatherTool(
    "current_weather",
    { place, range: "current" },
    parseWeather,
    options,
  );
}

export async function getDailyForecast(
  place: PlaceCandidate,
  days: number,
  startDaysAhead = 1,
  targetDate?: string,
  options?: WeatherMcpRequestOptions,
): Promise<DailyForecast> {
  return callWeatherTool(
    "daily_forecast",
    { place, range: { type: "daily", days, startDaysAhead, targetDate } },
    parseForecast,
    options,
  );
}

function parseForecast(text: string): DailyForecast {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new WeatherServiceError("invalid_data");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !isDailyForecast((payload as { forecast?: unknown }).forecast)
  ) {
    throw new WeatherServiceError("invalid_data");
  }

  return (payload as { forecast: DailyForecast }).forecast;
}

export async function getDailyForecastDay(
  place: PlaceCandidate,
  targetDate: string,
  options?: WeatherMcpRequestOptions,
): Promise<DailyForecast> {
  const forecast = await getDailyForecast(place, 1, 1, targetDate, options);
  const day = forecast.days[0];
  if (!day) {
    throw new Error("每日预报缺少目标日期");
  }

  return { ...forecast, days: [day] };
}
