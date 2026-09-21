import { randomUUID } from "node:crypto";

import {
  createDeepSeekClient,
  extractComparisonDate,
  extractComparisonPlaceQueries,
  extractForecastDays,
  extractPlaceQuery,
  isCurrentWeatherQuestion,
  isDailyForecastQuestion,
  isWeatherComparisonQuestion,
  streamReply,
} from "../../../lib/assistant";
import {
  getCurrentWeather,
  getDailyForecast,
  getDailyForecastDay,
  resolveCoordinates,
  resolvePlace,
  WeatherServiceError,
  type WeatherMcpFailureMode,
  type WeatherMcpRequestOptions,
} from "../../../lib/location-client";
import {
  formatPlace,
  isPlaceCandidate,
} from "../../../lib/place";
import { appendMessage, getSession } from "../../../lib/session";
import type { WeatherComparison } from "../../../lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  sessionId?: unknown;
  message?: unknown;
  selectedPlace?: unknown;
  location?: unknown;
};

type EventWriter = (
  event: string,
  data: Record<string, string>,
) => void;

class WeatherQueryError extends Error {}

function weatherServiceErrorMessage(
  category: WeatherServiceError["category"],
): string {
  switch (category) {
    case "mcp_unavailable":
      return "天气服务当前不可用，请稍后重试。";
    case "timeout":
      return "天气服务请求超时，请稍后重试。";
    case "unauthorized":
    case "configuration":
      return "天气服务认证或配置异常，暂时无法确认天气。";
    case "invalid_data":
      return "天气服务返回的数据不完整，暂时无法确认天气。";
    case "unavailable":
      return "天气服务暂时不可用，请稍后重试。";
  }
}

function readTestFailureMode(request: Request): WeatherMcpFailureMode | undefined {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.WEATHER_MCP_FAILURE_TEST_MODE !== "1"
  ) {
    return undefined;
  }

  const value = request.headers.get("x-weather-mcp-failure");
  const modes: WeatherMcpFailureMode[] = [
    "mcp_unavailable",
    "configuration",
    "timeout",
    "unauthorized",
    "unavailable",
    "invalid_data",
  ];
  return value && modes.includes(value as WeatherMcpFailureMode)
    ? value as WeatherMcpFailureMode
    : undefined;
}

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: Record<string, string>,
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}

