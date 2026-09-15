import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.QUIZ_EVAL_BASE_URL ?? "http://localhost:3000";
const perLanguage = Number.parseInt(process.env.QUIZ_EVAL_PER_LANGUAGE ?? "5", 10);
const concurrency = Math.max(1, Number.parseInt(process.env.QUIZ_EVAL_CONCURRENCY ?? "1", 10));
const outputPath = resolve(process.env.QUIZ_EVAL_OUTPUT ?? "docs/quiz-evaluation.json");
const languages = (process.env.QUIZ_EVAL_LANGUAGES ?? "th")
  .split(",")
  .map((language) => language.trim())
  .filter((language) => language === "th" || language === "en");
if (languages.length === 0) throw new Error("QUIZ_EVAL_LANGUAGES must contain th or en.");
const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

function validateQuiz(payload, language) {
  const errors = [];
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.questions)) {
    return ["missing_questions"];
  }
  if (payload.questions.length !== 8) errors.push("question_count");
  const ids = payload.questions.map((question) => question?.id);
  if (JSON.stringify(ids) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) errors.push("ids");
  for (const question of payload.questions) {
    if (!question || typeof question !== "object") {
      errors.push("question_shape");
      continue;
    }
    if (Object.keys(question).sort().join(",") !== "id,options,text") errors.push("public_metadata_leak");
    if (!Array.isArray(question.options) || question.options.length !== 4) {
      errors.push("option_count");
      continue;
    }
    const texts = [question.text, ...question.options.map((option) => option?.text)];
    if (texts.some((text) => typeof text !== "string")) {
      errors.push("visible_text_shape");
      continue;
    }
    const normalizedOptions = question.options.map((option) =>
      option.text.normalize("NFC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, ""));
    if (new Set(normalizedOptions).size !== 4) errors.push("duplicate_options");
    if (language === "th") {
      if (texts.some((text) => !/\p{Script=Thai}/u.test(text) || /[\p{Script=Latin}\p{Script=Han}]/u.test(text))) errors.push("thai_script");
      if ([...segmenter.segment(question.text)].length > 72) errors.push("question_length");
      if (question.options.some((option) => [...segmenter.segment(option.text)].length > 48)) errors.push("option_length");
    } else {
      if (texts.some((text) => !/[a-z]/i.test(text) || /[\p{Script=Thai}\p{Script=Han}]/u.test(text))) errors.push("english_script");
      if (question.text.trim().split(/\s+/).length > 18) errors.push("question_length");
      if (question.options.some((option) => option.text.trim().split(/\s+/).length > 7)) errors.push("option_length");
    }
  }
  return [...new Set(errors)];
}

async function runOne(language, index) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/generate-quiz`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: new URL(baseUrl).origin,
      },
      body: JSON.stringify({
        language,
        avoidAngles: [`evaluation-${language}-${index}-previous`],
        nonce: randomUUID(),
      }),
    });
    const wallLatencyMs = Math.round(performance.now() - startedAt);
    const body = await response.json().catch(() => ({}));
    const serverTiming = response.headers.get("server-timing")?.match(/quiz;dur=([\d.]+)/);
    const serverLatencyMs = serverTiming ? Number(serverTiming[1]) : wallLatencyMs;
    const validationErrors = response.ok ? validateQuiz(body, language) : [];
    const metrics = {
      requestCount: Number(response.headers.get("x-quiz-request-count") ?? 0),
      failedRequestCount: Number(response.headers.get("x-quiz-failed-requests") ?? 0),
      promptTokens: Number(response.headers.get("x-quiz-prompt-tokens") ?? 0),
      outputTokens: Number(response.headers.get("x-quiz-output-tokens") ?? 0),
      reasoningTokens: Number(response.headers.get("x-quiz-reasoning-tokens") ?? 0),
      costUsd: Number(response.headers.get("x-quiz-cost-usd") ?? 0),
      missingUsageCount: Number(response.headers.get("x-quiz-missing-usage") ?? 0),
      providers: response.headers.get("x-quiz-providers")?.split(",").filter(Boolean) ?? [],
      finishReasons: response.headers.get("x-quiz-finish-reasons")?.split(",").filter(Boolean) ?? [],
    };
    return {
      language,
      index,
      ok: response.ok && validationErrors.length === 0,
      status: response.status,
      serverLatencyMs,
      wallLatencyMs,
      within30Seconds: serverLatencyMs <= 30_000,
      initialAccepted: Number(response.headers.get("x-quiz-initial-accepted") ?? 0),
      repairRounds: Number(response.headers.get("x-quiz-repair-rounds") ?? 0),
      repairCalls: Number(response.headers.get("x-quiz-repair-calls") ?? 0),
      ...metrics,
      validationErrors,
      failure: response.ok ? undefined : (body.error ?? `HTTP ${response.status}`),
      quiz: response.ok ? body : undefined,
    };
  } catch (error) {
    return {
      language,
      index,
      ok: false,
      status: 0,
      serverLatencyMs: Math.round(performance.now() - startedAt),
      wallLatencyMs: Math.round(performance.now() - startedAt),
      within30Seconds: false,
      initialAccepted: 0,
      repairRounds: 0,
      repairCalls: 0,
      requestCount: 0,
      failedRequestCount: 1,
      promptTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      missingUsageCount: 1,
      providers: [],
      finishReasons: [],
      validationErrors: [],
      failure: error instanceof Error ? error.message : "request_failed",
    };
  }
}

async function runPool(tasks) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const result = await runOne(task.language, task.index);
      results.push(result);
      process.stdout.write(`${result.ok ? "." : "F"}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");
  return results.sort((a, b) => languages.indexOf(a.language) - languages.indexOf(b.language) || a.index - b.index);
}

