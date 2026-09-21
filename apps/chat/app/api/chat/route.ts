import {
  createDeepSeekClient,
  extractPlaceQuery,
  isCurrentWeatherQuestion,
  streamReply,
} from "../../../lib/assistant";
import {
  getCurrentWeather,
  resolvePlace,
} from "../../../lib/location-client";
import {
  formatPlace,
  isPlaceCandidate,
} from "../../../lib/place";
import { appendMessage, getSession } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  sessionId?: unknown;
  message?: unknown;
  selectedPlace?: unknown;
};

type EventWriter = (
  event: string,
  data: Record<string, string>,
) => void;

class WeatherQueryError extends Error {}

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
): Promise<string> {
  write("tool.start", { name: "current_weather" });
  let weather: Awaited<ReturnType<typeof getCurrentWeather>>;
  try {
    weather = await getCurrentWeather(place);
  } catch {
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

const deepSeekClient = createDeepSeekClient();

export async function POST(request: Request) {
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

  if (body.selectedPlace !== undefined) {
    const requestedPlace = body.selectedPlace;
    if (!isPlaceCandidate(requestedPlace)) {
      return Response.json({ error: "地点选择无效" }, { status: 400 });
    }

    const selectedPlace = session.pendingPlaces.find(
      (candidate) => candidate.id === requestedPlace.id,
    );
    if (!selectedPlace) {
      return Response.json({ error: "地点候选已失效" }, { status: 400 });
    }

    session.pendingPlaces = [];
    session.confirmedPlace = selectedPlace;
    appendMessage(sessionId, {
      role: "user",
      content: `确认地点：${formatPlace(selectedPlace)}`,
    });

    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      write("place.confirmed", {
        place: JSON.stringify(selectedPlace),
      });
      const reply = await streamCurrentWeather(write, selectedPlace, message);
      appendMessage(sessionId, { role: "assistant", content: reply });
      write("message.complete", { message: reply });
    });
  }

  appendMessage(sessionId, { role: "user", content: message });
  const placeQuery = extractPlaceQuery(message);

  if (placeQuery) {
    return createSseResponse(async (write) => {
      write("message.start", { sessionId });
      write("tool.start", { name: "resolve_place" });
      const candidates = await resolvePlace(placeQuery);
      session.pendingPlaces = candidates;
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
