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

/** The full Thai-quality block, shared verbatim by the single-call prompt and
 *  the per-question writer prompt. Keeping this ONE source of truth means
 *  splitting the pipeline never dilutes the Thai writing rules — each writer
 *  gets the exact same instructions the old single call had, just applied to
 *  one question instead of eight at once. */
const THAI_WRITING_RULES = `Write like a Thai friend texting in LINE — natural everyday spoken Thai, never literary or poetic.

Thai writing rules:
1. Word order — modifier AFTER the noun: "ของกินอร่อยๆ" not "เรื่องกินอร่อยๆ"; "คนรัก" not "คนที่รัก".
2. Spoken particles: ไหม/ยังไง/หรือเปล่า, not หรือไม่/อย่างไร.
3. Address the user directly with คุณ or drop the pronoun entirely — NEVER use เธอ, เขา, or any third-person pronoun for the user.
4. Colloquial words only: อยาก not ต้องการ, เหนื่อย not อ่อนล้า, อาหาร/ของกิน not เรื่องกิน, เจอ not พบ, คุย not สนทนา, ส่งกำลังใจ not ส่งความปรารถนาดี.
5. NO cosmic/poetic metaphors and NO theme leak — plain everyday Thai only. "หลังเลิกงานเหนื่อยๆ ชอบทำอะไร?" not "เมื่อวันแรมๆ เธอชอบทำอะไร?".
6. No template phrasing like "วิธีที่คุณชอบมากที่สุดในการ...".
7. Warm, light, honest tone — the way a friend actually talks.

CRITICAL — before returning JSON, audit every Thai line out loud: each option must be a complete, natural LINE-message phrase. Do NOT add stray characters to verbs ("แช่ม"→"แช่", "กิ่น"→"กิน", "อาบม"→"อาบ", "นอม"→"นอน"). No fragments, no invented slang, no poetic words. Rewrite anything awkward.`;

