import { appConfig } from "./config";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function completeWithOpenRouter(messages: ChatMessage[]): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.requestTimeoutMs);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appConfig.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": appConfig.appBaseUrl,
        "X-Title": "ia-agent-tester"
      },
      body: JSON.stringify({
        model: appConfig.openRouterModel,
        temperature: 0.2,
        messages
      }),
      signal: controller.signal
    })
    .finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }
  return content;
}
