import { createDeterministicDeepSeekClient } from "../../../lib/assistant";
import { appendMessage, getMessages } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  sessionId?: unknown;
  message?: unknown;
};

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

const deepSeekClient = createDeterministicDeepSeekClient();

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
  const messages = getMessages(sessionId);
  appendMessage(sessionId, { role: "user", content: message });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        writeEvent(controller, encoder, "message.start", { sessionId });
        let reply = "";

        for await (const delta of deepSeekClient.stream(messages)) {
          reply += delta;
          writeEvent(controller, encoder, "text.delta", { delta });
        }

        writeEvent(controller, encoder, "message.complete", { message: reply });
        appendMessage(sessionId, { role: "assistant", content: reply });
        controller.close();
      } catch {
        writeEvent(controller, encoder, "error", { message: "生成回答失败" });
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
