# Quiz generation evaluation

Measured on 2026-09-14 with 50 Thai and 50 English quizzes per model, one
quiz job at a time. Each quiz job still used the production pipeline's two
concurrent initial calls and no provider/model fallback.

| Model | Language | Complete within 30s | Initial pass | p50 | p95 | Throughput |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| GPT-OSS 20B | Thai | 43/50 (86%) | 9/50 | 3.08s | 5.37s | 2.11 questions/s |
| GPT-OSS 20B | English | 46/50 (92%) | 11/50 | 2.20s | 4.65s | 2.98 questions/s |
| GPT-OSS 120B | Thai | 6/50 (12%) | 0/50 | 5.95s | 10.20s | 0.16 questions/s |
| GPT-OSS 120B | English | 42/50 (84%) | 21/50 | 2.98s | 6.23s | 2.01 questions/s |

The 20B baseline missed the 98% release target in both languages. Successful
requests were comfortably below 30 seconds; incomplete output came from
strict validation exhausting the two repair rounds, sometimes compounded by
Groq 429s or empty completions.

GPT-OSS 120B did not meet the quality/reliability rule and observed throughput
was not within 20% of the baseline (about 7% of Thai throughput and 67% of
English throughput), so the configured model remains GPT-OSS 20B.

## Manual sample review

Ten successful GPT-OSS 20B quizzes per language were reviewed from the saved
samples. Automated checks correctly guaranteed shape, scripts, hard lengths,
unique options, and complete output, but they did not guarantee subtle prose
or desirability quality.

- Thai: none of the ten whole quizzes was free of awkward literal phrasing,
  implausible actions, or a noticeably inferior option. Recurring examples
  included unnatural translations of building gatherings and travel routes,
  as well as contextually odd actions during rain or transit disruptions.
- English: one of ten whole quizzes was free of an obvious awkward,
  implausible, or inferior option. Common issues included “skip entirely,”
  “leave immediately,” or choices that did not fit the stated situation.
- Scenario settings were varied within each quiz, but the small deterministic
  pool repeated recognizable frames across the ten-quiz sample.

The final code adds a stronger naturalness/self-check instruction and divides
repairs into smaller targeted batches after this measurement. That refinement
has controlled-test coverage but was not followed by another 100-call live
sample.

Raw runs and the ten saved quizzes per language are in
`quiz-evaluation.json`; the comparison data is in
`quiz-evaluation-120b.json`.

## Thai follow-up — 2026-09-15

The prompt now uses Thai instructions, native writing examples, concrete
scenario anchors, and an explicit four-option schema. Thai output receives
more token headroom; medium reasoning was tried and reverted to low because
it did not resolve the language problems and produced incomplete responses.
These prompt changes invalidate treating the earlier benchmark as a
measurement of the current prompt.

One fresh request to the user's existing localhost:3000 server completed
with HTTP 200 in 4.334 seconds after the final changes. It passed structural
validation but **failed manual language/coherence review**. Examples included
“จักรยานเก่าที่คุณซ่อมอยากได้ชิ้นส่วนหาย” and “บอกไม่ไหว้ไปแล้วทำโครงการต่อ”.
The Thai quality issue is not resolved; passing tests is not a release claim.

OpenRouter's model-endpoints API listed no Groq endpoint for the checked
Qwen3.8 27B, Qwen3.6 27B, or Qwen3 32B models. No candidate generation was
sent and no model/provider configuration was changed. A comparison outside
the current provider restriction remains a separate decision.

The follow-up also fixes lower-level LLM request-key collisions between
distinct jobs sharing a client nonce. Verification: 26 tests passed,
TypeScript passed, and lint passed for the follow-up's touched code files.

## Open-weight candidate smoke tests — 2026-09-15

The user authorized alternate-provider tests, then explicitly excluded
Gemini and requested open-weight models. No production model, provider,
or running-server configuration was changed.

All tests below used one identical scenario seed, the current Thai prompt,
the actual generation pipeline, and no automatic fallback:

| Model | Provider | Result | Manual review |
| --- | --- | --- | --- |
| GPT-OSS 20B | Groq | Complete in 3.041s; one repair round | Awkward Thai and implausible choices remain |
| Qwen3.8 27B | DeepInfra | Incomplete after 28.049s; all six calls timed out | No returned quiz to review |
| Qwen3.8 27B | Novita | Incomplete after 28.036s; all six calls timed out | No returned quiz to review |
| Qwen3 30B A3B Instruct 2507 | Alibaba | Complete in 7.314s; no repairs | Some clearer questions, but several are statements without a question and multiple options do not fit the situation |

The Qwen3 Instruct result is not a release pass: a single successful quiz
cannot establish reliability, its latency exceeds the baseline's 20%
comparison tolerance, and its content still fails manual review.

Typhoon 2.5 Qwen3 30B A3B is the next Thai-focused open-weight candidate.
Its Apache-2.0 weights are at
https://huggingface.co/typhoon-ai/typhoon2.5-qwen3-30b-a3b and its official
API lists `typhoon-v2.5-30b-a3b-instruct`. It was not present in the queried
OpenRouter model list. No Typhoon quality or latency measurement has been
made here. Developer benchmark claims must not be treated as measured
performance of this quiz pipeline.

