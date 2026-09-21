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

export type DailyForecastDay = {
  date: string;
  condition: string;
  temperatureMinC: number;
  temperatureMaxC: number;
  precipitationProbability?: number;
  precipitationMm?: number;
  precipitationType?: string;
  windDirection?: string;
  windSpeedMps?: number;
};

export type DailyForecast = {
  place: PlaceCandidate;
  timeZone: string;
  days: DailyForecastDay[];
  source: string;
};

export type WeatherErrorCategory =
  | "configuration"
  | "timeout"
  | "unauthorized"
  | "unavailable"
  | "invalid_data";

export type WeatherFailureMode = WeatherErrorCategory;

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
  "cn-shanghai": {
    place: {
      id: "cn-shanghai",
      name: "上海市",
      administrativeArea: "上海市",
      country: "中国",
      latitude: 31.2304,
      longitude: 121.4737,
      timeZone: "Asia/Shanghai",
    },
    dataTime: "2026-01-15T00:00:00.000Z",
    dataTimeSource: "provider",
    timeZone: "Asia/Shanghai",
    temperatureC: 15,
    feelsLikeC: 14,
    condition: "多云",
    precipitationProbability: 30,
    precipitationMm: 0.2,
    precipitationType: "rain",
    windDirection: "东风",
    windSpeedMps: 3.1,
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

const FIXTURE_FORECAST_DAYS: Omit<DailyForecastDay, "date">[] = [
  {
    condition: "多云",
    temperatureMinC: 8,
    temperatureMaxC: 16,
    precipitationProbability: 20,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "北风",
    windSpeedMps: 2.1,
  },
  {
    condition: "晴",
    temperatureMinC: 7,
    temperatureMaxC: 17,
    precipitationProbability: 10,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "东北风",
    windSpeedMps: 1.8,
  },
  {
    condition: "小雨",
    temperatureMinC: 6,
    temperatureMaxC: 12,
    precipitationProbability: 70,
    precipitationMm: 2.4,
    precipitationType: "rain",
    windDirection: "东风",
    windSpeedMps: 3.4,
  },
  {
    condition: "阴",
    temperatureMinC: 5,
    temperatureMaxC: 11,
    precipitationProbability: 40,
    precipitationMm: 0.5,
    precipitationType: "rain",
    windDirection: "东南风",
    windSpeedMps: 2.9,
  },
  {
    condition: "晴",
    temperatureMinC: 4,
    temperatureMaxC: 13,
    precipitationProbability: 5,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "南风",
    windSpeedMps: 2.2,
  },
  {
    condition: "多云",
    temperatureMinC: 6,
    temperatureMaxC: 15,
    precipitationProbability: 25,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "西南风",
    windSpeedMps: 2.7,
  },
  {
    condition: "晴",
    temperatureMinC: 7,
    temperatureMaxC: 16,
    precipitationProbability: 10,
    precipitationMm: 0,
    precipitationType: "none",
    windDirection: "西风",
    windSpeedMps: 2.4,
  },
];

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
    metadata: z
      .object({ attributions: z.array(z.string()).optional() })
      .optional(),
    days: z.array(
      z.object({
        forecastStartTime: z.string(),
        temperatureMin: z.object({ value: z.number() }),
        temperatureMax: z.object({ value: z.number() }),
        daytime: z
          .object({
            condition: z.object({ text: z.string() }),
            wind: z.object({
              direction: z.object({ compass: z.string() }),
              speed: z.object({ value: z.number() }),
            }),
            precipitation: z
              .object({
                amount: z.object({ value: z.number() }).optional(),
                probability: z.number().min(0).max(1).optional(),
                type: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
        nighttime: z
          .object({
            condition: z.object({ text: z.string() }),
            wind: z.object({
              direction: z.object({ compass: z.string() }),
              speed: z.object({ value: z.number() }),
            }),
            precipitation: z
              .object({
                amount: z.object({ value: z.number() }).optional(),
                probability: z.number().min(0).max(1).optional(),
                type: z.string().optional(),
              })
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
      if (!dailyResponse.ok) {
        throw new WeatherProviderError(
          dailyResponse.status === 401 || dailyResponse.status === 403
            ? "unauthorized"
            : "unavailable",
          `QWeather returned HTTP ${dailyResponse.status}`,
        );
      }
      let dailyPayload: unknown;
      try {
        dailyPayload = await dailyResponse.json();
      } catch {
        throw new WeatherProviderError("invalid_data", "QWeather response is not JSON");
      }
      const daily = qWeatherDailyResponseSchema.safeParse(dailyPayload);
      const firstDay = daily.success ? daily.data.days[0] : undefined;
      if (!daily.success || !firstDay) {
        throw new WeatherProviderError("invalid_data", "QWeather forecast is incomplete");
      }
      const probabilities = [
        firstDay.daytime?.precipitation?.probability,
        firstDay.nighttime?.precipitation?.probability,
      ].filter((value): value is number => value !== undefined);
      if (probabilities.length > 0) {
        precipitationProbability = Math.round(Math.max(...probabilities) * 100);
      }
    } catch (error) {
      if (error instanceof WeatherProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new WeatherProviderError("timeout", "QWeather request timed out");
      }
      throw new WeatherProviderError("unavailable", "QWeather request failed");
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

    if (error instanceof Error && error.name === "AbortError") {
      throw new WeatherProviderError("timeout", "QWeather request timed out");
    }

    throw new WeatherProviderError("unavailable", "QWeather request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function formatLocalDate(dateTime: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateTime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getFutureLocalDate(timeZone: string, daysAhead: number): string {
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
  return formatLocalDate(date.toISOString(), timeZone);
}

function addCalendarDays(dateText: string, daysAhead: number): string {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

function getDaysBetween(startDate: string, targetDate: string): number {
  const start = new Date(`${startDate}T12:00:00Z`).valueOf();
  const target = new Date(`${targetDate}T12:00:00Z`).valueOf();
  if (Number.isNaN(start) || Number.isNaN(target)) {
    return Number.NaN;
  }
  return Math.round((target - start) / 86_400_000);
}

async function fetchQWeatherDaily(
  place: PlaceCandidate,
  days: number,
  startDaysAhead: number,
  targetDate?: string,
): Promise<DailyForecast> {
  const apiHost = process.env.QWEATHER_API_HOST?.replace(/\/$/u, "");
  if (!apiHost) {
    throw new WeatherProviderError("configuration", "QWeather API host is missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const requestedDays = Math.min(Math.max(Math.trunc(days), 1), 7);
  const requestedStartDaysAhead = targetDate
    ? getDaysBetween(formatLocalDate(new Date().toISOString(), place.timeZone), targetDate)
    : Math.min(Math.max(Math.trunc(startDaysAhead), 0), 7);
  if (
    !Number.isInteger(requestedStartDaysAhead) ||
    requestedStartDaysAhead < 0 ||
    requestedStartDaysAhead > 7
  ) {
    throw new WeatherProviderError("invalid_data", "目标日期不在每日预报范围内");
  }
  const providerDays = requestedDays + requestedStartDaysAhead;

  try {
    const response = await fetch(
      `${apiHost}/weather/v1/daily/${place.latitude}/${place.longitude}?days=${providerDays}&localTime=true&lang=zh`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${createQWeatherJwt()}`,
        },
        signal: controller.signal,
      },
    );

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

    const parsed = qWeatherDailyResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.days.length < providerDays) {
      throw new WeatherProviderError("invalid_data", "QWeather forecast is incomplete");
    }

    const forecastDays = parsed.data.days
      .slice(requestedStartDaysAhead, providerDays)
      .map((day) => {
        const daytime = day.daytime;
        const nighttime = day.nighttime;
        if (!daytime && !nighttime) {
          throw new WeatherProviderError(
            "invalid_data",
            "QWeather forecast day is incomplete",
          );
        }
        const selectedPeriod = daytime ?? nighttime;
        if (!selectedPeriod) {
          throw new WeatherProviderError(
            "invalid_data",
            "QWeather forecast day is incomplete",
          );
        }
        const periods = [daytime, nighttime].filter(
          (period): period is NonNullable<typeof daytime> => period !== undefined,
        );
        const probabilities = periods
          .map((period) => period.precipitation?.probability)
          .filter((value): value is number => value !== undefined);
        const amounts = periods
          .map((period) => period.precipitation?.amount?.value)
          .filter((value): value is number => value !== undefined);
        return {
          date: formatLocalDate(day.forecastStartTime, place.timeZone),
          condition: selectedPeriod.condition.text,
          temperatureMinC: day.temperatureMin.value,
          temperatureMaxC: day.temperatureMax.value,
          precipitationProbability:
            probabilities.length > 0
              ? Math.round(Math.max(...probabilities) * 100)
              : undefined,
          precipitationMm: amounts.length > 0 ? Math.max(...amounts) : undefined,
          precipitationType:
            daytime?.precipitation?.type ?? nighttime?.precipitation?.type,
          windDirection: selectedPeriod.wind.direction.compass,
          windSpeedMps: selectedPeriod.wind.speed.value,
        } satisfies DailyForecastDay;
      });

    return {
      place,
      timeZone: place.timeZone,
      days: forecastDays,
      source: parsed.data.metadata?.attributions?.[0] ?? "QWeather",
    };
  } catch (error) {
    if (error instanceof WeatherProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new WeatherProviderError("timeout", "QWeather forecast timed out");
    }

    throw new WeatherProviderError("unavailable", "QWeather forecast request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function getFixtureDailyForecast(
  place: PlaceCandidate,
  days: number,
  startDaysAhead: number,
  targetDate?: string,
): DailyForecast {
  const requestedStartDaysAhead = targetDate
    ? getDaysBetween(
        formatLocalDate(new Date().toISOString(), place.timeZone),
        targetDate,
      )
    : startDaysAhead;
  if (
    !Number.isInteger(requestedStartDaysAhead) ||
    requestedStartDaysAhead < 0 ||
    requestedStartDaysAhead > 7
  ) {
    throw new WeatherProviderError("invalid_data", "目标日期不在每日预报范围内");
  }
  const fixtureDays = place.id === "cn-shanghai"
    ? FIXTURE_FORECAST_DAYS.map((day, index) =>
        index === 0
          ? {
              ...day,
              condition: "晴",
              temperatureMinC: 10,
              temperatureMaxC: 18,
              precipitationProbability: 5,
            }
          : day,
      )
    : FIXTURE_FORECAST_DAYS;

  return {
    place,
    timeZone: place.timeZone,
    days: fixtureDays.slice(0, days).map((day, index) => ({
      ...day,
      date: targetDate
        ? addCalendarDays(targetDate, index)
        : getFutureLocalDate(place.timeZone, index + requestedStartDaysAhead),
    })),
    source: "deterministic-weather-fixture",
  };
}

export async function getCurrentWeather(
  place: PlaceCandidate,
  failureMode?: WeatherFailureMode,
): Promise<WeatherFact> {
  if (failureMode) {
    throw new WeatherProviderError(failureMode, "deterministic provider failure");
  }

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

export async function getDailyForecast(
  place: PlaceCandidate,
  days = 7,
  startDaysAhead = 1,
  targetDate?: string,
  failureMode?: WeatherFailureMode,
): Promise<DailyForecast> {
  if (failureMode) {
    throw new WeatherProviderError(failureMode, "deterministic provider failure");
  }

  const requestedDays = Math.min(Math.max(Math.trunc(days), 1), 7);
  const requestedStartDaysAhead = Math.min(
    Math.max(Math.trunc(startDaysAhead), 0),
    7,
  );
  const dataSource =
    process.env.WEATHER_MCP_DATA_SOURCE ??
    (process.env.QWEATHER_API_HOST ? "qweather" : "fixture");

  if (dataSource === "fixture") {
    return getFixtureDailyForecast(
      place,
      requestedDays,
      requestedStartDaysAhead,
      targetDate,
    );
  }

  if (dataSource === "qweather") {
    return fetchQWeatherDaily(
      place,
      requestedDays,
      requestedStartDaysAhead,
      targetDate,
    );
  }

  throw new WeatherProviderError(
    "configuration",
    `Unsupported weather data source: ${dataSource}`,
  );
}
