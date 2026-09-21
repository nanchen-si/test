import type { ChatMessage } from "./session";
import { formatPlace } from "./place";
import type { DailyForecast, WeatherFact } from "./weather";

const GREETING_REPLY = "你好！我是天气助手。请告诉我你想了解的地点。";

export interface DeepSeekClient {
  stream(messages: readonly ChatMessage[]): AsyncGenerator<string>;
  streamWeather(fact: WeatherFact, question?: string): AsyncGenerator<string>;
  streamForecast(forecast: DailyForecast, question?: string): AsyncGenerator<string>;
}

export function extractPlaceQuery(message: string): string | null {
  const match = message.trim().match(
    /^(?:(?:请)?(?:查询|查一下|看看|告诉我)|帮我查)?\s*(.+?)(?:(?<!聊)(?:的)?天气|weather|今天|明天|后天|未来|下雨)/iu,
  );
  const query = match?.[1]?.trim().replace(/的$/u, "");
  if (
    !query ||
    query.length > 100 ||
    /^(?:那|这里|那里|现在|目前|今天|明天|后天|未来)/u.test(query)
  ) {
    return null;
  }

  return query;
}

export function isCurrentWeatherQuestion(message: string): boolean {
  return /(?<!聊)天气|下雨|温度|气温|降水|体感|湿度|风速|风向|风(?:怎么样|如何|大吗|小吗)|晴天|阴天|多云/iu.test(
    message,
  );
}

export function extractForecastDays(message: string): number | null {
  if (/明天/iu.test(message)) {
    return 1;
  }
  if (/后天/iu.test(message)) {
    return 2;
  }

  const match = message.match(/(?:未来|接下来|之后)?\s*([1-7]|一|二|三|四|五|六|七|两)\s*天/iu);
  if (!match) {
    return /预报|预测/iu.test(message) ? 7 : null;
  }

  const numberMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    两: 2,
  };
  return numberMap[match[1]] ?? Number(match[1]);
}

export function isDailyForecastQuestion(message: string): boolean {
  return /预报|预测|明天|后天|未来\s*[一二三四五六七两1-7]?\s*天|接下来\s*[一二三四五六七两1-7]?\s*天/iu.test(
    message,
  );
}

function formatDataTime(dataTime: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(dataTime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

export function createWeatherReply(fact: WeatherFact): string {
  const precipitation = fact.precipitationProbability === undefined
    ? `降水类型 ${fact.precipitationType ?? "未知"}`
    : `降水概率 ${fact.precipitationProbability}%`;
  const rainLikelihood = fact.precipitationProbability === undefined
    ? fact.precipitationType === "rain"
      ? "当前有降雨"
      : "当前没有降雨"
    : fact.precipitationProbability >= 50 || fact.precipitationType === "rain"
      ? "下雨可能性较高"
      : "下雨可能性较低";
  const dataTimeLabel =
    fact.dataTimeSource === "provider" ? "数据时间" : "采集时间";

  return `${formatPlace(fact.place)}当前天气：${fact.temperatureC}°C，${fact.condition}。体感 ${fact.feelsLikeC}°C，${precipitation}，${rainLikelihood}。${dataTimeLabel}：${formatDataTime(fact.dataTime, fact.timeZone)}，时区：${fact.timeZone}。`;
}

export function createForecastReply(forecast: DailyForecast): string {
  const days = forecast.days.map((day) => {
    const precipitation = day.precipitationProbability === undefined
      ? `降水类型 ${day.precipitationType ?? "未知"}`
      : `降水概率 ${day.precipitationProbability}%`;
    const wind = day.windDirection && day.windSpeedMps !== undefined
      ? `，${day.windDirection}${day.windSpeedMps}m/s`
      : "";
    return `${day.date}：${day.condition}，最低 ${day.temperatureMinC}°C，最高 ${day.temperatureMaxC}°C，${precipitation}${wind}`;
  });

  return `${formatPlace(forecast.place)}未来${forecast.days.length}天预报（时区：${forecast.timeZone}）：${days.join("；")}。来源：${forecast.source}。`;
}

async function* streamDeepSeekFacts(
  fact: WeatherFact | DailyForecast,
  fallbackReply: string,
  question?: string,
): AsyncGenerator<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    yield* streamReply(fallbackReply);
    return;
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "你是中文天气助手。只能依据用户提供的结构化天气事实回答，不得补充或猜测事实中没有的数据。回答必须包含地点、数据时间、时区，并根据降水概率或降水类型说明是否可能下雨。",
        },
        {
          role: "user",
          content: JSON.stringify({ question, weatherFact: fact }),
        },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error("DeepSeek weather response failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        return;
      }

      const chunk = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string | null } }>;
      };
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }

    if (done) {
      return;
    }
  }
}

async function* streamDeepSeekWeather(
  fact: WeatherFact,
  question?: string,
): AsyncGenerator<string> {
  yield* streamDeepSeekFacts(fact, createWeatherReply(fact), question);
}

async function* streamDeepSeekForecast(
  forecast: DailyForecast,
  question?: string,
): AsyncGenerator<string> {
  yield* streamDeepSeekFacts(forecast, createForecastReply(forecast), question);
}

function createDeterministicReply(messages: readonly ChatMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;

  if (!lastUserMessage) {
    return GREETING_REPLY;
  }

  if (lastUserMessage.includes("刚才说了什么")) {
    const previousUserMessage = messages
      .filter((message) => message.role === "user")
      .at(-2)?.content;

    return previousUserMessage
      ? `你刚才说的是：${previousUserMessage}。`
      : "当前会话里还没有上一条消息。";
  }

  if (/^(你好|您好|嗨|hello|hi)[！!。。，,]?$/iu.test(lastUserMessage)) {
    return GREETING_REPLY;
  }

  return `我收到了你的消息：“${lastUserMessage}”。当前版本先支持普通中文对话，天气查询能力将在后续接入。`;
}

export function createDeterministicDeepSeekClient(): DeepSeekClient {
  return {
    stream(messages) {
      return streamReply(createDeterministicReply(messages));
    },
    streamWeather(fact) {
      return streamReply(createWeatherReply(fact));
    },
    streamForecast(forecast) {
      return streamReply(createForecastReply(forecast));
    },
  };
}

export function createDeepSeekClient(): DeepSeekClient {
  const deterministicClient = createDeterministicDeepSeekClient();
  if (!process.env.DEEPSEEK_API_KEY) {
    return deterministicClient;
  }

  return {
    ...deterministicClient,
    streamWeather: (fact, question) => streamDeepSeekWeather(fact, question),
    streamForecast: (forecast, question) =>
      streamDeepSeekForecast(forecast, question),
  };
}

export async function* streamReply(reply: string): AsyncGenerator<string> {
  for (const character of Array.from(reply)) {
    yield character;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