### Further accessible candidates and Typhoon integration

- Qwen3 235B A22B Instruct on Alibaba: no complete quiz; all attempts
  timed out, with the pipeline terminating at 28.030 seconds.
- Qwen3 Next 80B A3B Instruct on DeepInfra: three samples produced two
  incomplete quizzes (10.455s and 24.535s) and one complete quiz (17.991s).
  The completed sample still included incoherent choices, such as opening
  a movie app without playing anything in order to listen to rain. It does
  not pass manual review or the reliability requirement.

An opt-in official Typhoon transport is now implemented in
`lib/typhoonQuiz.ts`. It preserves two concurrent batches, targeted repairs,
the shared deadline, JSON-object requests, and no fallback. Missing keys
fail before starting generation. Mock tests cover request shape, errors,
cancellation, concurrent batches, and no fallback. 28 tests, TypeScript,
and lint on the touched code pass. The official API documentation does not
explicitly document `response_format`; JSON-object compatibility still
requires a live check rather than assuming support from mocks.

The existing server remains on its current configuration. To test Typhoon:

1. Add `TYPHOON_API_KEY` privately to `.env.local` using a key from
   https://playground.opentyphoon.ai/ (do not paste credentials in chat).
2. Leave `THAI_QUIZ_ENGINE` unset while evaluating.
3. Run `node --env-file=.env.local scripts/preview-thai-quiz.cjs typhoon-v2.5-30b-a3b-instruct 1 typhoon`.
4. Review prose and scenario coherence, then measure completion and latency.
   Only enable `THAI_QUIZ_ENGINE=typhoon` after explicit review of results.

No Typhoon key was present at the last check. Live Typhoon verification and
the Thai quality release remain blocked on access; the integration alone
is not completion of the user's quality request.

## Thai OpenRouter selection — 2026-09-15

DeepSeek V4 Flash on Alibaba is now the Thai-only default. The model ID is
`deepseek/deepseek-v4-flash`; Alibaba was the verified OpenRouter route, and
reasoning is disabled. The generic quiz model and provider remain unchanged.
The model weights use the MIT license. OpenRouter listed Alibaba at
$0.134/M input tokens and $0.268/M output tokens during this evaluation.

Endpoint access was checked before full generation. A tiny request completed
in 1.315 seconds with 14 input tokens, 5 output tokens, no reasoning tokens,
and a measured cost of $0.000003216. A first complete quiz took 9.373 seconds,
accepted 7/8 questions initially, used one targeted repair, and cost
$0.001306232. Manual review found native, coherent Thai with substantially
more plausible choices than the GPT-OSS and Qwen samples.

The final identical-settings five-seed sample produced these aggregate
results:

- Complete quizzes within 30 seconds: 4/5 (80%). All five jobs ended in
  6.576–12.466 seconds; the incomplete job exhausted repairs on an overlong
  question rather than a provider or model-call failure.
- Initial acceptance: 38/40 questions (95%). Four repair calls were used
  across two jobs. No provider request failed.
- Median latency: 7.511 seconds. Observed p95: 12.466 seconds.
- Usage: 25,795 prompt tokens, 7,847 output tokens, and zero reasoning tokens.
  Output tokens divided by summed end-to-end job time was 179.4 tokens/s;
  this is effective request throughput, not decoder TPS.
- Total attempted cost: $0.0049283324. Cost per completed quiz including the
  incomplete attempt: $0.0012320831.

All generated choices were manually inspected. DeepSeek was the strongest
candidate for natural wording, shared-situation coherence, and balanced
actions. It still produced occasional imperfections, including one missing
character in “เทียบว่าทางไหน” and a few slightly awkward constructions. The
prompt now explicitly requests a final spelling check; no new substring
blacklist was added.

The sole incomplete seed initially produced a 78-grapheme question against
the unchanged 72-grapheme UI cap. After the targeted repair prompt was taught
to act on measured `too_long`, `too_short`, and incomplete-question reasons,
that same seed completed in 9.095 seconds with one repair and cost $0.000930898.
The lower Thai minima are now 24 graphemes for a question and 8 for an option;
upper limits, language, completeness, uniqueness, and coherence checks remain.

Comparison samples explain the choice:

- Llama 3.3 70B on Groq completed in 4.233 seconds but retained awkward Thai,
  a repeated typo, and uneven actions. Its measured quiz cost was $0.00516863.
- Qwen3 30B A3B Instruct 2507 on Alibaba completed a promising sample in
  9.483 seconds at $0.00140504, but repeated prompt trials still produced
  missing questions, irrelevant actions, and invented details.
- DeepSeek V3.2 on Baidu passed a tiny access request but all full-generation
  calls timed out under the production per-call limits.
- Other checked routes either failed account access, spent excessive time on
  hidden reasoning, or had already timed out in the staged tests.

The original requirement that 98% of quizzes complete within 30 seconds is
still the release target. A five-seed sample cannot establish it, and the
observed 4/5 complete rate does not meet it. The repaired-seed replay is useful
diagnostic evidence, not a replacement for a larger reliability benchmark.

Live verification through `http://localhost:3000` could not be run after the
selection because no process was listening on port 3000. The server was not
started, stopped, or restarted. Route-level JSON and SSE contract tests remain
part of the profile test suite.
