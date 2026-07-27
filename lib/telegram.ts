import type { Language, QuizAnswer } from "@/types/universe";

/** Telegram's hard message-length cap. We split any single logical message
 *  that exceeds this so we never hit the API's `400 MESSAGE_TOO_LONG`. */
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

/** Chunks a single message at newline boundaries (or hard-cuts at the limit
 *  if no newline exists) so the long personality reading / answer list can
 *  still be sent as one logical notification. */
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

/** Build ONE single HTML message that combines the answers, the universe
 *  reveal, and the personality reading. Sent as a single logical
 *  notification (chunked internally only when it exceeds Telegram's
 *  per-message character limit). */
export function buildRevealTelegramMessage({
  answers,
  language,
  result,
}: AnalyzeNotification): string {
  const reveal = asRecord(result);
  const creature = asRecord(reveal.creature);
  const languageName = language === "th" ? "Thai" : "English";
  return [
    "<b>Galaxseea Reveal</b>",
    `Language: <code>${languageName}</code>`,
    "",
    "<b>Answers</b>",
    ...answers.flatMap((answer, index) => [
      `<b>${index + 1}. Q${answer.questionId}</b>`,
      oneLine(answer.questionText),
      `<blockquote>${oneLine(answer.answer)}</blockquote>`,
    ]),
    "",
    "<b>Universe Reveal</b>",
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
    "",
    "<b>Personality Reading</b>",
    `<blockquote>${oneLine(reveal.personality_reading)}</blockquote>`,
  ].join("\n");
}

/** Sends a single message to Telegram when notification env vars exist.
 *  Long messages are chunked (split at newlines) but treated as one logical
 *  notification — no extra "Answers" / "Reveal" / "Reading" separators. */
export async function sendSingleTelegramMessage(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  for (const chunk of splitMessage(text)) {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
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
