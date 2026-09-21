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

export async function resolvePlace(query: string): Promise<PlaceCandidate[]> {
  const client = new Client({ name: "weather-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(weatherMcpUrl));

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "resolve_place",
      arguments: { query },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      throw new Error("地点解析返回为空");
    }

    const payload: unknown = JSON.parse(text);
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray((payload as { candidates?: unknown }).candidates)
    ) {
      throw new Error("地点解析返回格式无效");
    }

    const candidates = (payload as { candidates: unknown[] }).candidates;
    if (!candidates.every(isPlaceCandidate)) {
      throw new Error("地点候选格式无效");
    }

    return candidates;
  } finally {
    await client.close();
  }
}

export async function getCurrentWeather(
  place: PlaceCandidate,
): Promise<WeatherFact> {
  const client = new Client({ name: "weather-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(weatherMcpUrl));

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "current_weather",
      arguments: { place, range: "current" },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      throw new Error("当前天气返回为空");
    }

    const payload: unknown = JSON.parse(text);
    if (
      !payload ||
      typeof payload !== "object" ||
      !isWeatherFact((payload as { weather?: unknown }).weather)
    ) {
      throw new Error("当前天气返回格式无效");
    }

    return (payload as { weather: WeatherFact }).weather;
  } finally {
    await client.close();
  }
}

export async function getDailyForecast(
  place: PlaceCandidate,
  days: number,
  startDaysAhead = 1,
  targetDate?: string,
): Promise<DailyForecast> {
  const client = new Client({ name: "weather-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(weatherMcpUrl));

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "daily_forecast",
      arguments: {
        place,
        range: { type: "daily", days, startDaysAhead, targetDate },
      },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      throw new Error("每日预报返回为空");
    }

    const payload: unknown = JSON.parse(text);
    if (
      !payload ||
      typeof payload !== "object" ||
      !isDailyForecast((payload as { forecast?: unknown }).forecast)
    ) {
      throw new Error("每日预报返回格式无效");
    }

    return (payload as { forecast: DailyForecast }).forecast;
  } finally {
    await client.close();
  }
}

export async function getDailyForecastDay(
  place: PlaceCandidate,
  targetDate: string,
): Promise<DailyForecast> {
  const forecast = await getDailyForecast(place, 1, 1, targetDate);
  const day = forecast.days[0];
  if (!day) {
    throw new Error("每日预报缺少目标日期");
  }

  return { ...forecast, days: [day] };
}
