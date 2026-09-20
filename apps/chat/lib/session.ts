export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const sessions = new Map<string, ChatMessage[]>();

export function getMessages(sessionId: string): ChatMessage[] {
  const existing = sessions.get(sessionId);
  if (existing) {
    return existing;
  }

  const messages: ChatMessage[] = [];
  sessions.set(sessionId, messages);
  return messages;
}

export function appendMessage(sessionId: string, message: ChatMessage): void {
  getMessages(sessionId).push(message);
}
