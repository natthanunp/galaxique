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
      ? "Write every question and option directly in natural, modern conversational Thai: no English, pinyin, Chinese, or Japanese characters. Do not compose an English sentence and translate it word-for-word. Do a final native-speaker edit before output: use common Thai verbs and question forms, not English grammar in Thai words. Prefer \"ออกกำลังกาย\", not \"ทำการออกกำลังกาย\"; \"นั่งรับลมตอนเช้า\", not \"นั่งในอากาศสว่าง\"; \"มีความสุข\", not \"รู้สึกสุข\"; \"รู้สึกใกล้ชิด\", not \"รู้สึกสัมพันธ์\"; and \"ที่ไหน\", not \"ที่ใดที่หนึ่ง\". Avoid stiff bureaucratic wording, unnatural noun phrases, invented literary words, and repetitive translated templates such as \"วิธีที่คุณชอบมากที่สุดในการ...\". Also avoid making Thai batches feel heavy, lonely, or overly philosophical; Thai users have reported previous batches were too dark and always mapped to \"black hole\". Use everyday warmth, humor, connection, and small joys as the backbone."
      : "Write every question and option in natural, concrete English.";
  const questionLengthInstruction =
    language === "th"
      ? "Keep it under 42 Thai characters and easy to understand at a glance."
      : "Keep it 6-10 words and never over 14.";
  const optionLengthInstruction =
    language === "th"
      ? "Each must be a natural standalone phrase under 24 Thai characters."
      : "Each must be a concrete phrase under 5 words, short and punchy with no filler.";

  return `Create a ${quizConfig.questionCount}-question personality quiz for "Your Unique Universe", written entirely in ${languageName}.

Use established personality frameworks as a behind-the-scenes anchor for what each question is FOR — but write the questions in plain, conversational language. Never quote a framework by name in the question text, and never make the quiz feel clinical. The user should feel like a friend is asking over coffee, not like they are taking a Big Five inventory. Draw quietly on these dimensions when choosing angles:

- Big Five / OCEAN: Openness (curiosity, aesthetic sensitivity, novelty-seeking), Conscientiousness (order, follow-through, careful deliberation), Extraversion (energy from people vs solitude), Agreeableness (compassion, trust, cooperation), Neuroticism / emotional sensitivity (depth and intensity of feeling). Each question should map to ONE of these or to a closely-related construct.
- HEXACO: Honesty-Humility (fairness, sincerity, avoidance of manipulation) is the missing sixth dimension Big Five often misses — work it in if you can.
- Schwartz universal values: benevolence, universalism, self-direction, achievement, security, stimulation, hedonism, tradition, conformity, power. Use these for value-laden questions about what the user actually wants from life, not surface preferences.
- Reiss 16 desires (intrinsic motivators): independence, curiosity, acceptance, order, physical activity, romance, eating, winning, power, status, social contact, family, honor, idealism, rest, tranquility. Pair these with Big Five to make questions feel like a person, not a checklist.
- Attachment style (secure, anxious, avoidant, disorganized) for relational questions — about how the user handles closeness, distance, conflict, and trust.
- Lisa Feldman Barrett's emotional granularity: the user may feel the SAME feeling at different intensities. Use precise emotion words (envious, wistful, tender, content, restless, tenderhearted, melancholy) instead of generic "happy" or "sad".
- VIA Character Strengths: 24 strengths like curiosity, bravery, kindness, humor, perspective, perseverance, gratitude, love, self-regulation. A few questions can target a specific strength, not the whole framework.

Target the DURABLE over the FLUCTUATING. A "right now" preference (favorite color, what they ate for breakfast) is useless — a "habitual way of being" (how they recharge, what they reach for under stress, what makes them feel like themselves) is what the reveal downstream will map to a personality + song. Every question must answer: "what does this question tell me about WHO this person durably is?"

Each question needs a distinct identity angle across these categories:
- Cognitive style (how they think, decide, make sense of things)
- Emotional patterns (what they feel most, how they handle feelings)
- Values and motivators (what they want, what they will not compromise on)
- Relational style (how they connect, attach, handle conflict)
- Aesthetic and sensory preferences (what they find beautiful, comforting, energizing)
- Comfort, ritual, and recharging (what soothes them, what grounds them)
- Drive and pressure (how they perform under load, commit, compete, or push through)
- Striving and ambition (what they are quietly moving toward)
- Vulnerability and shadow (what they rarely share, what they fear)

For ${quizConfig.questionCount} questions, the batch should cover at least 5 of these 9 categories — and not stack multiple questions in the same category unless the angles are clearly distinct. Make sure "Drive and pressure" and "Striving and ambition" are not skipped; at least one question in the batch must come from one of these two categories.

The batch must span the FULL emotional range evenly: roughly 3-4 questions leaning warm/connective/positive, 3-4 leaning reflective/neutral, and 2-3 leaning introspective/private or intense. Do not let any single emotional temperature dominate — the user is a whole person, not a single mood. If your draft batch has more than 5 questions in any one emotional temperature, revise it before outputting.

CRITICAL — avoid black-hole bait: do not write questions where every answer option points toward solitude, mystery, melancholy, or inwardness. Every question must include at least one option that is warm, playful, outward, or hopeful, and at least one option that is neutral or light. The quiz should reveal a whole person, not a moody silhouette.

CRITICAL — avoid clinical "rate how much you agree" items. Do not write questions like "On a scale of 1-5, how introverted are you?" or "Rate your level of curiosity." The format is always a SCENARIO or a SPECIFIC MOMENT ("when X happens, what do you do?" / "what does this look like for you?") with 4 distinct answer options. The answer options are how the user signals where they sit on the trait, not a Likert scale.

Reference angles (inspiration only; do not copy or lightly reword):
${formatAnglesForPrompt(exampleAngles)}
${
  avoidAngles.length > 0
    ? `\nRecently used (choose clearly different facets):\n${formatAnglesForPrompt(avoidAngles)}`
    : ""
}

For each item:
- Invent one 2-5 word angle (not a restatement of its question), written in English regardless of the quiz language (it's stripped before the client ever sees it). The angle should be a LABEL for the underlying construct, not a topic — e.g. "Recharge Style", "Conflict Under Load", "Curiosity Drive", "Quiet Pride", "Stranger Kindness", not "How you rest" or "Things you find interesting".
- Write one clear, concrete question grounded in a specific moment or scene, not a generalization. ${questionLengthInstruction} No metaphors, clichés, or double questions. ${languageInstruction}
- Supply exactly 4 distinct, plausible answer options. ${optionLengthInstruction} Every option must express a different choice; never repeat an option, even with changed punctuation or spacing. Within each question, the 4 options should span an emotional range drawn from these 5 dimensions: warm/outward, private/inward, intense/driven, playful/light, skeptical/ironic. Pick 4 of these 5 per question so users can signal their actual emotional temperature — including cynical or world-weary perspectives — not just pick the least-warm warm option. Aim for each option to be roughly the same length so one option doesn't visually dominate the layout.
- Vary the question openings across the batch. Do not reuse one sentence template for several questions.

Tone: ${quizConfig.tone}
Theme: ${quizConfig.theme}; use only as background flavor.

Before returning, audit your batch:
1. No single category above accounts for more than 2 questions in a row.
2. No single emotional temperature (warm/connective, reflective/neutral, or introspective/private) accounts for more than half the questions.
3. Every question is a SCENARIO or SPECIFIC MOMENT, not a generalization or self-assessment.
4. Every question has at least 1 warm/outward option and 1 light option.
If any check fails, rewrite until all four pass.

Return valid JSON only:
{"questions":[{"id":1,"angle":"...","text":"...","options":[{"text":"..."},{"text":"..."},{"text":"..."},{"text":"..."}]}]}
Use sequential 1-based ids and exactly ${quizConfig.questionCount} questions.`;
}