function summarize(results, language) {
  const selected = results.filter((result) => result.language === language);
  const complete = selected.filter((result) => result.ok);
  const latencies = selected.map((result) => result.serverLatencyMs);
  const elapsedSeconds = selected.reduce((sum, result) => sum + result.serverLatencyMs, 0) / 1000;
  const initialAccepted = selected.map((result) => result.initialAccepted);
  const totalPromptTokens = selected.reduce((sum, result) => sum + result.promptTokens, 0);
  const totalOutputTokens = selected.reduce((sum, result) => sum + result.outputTokens, 0);
  const totalReasoningTokens = selected.reduce((sum, result) => sum + result.reasoningTokens, 0);
  const totalCostUsd = selected.reduce((sum, result) => sum + result.costUsd, 0);
  const failureCategories = {};
  for (const result of selected.filter((item) => !item.ok)) {
    const key = result.validationErrors[0] ?? result.failure ?? `HTTP_${result.status}`;
    failureCategories[key] = (failureCategories[key] ?? 0) + 1;
  }
  return {
    attempted: selected.length,
    complete: complete.length,
    completionRate: complete.length / selected.length,
    completeWithin30Seconds: selected.filter((result) => result.ok && result.within30Seconds).length,
    completeWithin30SecondsRate: selected.filter((result) => result.ok && result.within30Seconds).length / selected.length,
    initialPassComplete: selected.filter((result) => result.initialAccepted === 8).length,
    meanInitialAccepted: initialAccepted.reduce((sum, count) => sum + count, 0) / selected.length,
    quizzesUsingRepair: selected.filter((result) => result.repairRounds > 0).length,
    totalRepairCalls: selected.reduce((sum, result) => sum + result.repairCalls, 0),
    modelRequests: {
      total: selected.reduce((sum, result) => sum + result.requestCount, 0),
      failed: selected.reduce((sum, result) => sum + result.failedRequestCount, 0),
      missingUsage: selected.reduce((sum, result) => sum + result.missingUsageCount, 0),
    },
    tokens: {
      prompt: totalPromptTokens,
      output: totalOutputTokens,
      reasoning: totalReasoningTokens,
    },
    totalCostUsd,
    costPerCompletedQuizUsd: complete.length > 0 ? totalCostUsd / complete.length : null,
    providers: [...new Set(selected.flatMap((result) => result.providers))],
    finishReasons: [...new Set(selected.flatMap((result) => result.finishReasons))],
    serverLatencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.max(...latencies),
    },
    observedThroughput: {
      effectiveRequestOutputTokensPerSecond: elapsedSeconds > 0 ? totalOutputTokens / elapsedSeconds : null,
      note: "Output tokens divided by total quiz-request time; this is not decoder TPS.",
    },
    failureCategories,
  };
}

function omitQuiz(result) {
  const copy = { ...result };
  delete copy.quiz;
  return copy;
}

const tasks = languages.flatMap((language) =>
  Array.from({ length: perLanguage }, (_, index) => ({ language, index: index + 1 })));
const results = await runPool(tasks);
const report = {
  generatedAt: new Date().toISOString(),
  configuration: { baseUrl, perLanguage, concurrency, targetCompletionRateWithin30Seconds: 0.98 },
  summary: Object.fromEntries(languages.map((language) => [language, summarize(results, language)])),
  manualReviewSamples: Object.fromEntries(languages.map((language) => [
    language,
    results.filter((result) => result.language === language && result.ok).slice(0, 10).map((result) => result.quiz),
  ])),
  runs: results.map(omitQuiz),
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${outputPath}`);
