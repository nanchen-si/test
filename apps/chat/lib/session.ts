import type { PlaceCandidate } from "./place";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationSession = {
  messages: ChatMessage[];
  pendingPlaces: PlaceCandidate[];
  pendingWeatherRequest?: {
    type: "current" | "daily";
    days?: number;
    question: string;
  };
  confirmedPlace?: PlaceCandidate;
};

const sessions = new Map<string, ConversationSession>();

export function getSession(sessionId: string): ConversationSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    return existing;
  }

  const session: ConversationSession = { messages: [], pendingPlaces: [] };
  sessions.set(sessionId, session);
  return session;
}

export function appendMessage(sessionId: string, message: ChatMessage): void {
  getSession(sessionId).messages.push(message);
}
