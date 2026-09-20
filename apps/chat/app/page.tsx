"use client";

import { FormEvent, useState } from "react";

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

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();

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
        body: JSON.stringify({ sessionId, message }),
      });

      if (!response.ok || !response.body) {
        throw new Error("聊天请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const serverEvent = readServerEvent(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);

          if (serverEvent?.event === "message.start") {
            setStatus("正在生成回答");
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
          } else if (serverEvent?.event === "message.complete") {
            setStatus("已完成");
          } else if (serverEvent?.event === "error") {
            throw new Error(serverEvent.data.message);
          }

          separator = buffer.indexOf("\n\n");
        }

        if (done) {
          break;
        }
      }
    } catch {
      setMessages((current) => {
        const next = [...current];
        const last = next.at(-1);
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: "抱歉，本轮对话暂时无法完成。",
          };
        }
        return next;
      });
      setStatus("发生错误");
    } finally {
      setIsSending(false);
    }
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
