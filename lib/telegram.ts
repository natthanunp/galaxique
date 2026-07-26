import type { Language, QuizAnswer } from "@/types/universe";

const TELEGRAM_MESSAGE_LIMIT = 3900;

interface AnalyzeNotification {
  answers: QuizAnswer[];
  language: Language;
  result: unknown;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function oneLine(value: unknown): string {
  return escapeHtml(value).replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function splitMessage(message: string): string[] {
  const chunks: string[] = [];
  let remaining = message;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    const splitAt = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    const boundary = splitAt > 0 ? splitAt : TELEGRAM_MESSAGE_LIMIT;
    chunks.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/** Sends a completed analysis to Telegram when notification env vars exist. */
export async function sendAnalyzeResultToTelegram({
  answers,
  language,
  result,
}: AnalyzeNotification): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const reveal = asRecord(result);
  const creature = asRecord(reveal.creature);
  const languageName = language === "th" ? "Thai" : "English";
  const messages = [
    [
      "<b>Galaxseea Analysis</b>",
      `Language: <code>${languageName}</code>`,
      "",
      "<b>Answers</b>",
      ...answers.flatMap((answer, index) => [
        `<b>${index + 1}. Q${answer.questionId}</b>`,
        oneLine(answer.questionText),
        `<blockquote>${oneLine(answer.answer)}</blockquote>`,
      ]),
    ].join("\n"),
    [
      "<b>Universe Reveal</b>",
      "",
      `<b>Vibe</b>  <code>${oneLine(reveal.vibe)}</code>`,
      `<b>Celestial type</b>  <code>${oneLine(reveal.celestial_type)}</code>`,
      `<b>Central symbol</b>  <code>${oneLine(reveal.central_symbol)}</code>`,
      `<b>Primary color</b>  <code>${oneLine(reveal.primary_color)}</code>`,
      `<b>Secondary color</b>  <code>${oneLine(reveal.secondary_color)}</code>`,
      `<b>Rotation speed</b>  <code>${oneLine(reveal.rotation_speed)}</code>`,
      `<b>Particle density</b>  <code>${oneLine(reveal.particle_density)}</code>`,
      `<b>Spotify search</b>  <code>${oneLine(reveal.spotify_search_query)}</code>`,
      "",
      "<b>Creature</b>",
      `<b>Kind</b>  <code>${oneLine(creature.kind)}</code>`,
      `<b>Accent</b>  <code>${oneLine(creature.accent)}</code>`,
      `<b>Motion</b>  <code>${oneLine(creature.motion)}</code>`,
      `<b>Name</b>  <code>${oneLine(creature.name)}</code>`,
    ].join("\n"),
    [
      "<b>Personality Reading</b>",
      "",
      `<b>EN</b>`,
      `<blockquote>${oneLine(reveal.personality_reading_en)}</blockquote>`,
      `<b>TH</b>`,
      `<blockquote>${oneLine(reveal.personality_reading_th)}</blockquote>`,
    ].join("\n"),
  ];

  for (const message of messages) {
    for (const text of splitMessage(message)) {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
          }),
          signal: AbortSignal.timeout(5000),
        },
      );

      if (!response.ok) {
        throw new Error(`Telegram API returned ${response.status}.`);
      }
    }
  }
}