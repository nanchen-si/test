import { createPrivateKey, sign } from "node:crypto";

import { z } from "zod/v4";

import type { PlaceCandidate } from "./places.js";

export type WeatherFact = {
  place: PlaceCandidate;
  dataTime: string;
  dataTimeSource: "provider" | "retrieved";
  timeZone: string;
  temperatureC: number;
  feelsLikeC: number;
  condition: string;
  precipitationProbability?: number;
  precipitationMm?: number;
  precipitationType?: string;
  windDirection?: string;
  windSpeedMps?: number;
  source: string;
};

export type WeatherErrorCategory =
  | "configuration"
  | "unauthorized"
  | "unavailable"
  | "invalid_data";

export class WeatherProviderError extends Error {
  constructor(
    public readonly category: WeatherErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "WeatherProviderError";
  }
}

const FIXTURE_WEATHER: Record<string, WeatherFact> = {
  "cn-beijing": {
    place: {
      id: "cn-beijing",
      name: "北京市",
      administrativeArea: "北京市",
      country: "中国",
      latitude: 39.9042,
      longitude: 116.4074,
      timeZone: "Asia/Shanghai",
    },
    dataTime: "2026-01-15T00:00:00.000Z",
    dataTimeSource: "provider",
    timeZone: "Asia/Shanghai",
    temperatureC: 18,
    feelsLikeC: 17,
    condition: "晴",
    precipitationProbability: 10,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "北风",
    windSpeedMps: 2.5,
    source: "deterministic-weather-fixture",
  },
  "us-springfield-il": {
    place: {
      id: "us-springfield-il",
      name: "Springfield",
      administrativeArea: "Illinois",
      country: "美国",
      latitude: 39.7817,
      longitude: -89.6501,
      timeZone: "America/Chicago",
    },
    dataTime: "2026-01-15T14:00:00.000Z",
    dataTimeSource: "provider",
    timeZone: "America/Chicago",
    temperatureC: 4,
    feelsLikeC: 1,
    condition: "多云",
    precipitationProbability: 20,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "西北风",
    windSpeedMps: 4.1,
    source: "deterministic-weather-fixture",
  },
  "us-springfield-ma": {
    place: {
      id: "us-springfield-ma",
      name: "Springfield",
      administrativeArea: "Massachusetts",
      country: "美国",
      latitude: 42.1015,
      longitude: -72.5898,
      timeZone: "America/New_York",
    },
    dataTime: "2026-01-15T14:00:00.000Z",
    dataTimeSource: "provider",
    timeZone: "America/New_York",
    temperatureC: 2,
    feelsLikeC: -1,
    condition: "小雨",
    precipitationProbability: 70,
    precipitationMm: 1.2,
    precipitationType: "rain",
    windDirection: "东风",
    windSpeedMps: 3.2,
    source: "deterministic-weather-fixture",
  },
};

