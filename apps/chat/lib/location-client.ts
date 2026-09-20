import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { PlaceCandidate } from "./place";
import { isPlaceCandidate } from "./place";

const weatherMcpUrl =
  process.env.WEATHER_MCP_URL ?? "http://127.0.0.1:3101/mcp";

export async function resolvePlace(query: string): Promise<PlaceCandidate[]> {
  const client = new Client({ name: "weather-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(weatherMcpUrl));

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "resolve_place",
      arguments: { query },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      throw new Error("地点解析返回为空");
    }

    const payload: unknown = JSON.parse(text);
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray((payload as { candidates?: unknown }).candidates)
    ) {
      throw new Error("地点解析返回格式无效");
    }

    const candidates = (payload as { candidates: unknown[] }).candidates;
    if (!candidates.every(isPlaceCandidate)) {
      throw new Error("地点候选格式无效");
    }

    return candidates;
  } finally {
    await client.close();
  }
}