function createSseResponse(run: (write: EventWriter) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write: EventWriter = (event, data) =>
        writeEvent(controller, encoder, event, data);

      try {
        await run(write);
        controller.close();
      } catch (error) {
        write("error", {
          message:
            error instanceof WeatherQueryError
              ? error.message
              : error instanceof WeatherServiceError
                ? weatherServiceErrorMessage(error.category)
              : "聊天请求失败",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

async function streamAssistantReply(
  write: EventWriter,
  reply: string,
): Promise<void> {
  for await (const delta of streamReply(reply)) {
    write("text.delta", { delta });
  }
}

async function streamCurrentWeather(
  write: EventWriter,
  place: NonNullable<ReturnType<typeof getSession>["confirmedPlace"]>,
  question?: string,
  options?: WeatherMcpRequestOptions,
): Promise<string> {
  write("tool.start", { name: "current_weather" });
  let weather: Awaited<ReturnType<typeof getCurrentWeather>>;
  try {
    weather = await getCurrentWeather(place, options);
  } catch (error) {
    if (error instanceof WeatherServiceError) {
      throw error;
    }
    throw new WeatherQueryError("当前天气暂时无法确认");
  }
  write("tool.complete", { name: "current_weather" });
  write("weather.fact", { weather: JSON.stringify(weather) });
  let reply = "";
  for await (const delta of deepSeekClient.streamWeather(weather, question)) {
    reply += delta;
    write("text.delta", { delta });
  }
  return reply;
}

async function streamDailyForecast(
  write: EventWriter,
  place: NonNullable<ReturnType<typeof getSession>["confirmedPlace"]>,
  days: number,
  question?: string,
  options?: WeatherMcpRequestOptions,
): Promise<string> {
  write("tool.start", { name: "daily_forecast" });
  let forecast: Awaited<ReturnType<typeof getDailyForecast>>;
  try {
    forecast = await getDailyForecast(place, days, 1, undefined, options);
  } catch (error) {
    if (error instanceof WeatherServiceError) {
      throw error;
    }
    throw new WeatherQueryError("每日预报暂时无法确认");
  }
  write("tool.complete", { name: "daily_forecast" });
  write("weather.forecast", { forecast: JSON.stringify(forecast) });
  let reply = "";
  for await (const delta of deepSeekClient.streamForecast(forecast, question)) {
    reply += delta;
    write("text.delta", { delta });
  }
  return reply;
}

async function streamWeatherComparison(
  write: EventWriter,
  places: NonNullable<ReturnType<typeof getSession>["confirmedPlace"]>[],
  targetDate: string,
  question?: string,
  options?: WeatherMcpRequestOptions,
): Promise<string> {
  write("tool.start", { name: "daily_forecast" });
  let comparison: WeatherComparison;
  try {
    const forecasts = await Promise.all(
      places.map((place) => getDailyForecastDay(place, targetDate, options)),
    );
    if (
      forecasts.some((forecast) => forecast.days[0]?.date !== targetDate)
    ) {
      throw new Error("地点预报的本地日期不一致");
    }
    comparison = { forecasts };
  } catch (error) {
    if (error instanceof WeatherServiceError) {
      throw error;
    }
    throw new WeatherQueryError("同日天气暂时无法确认");
  }
  write("tool.complete", { name: "daily_forecast" });
  write("weather.comparison", { comparison: JSON.stringify(comparison) });
  let reply = "";
  for await (const delta of deepSeekClient.streamComparison(comparison, question)) {
    reply += delta;
    write("text.delta", { delta });
  }
  return reply;
}

function getLocalDate(timeZone: string, daysAhead: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + daysAhead,
      12,
    ),
  );
  const nextParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const nextValues = Object.fromEntries(
    nextParts.map((part) => [part.type, part.value]),
  );
  return `${nextValues.year}-${nextValues.month}-${nextValues.day}`;
}

const deepSeekClient = createDeepSeekClient();

export async function POST(request: Request) {
  const requestId = randomUUID();
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }

  if (
    typeof body.sessionId !== "string" ||
    body.sessionId.length === 0 ||
    body.sessionId.length > 100 ||
    typeof body.message !== "string" ||
    body.message.trim().length === 0 ||
    body.message.length > 2_000
  ) {
    return Response.json({ error: "消息内容无效" }, { status: 400 });
  }

  const sessionId = body.sessionId;
  const message = body.message.trim();
  const session = getSession(sessionId);
  const failureMode = readTestFailureMode(request);
  const weatherMcpOptions = { requestId, failureMode };

  if (body.location !== undefined) {
    const location = body.location;
    if (
      !location ||
      typeof location !== "object" ||
      typeof (location as { latitude?: unknown }).latitude !== "number" ||
      typeof (location as { longitude?: unknown }).longitude !== "number" ||
      !Number.isFinite((location as { latitude: number }).latitude) ||
      !Number.isFinite((location as { longitude: number }).longitude) ||
      (location as { latitude: number }).latitude < -90 ||
      (location as { latitude: number }).latitude > 90 ||
      (location as { longitude: number }).longitude < -180 ||
      (location as { longitude: number }).longitude > 180
    ) {
      return Response.json({ error: "定位坐标无效" }, { status: 400 });
    }

    const latitude = (location as { latitude: number }).latitude;
    const longitude = (location as { longitude: number }).longitude;
    appendMessage(sessionId, { role: "user", content: message });
    session.pendingWeatherComparison = undefined;

    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      write("tool.start", { name: "resolve_coordinates" });
      const candidates = await resolveCoordinates(
        latitude,
        longitude,
        weatherMcpOptions,
      );
      session.pendingPlaces = candidates;
      session.pendingWeatherRequest = candidates.length
        ? { type: "current", question: message }
        : undefined;
      write("tool.complete", {
        name: "resolve_coordinates",
        resultCount: String(candidates.length),
      });

      const reply = candidates.length
        ? "已根据当前位置找到地点，请确认后查询当前天气。"
        : "无法确认当前位置，请输入城市名称。";
      await streamAssistantReply(write, reply);
      appendMessage(sessionId, { role: "assistant", content: reply });
      if (candidates.length) {
        write("place.candidates", {
          candidates: JSON.stringify(candidates),
        });
      }
      write("message.complete", { message: reply });
    });
  }

  if (body.selectedPlace !== undefined) {
    const requestedPlace = body.selectedPlace;
    if (!isPlaceCandidate(requestedPlace)) {
      return Response.json({ error: "地点选择无效" }, { status: 400 });
    }

    const pendingWeatherComparison = session.pendingWeatherComparison;
    if (pendingWeatherComparison) {
      const group = pendingWeatherComparison.places.find(
        (candidateGroup) =>
          !candidateGroup.confirmedPlace &&
          candidateGroup.candidates.some(
            (candidate) => candidate.id === requestedPlace.id,
          ),
      );
      const selectedPlace = group?.candidates.find(
        (candidate) => candidate.id === requestedPlace.id,
      );
      if (!group || !selectedPlace) {
        return Response.json({ error: "地点候选已失效" }, { status: 400 });
      }

      group.confirmedPlace = selectedPlace;
      appendMessage(sessionId, {
        role: "user",
        content: `确认地点：${formatPlace(selectedPlace)}`,
      });

      return createSseResponse(async (write) => {
        write("message.start", { sessionId });
        write("comparison.place.confirmed", {
          place: JSON.stringify(selectedPlace),
        });
        const remainingGroups = pendingWeatherComparison.places
          .filter((candidateGroup) => !candidateGroup.confirmedPlace)
          .map(({ query, candidates }) => ({ query, candidates }));
        write("comparison.candidates", {
          groups: JSON.stringify(remainingGroups),
        });

        const confirmedPlaces = pendingWeatherComparison.places
          .map((candidateGroup) => candidateGroup.confirmedPlace)
          .filter(
            (place): place is NonNullable<typeof place> => place !== undefined,
          );
        let reply: string;
        if (confirmedPlaces.length === pendingWeatherComparison.places.length) {
          session.pendingWeatherComparison = undefined;
          const targetDate = pendingWeatherComparison.targetDate ??
            getLocalDate(
              confirmedPlaces[0].timeZone,
              pendingWeatherComparison.daysAhead ?? 0,
            );
          reply = await streamWeatherComparison(
            write,
            confirmedPlaces,
            targetDate,
            pendingWeatherComparison.question,
            weatherMcpOptions,
          );
        } else {
          reply = `已确认${formatPlace(selectedPlace)}，请再选择另一个地点。`;
          await streamAssistantReply(write, reply);
        }

        appendMessage(sessionId, { role: "assistant", content: reply });
        write("message.complete", { message: reply });
      });
    }

    const selectedPlace = session.pendingPlaces.find(
      (candidate) => candidate.id === requestedPlace.id,
    );
    if (!selectedPlace) {
      return Response.json({ error: "地点候选已失效" }, { status: 400 });
    }

    session.pendingPlaces = [];
    session.confirmedPlace = selectedPlace;
    const pendingWeatherRequest = session.pendingWeatherRequest;
    session.pendingWeatherRequest = undefined;
    appendMessage(sessionId, {
      role: "user",
      content: `确认地点：${formatPlace(selectedPlace)}`,
    });

    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      write("place.confirmed", {
        place: JSON.stringify(selectedPlace),
      });
      const reply = pendingWeatherRequest?.type === "daily"
        ? await streamDailyForecast(
            write,
            selectedPlace,
            pendingWeatherRequest.days ?? 7,
            pendingWeatherRequest.question,
            weatherMcpOptions,
          )
        : await streamCurrentWeather(
            write,
            selectedPlace,
            pendingWeatherRequest?.question ?? message,
            weatherMcpOptions,
          );
      appendMessage(sessionId, { role: "assistant", content: reply });
      write("message.complete", { message: reply });
    });
  }

  appendMessage(sessionId, { role: "user", content: message });
  session.pendingWeatherComparison = undefined;

  if (isWeatherComparisonQuestion(message)) {
    const comparisonQueries = extractComparisonPlaceQueries(message);
    const comparisonDate = extractComparisonDate(message);
    if (!comparisonQueries || !comparisonDate) {
      return createSseResponse(async (write) => {
        write("message.start", { sessionId });
        const reply = "请明确说明要比较的日期，例如今天、明天或后天。";
        await streamAssistantReply(write, reply);
        appendMessage(sessionId, { role: "assistant", content: reply });
        write("message.complete", { message: reply });
      });
    }

    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      write("tool.start", { name: "resolve_place" });
      const [firstCandidates, secondCandidates] = await Promise.all(
        comparisonQueries.map((query) => resolvePlace(query, weatherMcpOptions)),
      );
      const places = [
        { query: comparisonQueries[0], candidates: firstCandidates },
        { query: comparisonQueries[1], candidates: secondCandidates },
      ];
      session.pendingPlaces = [];
      session.pendingWeatherRequest = undefined;
      session.pendingWeatherComparison = places.every(
        (candidateGroup) => candidateGroup.candidates.length > 0,
      )
        ? { ...comparisonDate, question: message, places }
        : undefined;
      write("tool.complete", {
        name: "resolve_place",
        resultCount: String(firstCandidates.length + secondCandidates.length),
      });

      const reply = session.pendingWeatherComparison
        ? "找到了两个地点，请分别选择要比较的地点。"
        : "至少有一个地点没有找到，请换一种写法后重试。";
      await streamAssistantReply(write, reply);
      appendMessage(sessionId, { role: "assistant", content: reply });
      if (session.pendingWeatherComparison) {
        write("comparison.candidates", {
          groups: JSON.stringify(places),
        });
      }
      write("message.complete", { message: reply });
    });
  }

  const placeQuery = extractPlaceQuery(message);

  if (placeQuery) {
    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      write("tool.start", { name: "resolve_place" });
      const candidates = await resolvePlace(placeQuery, weatherMcpOptions);
      session.pendingPlaces = candidates;
      session.pendingWeatherRequest = candidates.length
        ? {
            type: isDailyForecastQuestion(message) ? "daily" : "current",
            days: extractForecastDays(message) ?? undefined,
            question: message,
          }
        : undefined;
      write("tool.complete", {
        name: "resolve_place",
        resultCount: String(candidates.length),
      });

      const reply = candidates.length
        ? `找到了 ${candidates.length} 个地点候选，请选择一个。`
        : `没有找到“${placeQuery}”对应的地点，请换一种写法。`;
      await streamAssistantReply(write, reply);
      appendMessage(sessionId, { role: "assistant", content: reply });

      if (candidates.length) {
        write("place.candidates", {
          candidates: JSON.stringify(candidates),
        });
      }
      write("message.complete", { message: reply });
    });
  }

  if (isDailyForecastQuestion(message)) {
    if (!session.confirmedPlace) {
      return createSseResponse(async (write) => {
        write("message.start", { sessionId });
        const reply = "请先告诉我想查询的地点。";
        await streamAssistantReply(write, reply);
        appendMessage(sessionId, { role: "assistant", content: reply });
        write("message.complete", { message: reply });
      });
    }

    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      const reply = await streamDailyForecast(
        write,
        session.confirmedPlace!,
        extractForecastDays(message) ?? 7,
        message,
        weatherMcpOptions,
      );
      appendMessage(sessionId, { role: "assistant", content: reply });
      write("message.complete", { message: reply });
    });
  }

  if (isCurrentWeatherQuestion(message)) {
    if (!session.confirmedPlace) {
      return createSseResponse(async (write) => {
        write("message.start", { sessionId });
        const reply = "请先告诉我想查询的地点。";
        await streamAssistantReply(write, reply);
        appendMessage(sessionId, { role: "assistant", content: reply });
        write("message.complete", { message: reply });
      });
    }

    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      const reply = await streamCurrentWeather(
        write,
        session.confirmedPlace!,
        message,
        weatherMcpOptions,
      );
      appendMessage(sessionId, { role: "assistant", content: reply });
      write("message.complete", { message: reply });
    });
  }

  return createSseResponse(async (write) => {
    write("message.start", { sessionId });
    let reply = "";

    for await (const delta of deepSeekClient.stream(session.messages)) {
      reply += delta;
      write("text.delta", { delta });
    }

    appendMessage(sessionId, { role: "assistant", content: reply });
    write("message.complete", { message: reply });
  });
}
