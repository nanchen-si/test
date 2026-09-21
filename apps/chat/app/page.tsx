"use client";

import { FormEvent, useState } from "react";

import {
  formatPlace,
  isPlaceCandidate,
  type PlaceCandidate,
} from "../lib/place";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ServerEvent = {
  event: string;
  data: Record<string, string>;
};

function readServerEvent(block: string): ServerEvent | null {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);

  if (!event || !data) {
    return null;
  }

  return { event, data: JSON.parse(data) as Record<string, string> };
}

export default function ChatPage() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("等待输入");
  const [isSending, setIsSending] = useState(false);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [confirmedPlace, setConfirmedPlace] = useState<PlaceCandidate>();

  async function submitMessage(message: string, selectedPlace?: PlaceCandidate) {
    if (!message || isSending) {
      return;
    }

    setDraft("");
    setMessages((current) => [
      ...current,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ]);
    setStatus("正在处理");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message, selectedPlace }),
      });

      if (!response.ok || !response.body) {
        throw new Error("聊天请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let waitingForPlaceSelection = false;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const serverEvent = readServerEvent(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);

          if (serverEvent?.event === "message.start") {
            setStatus("正在生成回答");
          } else if (serverEvent?.event === "tool.start") {
            setStatus(
              serverEvent.data.name === "current_weather"
                ? "正在查询天气"
                : "正在解析地点",
            );
          } else if (serverEvent?.event === "tool.complete") {
            setStatus(
              serverEvent.data.name === "current_weather"
                ? "天气查询完成"
                : "地点解析完成",
            );
          } else if (serverEvent?.event === "text.delta") {
            setMessages((current) => {
              const next = [...current];
              const last = next.at(-1);
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + serverEvent.data.delta,
                };
              }
              return next;
            });
          } else if (serverEvent?.event === "place.candidates") {
            const parsed: unknown = JSON.parse(serverEvent.data.candidates);
            if (Array.isArray(parsed) && parsed.every(isPlaceCandidate)) {
              waitingForPlaceSelection = true;
              setCandidates(parsed);
              setStatus("请选择一个地点");
            }
          } else if (serverEvent?.event === "place.confirmed") {
            const parsed: unknown = JSON.parse(serverEvent.data.place);
            if (isPlaceCandidate(parsed)) {
              setConfirmedPlace(parsed);
              setCandidates([]);
            }
          } else if (serverEvent?.event === "message.complete") {
            setStatus(waitingForPlaceSelection ? "请选择一个地点" : "已完成");
          } else if (serverEvent?.event === "error") {
            throw new Error(serverEvent.data.message);
          }

          separator = buffer.indexOf("\n\n");
        }

        if (done) {
          break;
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : "抱歉，本轮对话暂时无法完成。";
      setMessages((current) => {
        const next = [...current];
        const last = next.at(-1);
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: errorMessage,
          };
        }
        return next;
      });
      setStatus("发生错误");
    } finally {
      setIsSending(false);
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft.trim());
  }

  return (
    <main className="page-shell">
      <section className="chat-card" aria-label="天气助手聊天">
        <header className="chat-header">
          <div>
            <p className="eyebrow">中文天气助手</p>
            <h1>天气助手</h1>
          </div>
          <span className="session-badge">本轮会话</span>
        </header>

        <ol className="message-list" aria-live="polite">
          {messages.map((message, index) => (
            <li className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <span className="message-role">
                {message.role === "user" ? "你" : "助手"}
              </span>
              <p>{message.content || (isSending ? "正在生成…" : "")}</p>
            </li>
          ))}
          {messages.length === 0 && (
            <li className="empty-state">你好，我可以和你进行中文对话。</li>
          )}
        </ol>

        {candidates.length > 0 && (
          <section className="place-candidates" aria-label="地点候选">
            <p>请选择一个地点</p>
            <div className="candidate-list">
              {candidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  onClick={() =>
                    void submitMessage(`确认地点：${formatPlace(candidate)}`, candidate)
                  }
                  disabled={isSending}
                >
                  {formatPlace(candidate)}
                </button>
              ))}
            </div>
          </section>
        )}

        {confirmedPlace && (
          <p className="confirmed-place">
            当前已确认地点：{formatPlace(confirmedPlace)}
          </p>
        )}

        <p className="status" role="status">
          {status}
        </p>

        <form className="composer" onSubmit={sendMessage}>
          <label htmlFor="message">消息</label>
          <textarea
            id="message"
            name="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入消息"
            rows={3}
            disabled={isSending}
          />
          <button type="submit" disabled={isSending || !draft.trim()}>
            {isSending ? "发送中…" : "发送"}
          </button>
        </form>
      </section>
    </main>
  );
}