const qWeatherResponseSchema = z
  .object({
    updateTime: z.string().optional(),
    metadata: z
      .object({ attributions: z.array(z.string()).optional() })
      .optional(),
    condition: z.object({ text: z.string() }),
    temperature: z.object({ value: z.number() }),
    feelsLike: z.object({ value: z.number() }),
    wind: z.object({
      direction: z.object({ compass: z.string() }),
      speed: z.object({ value: z.number() }),
    }),
    precipitation: z
      .object({
        amount: z.object({ value: z.number() }),
        type: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const qWeatherDailyResponseSchema = z
  .object({
    days: z.array(
      z.object({
        daytime: z
          .object({
            precipitation: z
              .object({ probability: z.number().min(0).max(1) })
              .optional(),
          })
          .optional(),
        nighttime: z
          .object({
            precipitation: z
              .object({ probability: z.number().min(0).max(1) })
              .optional(),
          })
          .optional(),
      }),
    ),
  })
  .passthrough();

function encodeBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function createQWeatherJwt(): string {
  const keyId = process.env.QWEATHER_KEY_ID;
  const developerId = process.env.QWEATHER_DEVELOPER_ID;
  const projectId = process.env.QWEATHER_PROJECT_ID;
  const privateKeyPem = process.env.QWEATHER_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!keyId || !developerId || !projectId || !privateKeyPem) {
    throw new WeatherProviderError(
      "configuration",
      "QWeather JWT configuration is incomplete",
    );
  }

  const now = Math.floor(Date.now() / 1_000);
  const header = encodeBase64Url(JSON.stringify({ alg: "EdDSA", kid: keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: developerId,
      sub: projectId,
      iat: now - 30,
      exp: now + 900,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    null,
    Buffer.from(signingInput),
    createPrivateKey(privateKeyPem),
  );

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

async function fetchQWeather(place: PlaceCandidate): Promise<WeatherFact> {
  const apiHost = process.env.QWEATHER_API_HOST?.replace(/\/$/u, "");
  if (!apiHost) {
    throw new WeatherProviderError("configuration", "QWeather API host is missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const url = `${apiHost}/weather/v1/current/${place.latitude}/${place.longitude}?localTime=true&lang=zh`;
    const authorization = `Bearer ${createQWeatherJwt()}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
      signal: controller.signal,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WeatherProviderError("invalid_data", "QWeather response is not JSON");
    }

    if (!response.ok) {
      throw new WeatherProviderError(
        response.status === 401 || response.status === 403
          ? "unauthorized"
          : "unavailable",
        `QWeather returned HTTP ${response.status}`,
      );
    }

    const parsed = qWeatherResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new WeatherProviderError("invalid_data", "QWeather response is incomplete");
    }

    let precipitationProbability: number | undefined;
    try {
      const dailyResponse = await fetch(
        `${apiHost}/weather/v1/daily/${place.latitude}/${place.longitude}?days=1&localTime=true&lang=zh`,
        {
          headers: {
            Accept: "application/json",
            Authorization: authorization,
          },
          signal: controller.signal,
        },
      );
      if (dailyResponse.ok) {
        const dailyPayload = await dailyResponse.json();
        const daily = qWeatherDailyResponseSchema.safeParse(dailyPayload);
        const firstDay = daily.success ? daily.data.days[0] : undefined;
        const probabilities = [
          firstDay?.daytime?.precipitation?.probability,
          firstDay?.nighttime?.precipitation?.probability,
        ].filter((value): value is number => value !== undefined);
        if (probabilities.length > 0) {
          precipitationProbability = Math.round(Math.max(...probabilities) * 100);
        }
      }
    } catch {
      precipitationProbability = undefined;
    }

    return {
      place,
      dataTime: parsed.data.updateTime ?? new Date().toISOString(),
      dataTimeSource: parsed.data.updateTime ? "provider" : "retrieved",
      timeZone: place.timeZone,
      temperatureC: parsed.data.temperature.value,
      feelsLikeC: parsed.data.feelsLike.value,
      condition: parsed.data.condition.text,
      precipitationProbability,
      precipitationMm: parsed.data.precipitation?.amount.value,
      precipitationType: parsed.data.precipitation?.type,
      windDirection: parsed.data.wind.direction.compass,
      windSpeedMps: parsed.data.wind.speed.value,
      source: parsed.data.metadata?.attributions?.[0] ?? "QWeather",
    };
  } catch (error) {
    if (error instanceof WeatherProviderError) {
      throw error;
    }

    throw new WeatherProviderError("unavailable", "QWeather request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCurrentWeather(place: PlaceCandidate): Promise<WeatherFact> {
  const dataSource =
    process.env.WEATHER_MCP_DATA_SOURCE ??
    (process.env.QWEATHER_API_HOST ? "qweather" : "fixture");

  if (dataSource === "fixture") {
    const fact = FIXTURE_WEATHER[place.id];
    if (!fact) {
      throw new WeatherProviderError(
        "invalid_data",
        "No deterministic weather fixture exists for this place",
      );
    }
    return { ...fact, place };
  }

  if (dataSource === "qweather") {
    return fetchQWeather(place);
  }

  throw new WeatherProviderError(
    "configuration",
    `Unsupported weather data source: ${dataSource}`,
  );
}