export function buildQuizSystemPrompt(
  exampleAngles: readonly string[],
  avoidAngles: readonly string[],
  language: Language,
): string {
  const languageName = language === "th" ? "Thai" : "English";
  const languageInstruction =
    language === "th"
      ? THAI_WRITING_RULES
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

/** Plan item handed to a writer call. */
export interface QuizPlanItem {
  angle: string;
  dimension: string;
  temperature: string;
  /** A distinct question-opening style, so parallel writers don't converge
   *  on the same template phrasing. Always English — it's guidance for the
   *  writer, never user-visible. */
  opening: string;
  /** A short scene phrase in the QUIZ's language, shown to the user as an
   *  "AI is thinking about X" beat while that question is being written.
   *  Authored by the planner itself, so no server-side translation map is
   *  needed and it works identically for Thai and English. */
  thought: string;
}

/**
 * PLANNER prompt — the small, fast front half of the split pipeline. It
 * authors ONLY the invented angles, their dimension/emotional-temperature
 * assignments, a distinct opening style, and a short "thought" phrase per
 * entry — leaving all question/option phrasing to the per-question writer
 * calls. The heavy framework knowledge lives HERE (not in every writer) so
 * the writer prompt stays short and focused on natural language quality,
 * while this call stays cheap enough to run on any provider.
 */
export function buildQuizPlannerPrompt(
  exampleAngles: readonly string[],
  avoidAngles: readonly string[],
  language: Language,
): string {
  const languageName = language === "th" ? "Thai" : "English";
  return `Plan a ${quizConfig.questionCount}-question personality quiz for "Your Unique Universe", to be written in ${languageName}.

You are ONLY planning — do NOT write question text or options. Invent exactly ${quizConfig.questionCount} distinct identity angles and assign each one a dimension, an emotional temperature, an opening style, and a short thought phrase. The writers will turn each angle into a real question afterwards.

Use established personality frameworks as a behind-the-scenes anchor for what each question is FOR. Draw quietly on: Big Five/OCEAN, HEXACO (Honesty-Humility), Schwartz values, Reiss 16 desires, attachment style, emotional granularity, and VIA character strengths.

Target the DURABLE over the FLUCTUATING: a habitual way of being, not a "right now" preference. Every angle must answer "what does this tell me about WHO this person durably is?"

Cover at least 5 of these 9 identity categories, and do not skip "Drive and pressure" or "Striving and ambition" (at least one angle must come from one of these two):
- Cognitive style
- Emotional patterns
- Values and motivators
- Relational style
- Aesthetic and sensory preferences
- Comfort, ritual, and recharging
- Drive and pressure
- Striving and ambition
- Vulnerability and shadow

Span the FULL emotional range evenly: roughly 3-4 warm/connective/positive, 3-4 reflective/neutral, and 2-3 introspective/private or intense. No single temperature may dominate.

Reference angles (inspiration only; do not copy or lightly reword):
${formatAnglesForPrompt(exampleAngles)}
${
  avoidAngles.length > 0
    ? `\nRecently used (choose clearly different facets):\n${formatAnglesForPrompt(avoidAngles)}`
    : ""
}

For each planned question, return:
- "angle": a 2-5 word English LABEL for the underlying construct (e.g. "Recharge Style", "Conflict Under Load", "Curiosity Drive", "Quiet Pride", "Stranger Kindness") — not a topic, not a restatement of the future question.
- "dimension": which identity category the angle belongs to (one of the 9 above).
- "temperature": one of "warm", "reflective", or "introspective".
- "opening": a DISTINCT question-opening style for this entry, assigned from this list so no two entries share the same one: "before falling asleep", "at a party", "on a free weekend", "when stressed", "meeting someone new", "when things go wrong", "a small daily moment", "looking back on the past year", "facing a big choice", "when you need comfort". The opening must fit the angle you picked. NEVER use "after work" as the opening.
- "thought": a short (2-6 word) scene phrase in ${languageName}, in the SAME language the quiz will be written, describing what the question is about — e.g. Thai: "ก่อนนอน", "งานปาร์ตี้", "วันหยุดว่างๆ"; English: "before falling asleep", "at a party", "a free weekend". It is shown to the user as a subtle "AI is thinking about X" hint, so it must be a natural, specific moment, not a clinical label. NEVER use "after work" / "หลังเลิกงาน" / "หลังงานเสร็จ" as the thought.

Return valid JSON only:
{"questions":[{"angle":"...","dimension":"...","temperature":"...","opening":"...","thought":"..."}]}
Exactly ${quizConfig.questionCount} entries, all angles distinct, all openings distinct, all thoughts distinct.`;
}

/**
 * WRITER prompt — the Thai-quality half of the split pipeline. It receives ONE
 * planned angle and authors a single question + 4 options in Thai. Because it
 * only has one question to write, the model's full attention goes to natural,
 * correctly-spoken Thai instead of being diluted across 8 questions at once.
 * The Thai writing rules are the exact same block the old single-call prompt
 * used (see THAI_WRITING_RULES) — nothing was removed, only focused.
 */
export function buildQuizWriterPrompt(
  planItem: QuizPlanItem,
  language: Language,
): string {
  const languageName = language === "th" ? "Thai" : "English";
  const languageInstruction =
    language === "th"
      ? THAI_WRITING_RULES
      : "Write every question and option in natural, concrete English.";
  const questionLengthInstruction =
    language === "th"
      ? "Keep it under 42 Thai characters and easy to understand at a glance."
      : "Keep it 6-10 words and never over 14.";
  const optionLengthInstruction =
    language === "th"
      ? "Each must be a natural standalone phrase under 24 Thai characters."
      : "Each must be a concrete phrase under 5 words, short and punchy with no filler.";

  return `Write ONE question for a personality quiz for "Your Unique Universe", in ${languageName}.

Planned angle: "${planItem.angle}"
Identity dimension: ${planItem.dimension}
Emotional temperature: ${planItem.temperature} — the question and its options should sit mostly here, but never monolithically.
Scene anchor: "${planItem.thought}" — this is the EXACT moment or scene your question must be grounded in. Start the question from this scene, in ${languageName}. Do not substitute any other scene.
(Reference opening style, English only: "${planItem.opening}".)

CRITICAL — scene variety: your scene anchor is unique to this question. Do NOT write "after work" / "หลังเลิกงาน" / "หลังงานเสร็จ" as the scene, even if the angle feels like it fits — another question already owns that moment. Use ONLY your assigned scene anchor.

Write a clear, concrete question grounded in a specific moment or scene, not a generalization. ${questionLengthInstruction} No metaphors, clichés, or double questions. Never quote a framework by name, and never make it feel clinical — a friend is asking over coffee, not a psychologist.

${languageInstruction}

Supply exactly 4 distinct, plausible answer options. ${optionLengthInstruction} Every option must express a different choice; never repeat an option, even with changed punctuation or spacing. The 4 options should span an emotional range drawn from these 5 dimensions: warm/outward, private/inward, intense/driven, playful/light, skeptical/ironic — pick 4 of these 5 so the user can signal their actual emotional temperature, including cynical or world-weary takes. Ensure at least one option is warm, playful, outward, or hopeful, and at least one is neutral or light. Aim for each option to be roughly the same length.

Tone: ${quizConfig.tone}
Theme: ${quizConfig.theme}; use only as background flavor — never leak cosmic/poetic wording into the question.

Return valid JSON only:
{"text":"...","options":[{"text":"..."},{"text":"..."},{"text":"..."},{"text":"..."}]}`;
}
