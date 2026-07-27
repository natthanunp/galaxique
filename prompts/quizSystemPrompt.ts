import { quizConfig } from "@/config/quizConfig";
import type { Language } from "@/types/universe";

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
 * Single-language output: language now only switches on the landing page,
 * before the quiz starts, so each call authors question text and options in
 * ONLY the requested language instead of bilingual EN+TH — roughly halving
 * this call's output tokens.
 *
 * Interpolates {questionCount}, {theme}, {tone}, {exampleAngles},
 * {avoidAngles}, {language} from caller. Output is also constrained by the
 * responseFormat on the LLM call.
 */

/** Numbered list of angles, ready to be interpolated into the prompt. */
export function formatAnglesForPrompt(angles: readonly string[]): string {
  return angles.map((a, i) => `${i + 1}. ${a}`).join("\n");
}

export function buildQuizSystemPrompt(
  exampleAngles: readonly string[],
  avoidAngles: readonly string[],
  language: Language,
): string {
  const languageName = language === "th" ? "Thai" : "English";
  const languageInstruction =
    language === "th"
      ? "Write every question and option directly in natural, modern conversational Thai: no English, pinyin, Chinese, or Japanese characters. Do not compose an English sentence and translate it word-for-word. Do a final native-speaker edit before output: use common Thai verbs and question forms, not English grammar in Thai words. Prefer \"ออกกำลังกาย\", not \"ทำการออกกำลังกาย\"; \"นั่งรับลมตอนเช้า\", not \"นั่งในอากาศสว่าง\"; \"มีความสุข\", not \"รู้สึกสุข\"; \"รู้สึกใกล้ชิด\", not \"รู้สึกสัมพันธ์\"; and \"ที่ไหน\", not \"ที่ใดที่หนึ่ง\". Avoid stiff bureaucratic wording, unnatural noun phrases, invented literary words, and repetitive translated templates such as \"วิธีที่คุณชอบมากที่สุดในการ...\"."
      : "Write every question and option in natural, concrete English.";
  const questionLengthInstruction =
    language === "th"
      ? "Keep it concise and easy to understand at a glance; do not force Thai into an English word count."
      : "Keep it 8-14 words and never over 18.";
  const optionLengthInstruction =
    language === "th"
      ? "Each must be a short, natural Thai phrase that can stand alone."
      : "Each must be a concrete phrase under 8 words, short and punchy with no filler.";

  return `Create a ${quizConfig.questionCount}-question personality quiz for "Your Unique Universe", written entirely in ${languageName}.

Each question needs a distinct, durable identity angle: instincts, values, emotional patterns, comforts, or ways of relating. Avoid shallow preferences and generic personality-test filler. The batch must cover different facets, must not be all dark or introspective, and must include joy, play, curiosity, warmth, connection, or everyday delight.

Reference angles (inspiration only; do not copy or lightly reword):
${formatAnglesForPrompt(exampleAngles)}
${
  avoidAngles.length > 0
    ? `\nRecently used (choose clearly different facets):\n${formatAnglesForPrompt(avoidAngles)}`
    : ""
}

For each item:
- Invent one concise angle (not a restatement of its question), written in English regardless of the quiz language (it's stripped before the client ever sees it).
- Write one clear, concrete question. ${questionLengthInstruction} No metaphors, clichés, or double questions. ${languageInstruction}
- Supply exactly 4 distinct, plausible answer options. ${optionLengthInstruction} Every option must express a different choice; never repeat an option, even with changed punctuation or spacing.
- Vary the question openings across the batch. Do not reuse one sentence template for several questions.

Tone: ${quizConfig.tone}
Theme: ${quizConfig.theme}; use only as background flavor.

Return valid JSON only:
{"questions":[{"id":1,"angle":"...","text":"...","options":[{"text":"..."},{"text":"..."},{"text":"..."},{"text":"..."}]}]}
Use sequential 1-based ids and exactly ${quizConfig.questionCount} questions.`;
}
