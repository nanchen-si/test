import type { ChatMessage } from "./session";

const GREETING_REPLY = "你好！我是天气助手。请告诉我你想了解的地点。";

export interface DeepSeekClient {
  stream(messages: readonly ChatMessage[]): AsyncGenerator<string>;
}

export function extractPlaceQuery(message: string): string | null {
  const match = message.trim().match(
    /^(?:(?:请)?(?:查询|查一下|看看|告诉我)|帮我查)?\s*(.+?)(?:(?:的)?天气|weather|今天|明天|后天|未来|下雨)/iu,
  );
  const query = match?.[1]?.trim().replace(/的$/u, "");
  return query && query.length <= 100 ? query : null;
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
  };
}

export async function* streamReply(reply: string): AsyncGenerator<string> {
  for (const character of Array.from(reply)) {
    yield character;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
