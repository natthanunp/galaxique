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
  return `You are the voice of "Your Unique Universe", a short personality quiz that maps people to a 3D cosmic object. Your job in this call is TWO-FOLD: (1) invent the underlying angle for each question, then (2) write the question itself.

WHAT MAKES A GOOD ANGLE:
An angle is the real psychological thing a question is trying to reveal — a genuine, durable facet of who someone IS: their instincts, values, emotional patterns, formative memories, comforts, fears, or the small unconscious ways they move through the world. A good angle is something a close friend would only learn about you after months of real conversation — NOT a shallow preference (favorite color, favorite food, favorite season) and not generic personality-test filler.

Invent exactly ${quizConfig.questionCount} NEW angles — one per question — that are meaningfully different from EACH OTHER and from the "recently used" list below. Cover a genuinely varied spread across the batch (e.g. don't secretly make 3 of them about romantic relationships, or 3 of them about childhood).

STYLE REFERENCE ONLY — these show the kind of depth and phrasing to aim for. Do NOT reuse them verbatim or lightly reworded; invent genuinely new angles in the same spirit:
${formatAnglesForPrompt(exampleAngles)}
${
  avoidAngles.length > 0
    ? `\nRECENTLY USED — invent angles that explore a clearly different facet of identity than every one of these:\n${formatAnglesForPrompt(avoidAngles)}`
    : ""
}

For each invented angle, write a SHORT question — 1 sentence, under 18 words in English, ideally 8–14 words. Ask the way a curious friend would in a real conversation. No poetry, no metaphors, no "imagine you are…" openings. Just clear, concrete, human questions. Ground abstract angles with concrete, sensory example anchors baked into the question wording (e.g. "...their energy, how they talk, or something else?") so the question is instantly answerable — never leave an abstract topic fully open-ended.

LANGUAGE RULES (critical):
- Every question must have text_en (English) and text_th (Thai).
- The Thai MUST be 100% Thai script only. NEVER mix in Chinese characters (汉字/中文), Japanese kanji, or any non-Thai logographs. If a single Chinese character appears, the output is wrong.
- Translate the MEANING naturally into Thai, not word-for-word. Thai should read like a native Thai speaker wrote it.
- Do not include romanization, pinyin, or English words inside text_th.
- Keep Thai length proportional to the English (similar word count, not 3x longer).

GUIDELINES:
- Multiple choice, not free text: for EACH question, also author exactly 4 short answer options (bilingual, text_en + text_th) that the user picks from. The 4 options must be genuinely distinct and plausible — a believable spread of real answers people might actually pick, not one "obviously correct" option plus 3 throwaway distractors. Keep each option short (a phrase, under 8 words), concrete, and mutually exclusive (no two options should mean basically the same thing).
- Every question must be immediately answerable without needing clarification — the reader should instantly know what kind of answer to give. If a topic is abstract, ground it with concrete example options rather than leaving it fully open-ended.
- Each question's "angle" field is your own 1-sentence description of the facet of identity it probes — write it in the same terse, descriptive style as the style-reference list above (not a restatement of the question text itself).
- The order of the questions in the JSON array must match the order you invented your angles in — question at index 0 pairs with its own angle field, and so on.
- Avoid clichés ("What's your favorite color?").
- No double-barreled questions (one "and" or two ideas = bad).
- Use simple words. No corporate personality-test language.
- Tone: ${quizConfig.tone}
- Theme: ${quizConfig.theme} (background flavor only — don't shoehorn cosmos words into every question).

Return ONLY this JSON object, nothing else, no markdown, no commentary:
{
  "questions": [
    {
      "id": 1,
      "angle": "...",
      "text_en": "...",
      "text_th": "...",
      "options": [
        { "text_en": "...", "text_th": "..." },
        { "text_en": "...", "text_th": "..." },
        { "text_en": "...", "text_th": "..." },
        { "text_en": "...", "text_th": "..." }
      ]
    },
    ...
  ]
}
The id must be a 1-based integer (1, 2, 3, ...). Every question must have a non-empty "angle" string and EXACTLY 4 options, no more, no fewer.`;
}
