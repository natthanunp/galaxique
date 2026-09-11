import { NextResponse } from "next/server";
import { OpenRouter } from "@openrouter/sdk";

import {
  getConversationHistory,
  appendMessage,
} from "@/lib/creatureChatStore";
import { buildCreatureChatPrompt } from "@/prompts/creatureChatPrompt";
import { sanitizeLlmError } from "@/lib/llmError";
import type { Language, UniverseReveal } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  sessionId: string;
  message: string;
  reveal: UniverseReveal;
  language?: unknown;
}

function resolveLanguage(v: unknown): Language {
  return v === "en" || v === "th" ? v : "en";
}

const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const client = new OpenRouter({
  apiKey,
  httpReferer: "http://localhost:3000",
  appTitle: "Galaxique Creature Chat",
});

const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-oss-20b";
const CHAT_PROVIDERS = (process.env.OPENROUTER_PROVIDER_ORDER || "groq")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatBody;
    if (!body.sessionId || typeof body.sessionId !== "string")
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    if (!body.message || typeof body.message !== "string")
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    if (!body.reveal || typeof body.reveal !== "object")
      return NextResponse.json({ error: "Missing reveal" }, { status: 400 });
    if (!apiKey)
      return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });

    const language = resolveLanguage(body.language);
    const sessionId = body.sessionId.slice(0, 64);
    const userMessage = body.message.slice(0, 500);

    await appendMessage(sessionId, { role: "user", content: userMessage, timestamp: Date.now() });

    const history = await getConversationHistory(sessionId);
    const systemPrompt = buildCreatureChatPrompt(body.reveal, language);
    const creatureName = body.reveal.creature?.name ?? (language === "th" ? "เพื่อนคู่ใจ" : "Companion");

    const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];
    for (const msg of history.slice(-4)) {
      llmMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    const result = await client.chat.send({
      chatRequest: {
        model: CHAT_MODEL,
        messages: llmMessages,
        temperature: 0.85,
        // Budget includes internal reasoning; the prompt keeps replies to 1–2 sentences.
        maxTokens: 1024,
        reasoning: { effort: "low" },
        provider: { order: CHAT_PROVIDERS, allowFallbacks: true, zdr: false },
      },
    }, { timeoutMs: 15_000 });

    let creatureResponse: string | null = null;
    if (result && "choices" in result) {
      const content = (result as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
      if (content && typeof content === "string" && content.trim() !== "{}" && content.trim() !== "") {
        creatureResponse = content.trim();
      }
    }

    if (!creatureResponse) {
      const fallback = language === "th"
        ? "*ดาวตกขัดจังหวะ... ถามอีกทีนะ*"
        : "*a shooting star interrupted — ask again?*";
      return NextResponse.json({ success: true, response: fallback, creatureName });
    }

    const cleaned = creatureResponse.replace(/\*\*/g, "").trim();
    await appendMessage(sessionId, { role: "creature", content: cleaned, timestamp: Date.now() });

    return NextResponse.json({ success: true, response: cleaned, creatureName });
  } catch (error) {
    const safeError = sanitizeLlmError(error);
    console.error("[creature-chat] Error:", {
      name: safeError.name, kind: safeError.kind, status: safeError.statusCode, provider: safeError.provider,
    });
    return NextResponse.json(
      { success: false, response: null, error: "Failed" },
      { status: 500 },
    );
  }
}
