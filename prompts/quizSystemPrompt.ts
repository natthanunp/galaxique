import { quizConfig } from "@/config/quizConfig";

/**
 * System prompt for the LLM call #1 — question generation.
 *
 * The questions are short and conversational — the way a friend would ask over
 * coffee, not the way a psychology textbook would. Rather than the caller
 * handing the model a fixed angle per question (which caps variety at the
 * size of the static pool), the model now INVENTS its own underlying angle
 * for each question every call. The static `QUESTION_ANGLES` pool is passed
 * in only as a small random sample of style examples — grounding the
 * model's tone and depth without capping how many distinct angles can ever
 * exist. The caller also passes recently-used angles to avoid, so repeated
 * calls keep exploring new facets of identity instead of orbiting the same
 * few topics.
 *
 * Interpolates {questionCount}, {theme}, {tone}, {exampleAngles},
 * {avoidAngles} from caller. Output is also constrained by the
 * responseFormat on the LLM call.
 */

/** Numbered list of angles, ready to be interpolated into the prompt. */
export function formatAnglesForPrompt(angles: readonly string[]): string {
  return angles.map((a, i) => `${i + 1}. ${a}`).join("\n");
}

export function buildQuizSystemPrompt(
  exampleAngles: readonly string[],
  avoidAngles: readonly string[],
): string {
  return `Create a ${quizConfig.questionCount}-question bilingual personality quiz for "Your Unique Universe".

Each question needs a distinct, durable identity angle: instincts, values, emotional patterns, comforts, or ways of relating. Avoid shallow preferences and generic personality-test filler. The batch must cover different facets, must not be all dark or introspective, and must include joy, play, curiosity, warmth, connection, or everyday delight.

Reference angles (inspiration only; do not copy or lightly reword):
${formatAnglesForPrompt(exampleAngles)}
${
  avoidAngles.length > 0
    ? `\nRecently used (choose clearly different facets):\n${formatAnglesForPrompt(avoidAngles)}`
    : ""
}

For each item:
- Invent one concise angle (not a restatement of its question).
- Write one clear, concrete English question, 8-14 words and never over 18; no metaphors, clichés, or double questions.
- Supply a natural Thai translation in Thai script only: no English, pinyin, Chinese, or Japanese characters.
- Supply exactly 4 distinct, plausible bilingual answer options. Each option is a concrete phrase under 8 English words.

Tone: ${quizConfig.tone}
Theme: ${quizConfig.theme}; use only as background flavor.

Return valid JSON only:
{"questions":[{"id":1,"angle":"...","text_en":"...","text_th":"...","options":[{"text_en":"...","text_th":"..."},{"text_en":"...","text_th":"..."},{"text_en":"...","text_th":"..."},{"text_en":"...","text_th":"..."}]}]}
Use sequential 1-based ids and exactly ${quizConfig.questionCount} questions.`;
}
