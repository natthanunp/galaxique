/* eslint-disable @typescript-eslint/no-require-imports */
// Dependency-free test runner using the project's existing TypeScript compiler.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
// All external calls are stubs: tests never send answers, notify owners, or touch Redis/Spotify.
let calls = [], responder;
const stars = [], selections = [];
function stub(file, exports) { require.cache[path.join(root, file)] = { id: file, filename: file, loaded: true, exports }; }
stub('lib/llm.ts', { resolveProviderOrder: () => ['groq'], callLlm: async options => {
  calls.push(options);
  try {
    const result = await responder(options);
    options.onMetrics?.({ status: 'completed', elapsedMs: 10, model: options.model, provider: options.providerOrder?.[0] ?? null,
      finishReason: 'stop', promptTokens: 100, completionTokens: 50, reasoningTokens: 0, costUsd: 0.001 });
    return result;
  } catch (error) {
    options.onMetrics?.({ status: 'failed', elapsedMs: 10, model: options.model, provider: options.providerOrder?.[0] ?? null,
      finishReason: null, promptTokens: null, completionTokens: null, reasoningTokens: null, costUsd: null });
    throw error;
  }
} });
stub('lib/songExposureStore.ts', { getExposure: async () => ({}), recordSelection: async id => selections.push(id) });
let catalog = [];
stub('lib/spotify.ts', { spotifyConfigured: () => true, getSpotifyPlaylistTracks: async () => catalog });
stub('lib/songKnowledge.ts', { enrichPlaylistTracks: async tracks => tracks, getSelectableCatalog: async () => null });
stub('lib/constellationStore.ts', { addStar: async star => stars.push(star), getLegacyStars: async () => [] });
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
const { THEMES, CELESTIAL_TYPES, THEME_VIBE, profileLabel } = require('../lib/profile.ts');
const { ASSESSMENT_PROMPT, ASSESSMENT_REPAIR_PROMPT, validateAssessment, selectProfile, analyzeBodySchema } = require('../lib/profileAssessment.ts');
const { validQuizQuestion, questionRejectionReasons, shuffleOptions, generateBalancedQuiz, buildBalancedQuizPrompt, createScenarioPlan, QUIZ_TOPICS, QUIZ_OPTION_THEMES, QUIZ_GENERATION_METRICS, DEFAULT_QUIZ_MODEL, DEFAULT_QUIZ_PROVIDERS } = require('../lib/quiz.ts');
const { rankSongs, pickSong, shortlistSongs, eligibleForLanguage } = require('../lib/songMatching.ts');
const { analyzeFailureDiagnostic, runAnalyze } = require('../lib/analyze.ts');
const { incrementProfileStat, getProfileStats } = require('../lib/profileStatsStore.ts');
const { sanitizeLlmError, LlmRequestError } = require('../lib/llmError.ts');
const { buildCreatureChatPrompt } = require('../prompts/creatureChatPrompt.ts');
const { withRequestDeadline } = require('../lib/requestDeadline.ts');
const { creatureSpecSchema, generatedCreatureSpecSchema } = require('../lib/schemas.ts');
test('request deadline releases a hung SDK call and aborts its signal', async () => {
  let signal;
  await assert.rejects(withRequestDeadline(20, s => {
    signal = s;
    return new Promise(() => {});
  }), { name: 'TimeoutError' });
  assert.equal(signal.aborted, true);
});
test('request deadline preserves successful results and upstream failures', async () => {
  assert.equal(await withRequestDeadline(1000, async () => 'ok'), 'ok');
  const error = new Error('upstream');
  await assert.rejects(withRequestDeadline(1000, async () => { throw error; }), e => e === error);
});

const emptyBrief = () => ({ themes: [], stance: [], mood: [], energy: [], setting: [] });
test('new companions require a non-empty name while legacy companions remain readable', () => {
  const unnamed = { kind: 'cat', accent: 'none', motion: 'orbit' };
  assert.equal(creatureSpecSchema.safeParse(unnamed).success, true);
  assert.equal(generatedCreatureSpecSchema.safeParse(unnamed).success, false);
  assert.equal(generatedCreatureSpecSchema.safeParse({ ...unnamed, name: '  ' }).success, false);
  assert.equal(generatedCreatureSpecSchema.parse({ ...unnamed, name: ' Milo ' }).name, 'Milo');
});
const signals = {
  affectionate: ['I check in on friends', 'I show care through small gestures', 'I make time for people I love'],
  grounded: ['I rely on familiar routines', 'I keep a practical daily rhythm', 'I return to familiar places'],
  reflective: ['I examine what my choices mean', 'I observe before drawing conclusions', 'I reflect on patterns in my life'],
  driven: ['I commit to one goal and act', 'I persist through difficult deadlines', 'I take decisive action under pressure'],
  imaginative: ['I invent alternative possibilities', 'I try unusual creative experiments', 'I connect ideas in surprising ways'],
  questioning: ['I test assumptions before agreeing', 'I ask what evidence supports a claim', 'I form an independent judgment'],
};
function fixture(theme, celestial, variation = 0) {
  const answers = [0, 1, 2].map((_, i) => ({ questionId: i + 1, questionText: `Situation ${i + 1}?`, answer: signals[theme][(i + variation) % 3] }));
  const assessment = { answers: answers.map(a => ({ questionId: a.questionId, signals: [
    { signal: theme, score: 2, evidence: a.answer }, { signal: celestial, score: 2, evidence: a.answer },
  ] })), song_brief: emptyBrief() };
  return { answers, assessment };
}
test('18 clear fixtures cover every theme × celestial pairing independently', () => {
  for (const theme of THEMES) for (const celestial of CELESTIAL_TYPES) {
    const { answers, assessment } = fixture(theme, celestial);
    const result = selectProfile(validateAssessment(assessment, answers), answers);
    assert.equal(result.theme, theme); assert.equal(result.celestial_type, celestial);
    assert.equal(result.vibe, THEME_VIBE[theme]); assert.equal(result.mixed, false);
    for (let i = 0; i < 5; i++) assert.deepEqual(selectProfile(assessment, [...answers].reverse()), result);
  }
});
test('six mixed fixtures resolve ties consistently without a warm default', () => {
  THEMES.forEach((theme, i) => {
    const { answers, assessment } = fixture(theme, 'neutron_star', i);
    const other = THEMES[(i + 1) % THEMES.length];
    for (const a of assessment.answers) a.signals.push({ signal: other, score: 2, evidence: answers[a.questionId - 1].answer });
    const result = selectProfile(assessment, answers);
    assert.ok([theme, other].includes(result.theme)); assert.equal(result.mixed, true);
    assert.equal(result.celestial_type, 'neutron_star');
    assert.equal(selectProfile(assessment, answers.toReversed()).theme, result.theme);
  });
});
test('assessment rejects fabricated evidence, duplicate signals, missing answers, and unsupported defaults', () => {
  const { answers, assessment } = fixture('driven', 'neutron_star');
  const bad = structuredClone(assessment); bad.answers[0].signals[0].evidence = 'not in the answer';
  assert.throws(() => validateAssessment(bad, answers), /evidence/);
  bad.answers[0].signals = [...assessment.answers[0].signals, assessment.answers[0].signals[0]];
  assert.throws(() => validateAssessment(bad, answers), /duplicate/);
  assert.throws(() => validateAssessment({ ...assessment, answers: assessment.answers.slice(1) }, answers));
  assert.throws(() => selectProfile({ ...assessment, answers: assessment.answers.map(a => ({ ...a, signals: [] })) }, answers), /evidence/);
  assert.equal(analyzeBodySchema.safeParse({ answers: [answers[0], answers[0]] }).success, false);
  assert.equal(analyzeBodySchema.safeParse({ answers: [{ ...answers[0], answer: ' ' }] }).success, false);
});
test('Thai custom-answer evidence stays in Thai and uses the same score rules', () => {
  const answers = [{ questionId: 1, questionText: 'เจองานยากทำยังไง?', answer: 'วางแผนแล้วลงมือทำต่อ' }];
  const assessment = { answers: [{ questionId: 1, signals: ['driven', 'neutron_star'].map(signal => ({ signal, score: 2, evidence: 'ลงมือทำต่อ' })) }], song_brief: emptyBrief() };
  assert.equal(selectProfile(validateAssessment(assessment, answers), answers).theme, 'driven');
});
test('assessment prompt interprets short choices in question context without citing the question', () => {
  assert.match(ASSESSMENT_PROMPT, /context of its question/);
  assert.match(ASSESSMENT_PROMPT, /question supplies context/);
  assert.match(ASSESSMENT_REPAIR_PROMPT, /citing only an exact substring of the answer/);
});
const themed = (id, texts) => texts.map((text, i) => ({ text, theme: QUIZ_OPTION_THEMES[id - 1][i] }));
const retheme = (question, id) => ({ ...question, id, options: question.options.map((option, i) => ({ ...option, theme: QUIZ_OPTION_THEMES[id - 1][i] })) });
const englishQuestion = (id, overrides = {}) => ({
  id,
  topic: QUIZ_TOPICS[id - 1],
  setting: `distinct setting ${id}`,
  angle: `Angle ${id}`,
  text: `In situation ${id}, what do you do?`,
  options: themed(id, ['Ask a friend', 'Consider the options', 'Try something new', 'Make a plan']),
  ...overrides,
});
const requestedIds = options => JSON.parse(options.userPrompt).requestedIds;
const questionsFor = (options, transform = question => question) => ({
  questions: requestedIds(options).map(id => transform(englishQuestion(id), id)),
});
const thaiQuestion = id => ({
  id,
  topic: QUIZ_TOPICS[id - 1],
  setting: `distinct Thai setting ${id}`,
  angle: `Thai angle ${id}`,
  text: `เมื่อแผนลำดับที่ ${id} เปลี่ยนกะทันหัน คุณจะรับมือกับสถานการณ์นี้ยังไง?`,
  options: themed(id, [
    'หยุดคิดสักครู่แล้วจัดลำดับสิ่งสำคัญใหม่',
    'ชวนคนที่เกี่ยวข้องมาคุยแล้วหาทางออกร่วมกัน',
    'ลองปรับแผนทันทีแล้วค่อยแก้รายละเอียดระหว่างทาง',
    'เก็บข้อมูลที่มีให้ครบก่อนตัดสินใจเลือกวิธีใหม่',
  ]),
});
const languageQuestionsFor = options => ({
  questions: requestedIds(options).map(id => options.systemPrompt.includes('ภาษาไทย')
    ? thaiQuestion(id)
    : englishQuestion(id)),
});
test('scenario plans vary domains independently instead of cycling four whole plans', () => {
  const plans = Array.from({ length: 20 }, (_, index) => createScenarioPlan(`nonce-${index}`));
  assert.ok(new Set(plans.map(plan => JSON.stringify(plan.map(item => item.setting)))).size > 4);
  assert.ok(plans.every(plan => new Set(plan.map(item => item.setting)).size === 8));
  const thaiPlan = createScenarioPlan('thai-scenes', 'th');
  assert.ok(thaiPlan.every(item => /\p{Script=Thai}/u.test(item.scene)));
  assert.ok(thaiPlan.every(item => /[a-z]/i.test(item.setting)));
});
test('option themes give every profile theme a fair share and are hidden from players', async () => {
  const counts = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  for (const themes of QUIZ_OPTION_THEMES) {
    assert.equal(new Set(themes).size, 4);
    for (const theme of themes) counts[theme]++;
  }
  assert.ok(Object.values(counts).every(count => count >= 5 && count <= 6), JSON.stringify(counts));
  const q = englishQuestion(1);
  const swapped = { ...q, options: [q.options[0], q.options[1], q.options[2], { ...q.options[3], theme: q.options[0].theme }] };
  assert.ok(questionRejectionReasons(swapped, 'en').some(reason => reason.startsWith('option_themes(')));
  assert.equal(validQuizQuestion({ ...q, options: q.options.map(({ text }) => ({ text })) }, 'en'), false);
  calls = [];
  responder = options => questionsFor(options);
  const result = await generateBalancedQuiz({ language: 'en', avoidAngles: [], nonce: 'hidden-themes' }, () => {});
  assert.ok(result.questions.every(question => question.options.every(option => Object.keys(option).join() === 'text')));
  assert.ok(buildBalancedQuizPrompt('en', [1]).includes('"theme":"affectionate"'));
  assert.ok(buildBalancedQuizPrompt('th', [1]).includes('"theme":"affectionate"'));
});
test('question validation rejects bad scripts, overlong or duplicate options; shuffle preserves texts and IDs', () => {
  const q = englishQuestion(1);
  assert.equal(validQuizQuestion(q, 'en'), true);
  assert.equal(validQuizQuestion({ ...q, text: 'When two important plans overlap unexpectedly, how do you decide which commitment deserves your attention first today?' }, 'en'), true);
  assert.equal(validQuizQuestion({ ...q, options: [{ ...q.options[0], text: 'Ask a trusted friend for another perspective' }, ...q.options.slice(1)] }, 'en'), true);
  assert.equal(validQuizQuestion({ ...q, options: Array(4).fill({ text: 'same' }) }, 'en'), false);
  const thai = {
    ...q,
    setting: 'a difficult household task',
    text: 'เจองานยากที่ต้องรีบจัดการ คุณจะเริ่มยังไง?',
    options: themed(1, [
      'ถามเพื่อนให้ช่วยมองอีกมุมหนึ่ง',
      'คิดภาพรวมให้ชัดก่อนค่อยลงมือ',
      'ลองวิธีใหม่แล้วค่อยปรับไประหว่างทาง',
      'วางแผนเป็นขั้นตอนแล้วทำทีละส่วน',
    ]),
  };
  assert.equal(validQuizQuestion(thai, 'th'), true);
  assert.equal(validQuizQuestion({ ...thai, text: 'A question?' }, 'th'), false);
  assert.equal(validQuizQuestion({ ...thai, text: 'ก'.repeat(73) }, 'th'), false);
  assert.equal(validQuizQuestion({ ...thai, text: `${'กิ'.repeat(32)}?` }, 'th'), true);
  assert.equal(validQuizQuestion({ ...thai, text: 'งานยากทำยังไง?' }, 'th'), false);
  assert.ok(questionRejectionReasons({ ...thai, text: 'งานยากทำยังไง?' }, 'th').some(reason => reason.startsWith('question_too_short(actual=')));
  assert.ok(questionRejectionReasons({ ...thai, text: `${'ก'.repeat(73)}?` }, 'th').some(reason => reason.startsWith('question_too_long(actual=')));
  assert.equal(validQuizQuestion({ ...thai, text: thai.text.replace('?', '') }, 'th'), true);
  assert.equal(validQuizQuestion({ ...thai, text: 'วันนี้ลองทำอาหารสูตรใหม่แล้วซอสข้นเกินไป จึงหยุดทำต่อ' }, 'th'), false);
  assert.ok(questionRejectionReasons({ ...thai, text: 'วันนี้ลองทำอาหารสูตรใหม่แล้วซอสข้นเกินไป จึงหยุดทำต่อ' }, 'th').includes('question_incomplete'));
  assert.equal(validQuizQuestion({ ...thai, text: 'พบเพื่อนเก่าในงาน งานนี้จะเริ่มคุยกันยังไง?' }, 'th'), false);
  assert.equal(validQuizQuestion({ ...thai, text: 'ในงานรวมตัวของอาคารคุณพบเพื่อนใหม่ คุณจะเริ่มต้นแชทยังไง?' }, 'th'), false);
  assert.equal(validQuizQuestion({ ...thai, options: [{ ...thai.options[0], text: 'ฟังเพลงที่ชอบ' }, ...thai.options.slice(1)] }, 'th'), true);
  assert.equal(validQuizQuestion(retheme({ ...thai, options: [{ ...thai.options[0], text: 'ไม่ทำอะไรเลยสักพัก' }, ...thai.options.slice(1)] }, 2), 'th'), true);
  assert.equal(validQuizQuestion(retheme({ ...thai, options: [{ ...thai.options[0], text: 'ไม่ทำอะไรเลยสักพัก' }, ...thai.options.slice(1)] }, 5), 'th'), false);
  assert.ok(questionRejectionReasons({ ...thai, options: [{ ...thai.options[0], text: 'ฟัง' }, ...thai.options.slice(1)] }, 'th').some(reason => reason.startsWith('option_1_too_short(actual=')));
  assert.equal(validQuizQuestion({ ...thai, options: [{ ...thai.options[0], text: 'สุ่มเลือกไปเลย' }, ...thai.options.slice(1)] }, 'th'), false);
  assert.equal(validQuizQuestion({ ...thai, options: [{ ...thai.options[0], text: 'ชวนคุยเรื่องอาหารตรงหน้า' }, ...thai.options.slice(1)] }, 'th'), false);
  const shuffled = shuffleOptions(q, () => 0);
  assert.equal(shuffled.id, q.id); assert.deepEqual(shuffled.options.map(o => o.text).sort(), q.options.map(o => o.text).sort());
  assert.notDeepEqual(shuffled.options, q.options); assert.equal(q.options[0].text, 'Ask a friend');
});
test('two initial batches run concurrently and a malformed item triggers only a targeted repair', async () => {
  calls = [];
  const deferred = [];
  responder = options => new Promise(resolve => deferred.push({ options, resolve }));
  const pending = generateBalancedQuiz({ language: 'en', avoidAngles: [], nonce: 'concurrency' }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(requestedIds), [[1, 2, 3, 4], [5, 6, 7, 8]]);
  deferred[0].resolve(questionsFor(deferred[0].options, (question, id) => id === 1
    ? {
        ...question,
        id: '1',
        topic: 'wrong-but-derived-from-id',
        angle: undefined,
        options: question.options.map(option => ({ ...option, theme: ` ${option.theme.toUpperCase()} ` })),
      }
    : question));
  deferred[1].resolve(questionsFor(deferred[1].options, (question, id) => id === 8
    ? { ...question, options: question.options.map(option => ({ ...option, text: 'Same choice' })) }
    : question));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
  assert.deepEqual(requestedIds(calls[2]), [8]);
  deferred[2].resolve(questionsFor(deferred[2].options));
  const result = await pending;
  assert.equal(result.questions.length, 8);
  for (const call of calls.slice(0, 2)) for (const topic of QUIZ_TOPICS) assert.ok(call.systemPrompt.includes(topic));
  assert.ok(calls[2].systemPrompt.includes('This is a targeted repair'));
  const repairData = JSON.parse(calls[2].userPrompt);
  assert.equal(repairData.acceptedQuestions.length, 7);
  assert.ok(repairData.rejectionReasons['8'].includes('duplicate_options'));
  assert.ok(buildBalancedQuizPrompt('th', [8], true).includes('ตั้งเป้าคำถาม 32–64'));
  assert.ok(buildBalancedQuizPrompt('th', [8], true).includes('อย่าเขียนชิดค่าสูงสุด'));
  assert.ok(calls.every(c => c.singleAttempt && c.allowProviderFallbacks === true));
  assert.ok(calls.slice(0, 2).every(c => c.timeoutMs <= 12000));
  assert.ok(calls.slice(2).every(c => c.timeoutMs <= 8000));
  assert.ok(calls.every(c => c.reasoningEffort === 'none'));
  assert.ok(calls.every(c => c.model === DEFAULT_QUIZ_MODEL));
  assert.deepEqual(calls[0].providerOrder, [...DEFAULT_QUIZ_PROVIDERS]);
  assert.equal(calls[0].maxTokens, 1440);
  assert.deepEqual(calls[0].responseFormat, { type: 'json_object' });
  assert.deepEqual(result[QUIZ_GENERATION_METRICS], {
    elapsedMs: result[QUIZ_GENERATION_METRICS].elapsedMs,
    initialAccepted: 7,
    repairRounds: 1,
    repairCalls: 1,
    requestCount: 3,
    failedRequestCount: 0,
    promptTokens: 300,
    outputTokens: 150,
    reasoningTokens: 0,
    costUsd: 0.003,
    missingUsageCount: 0,
    providers: [DEFAULT_QUIZ_PROVIDERS[0]],
    finishReasons: ['stop'],
  });
  calls = []; responder = () => ({ questions: [] });
  await assert.rejects(generateBalancedQuiz({ language: 'en', avoidAngles: [] }, () => {}), /eight valid fresh questions/);
  assert.equal(calls.length, 12, 'repairs continue for six rounds while the deadline allows');
  assert.ok(calls[2].maxTokens > calls[0].maxTokens / 2);
});
test('near-limit Thai questions get deterministic validation-only repair rounds', async () => {
  calls = [];
  let idFiveAttempts = 0;
  responder = options => ({
    questions: requestedIds(options).map(id => {
      const question = thaiQuestion(id);
      if (id !== 5) return question;
      idFiveAttempts++;
      return idFiveAttempts <= 3
        ? { ...question, text: `${'ก'.repeat(73)}?` }
        : question;
    }),
  });
  const result = await generateBalancedQuiz({ language: 'th', avoidAngles: [], nonce: 'extra-validation-repair' }, () => {});
  assert.equal(result.questions.length, 8);
  assert.equal(calls.length, 5, 'two initial calls plus three targeted repairs');
  assert.equal(result[QUIZ_GENERATION_METRICS].repairRounds, 3);
  assert.equal(result[QUIZ_GENERATION_METRICS].repairCalls, 3);
  assert.ok(calls.slice(0, 2).every(call => call.temperature === 0.7));
  assert.ok(calls.slice(2).every(call => call.temperature === 0.2));
});
test('provider failures stay on the same model and start the next round on the other provider', async () => {
  calls = [];
  responder = options => {
    if (requestedIds(options)[0] === 1 && calls.length <= 2) throw new LlmRequestError(429, 'openai');
    return questionsFor(options);
  };
  const result = await generateBalancedQuiz({ language: 'en', avoidAngles: [] }, () => {});
  assert.equal(result.questions.length, 8);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.singleAttempt));
  assert.ok(calls.every(call => call.allowProviderFallbacks === true));
  assert.ok(calls.every(call => call.providerIgnore === undefined));
  assert.ok(calls.every(call => call.model === calls[0].model));
  assert.deepEqual(calls[0].providerOrder, ['openai', 'azure']);
  assert.deepEqual(calls[2].providerOrder, ['azure', 'openai']);
  assert.deepEqual(calls[3].providerOrder, ['azure', 'openai']);
});
test('quiz uses the one shared model, providers, and reasoning setting for both languages', async () => {
  for (const language of ['th', 'en']) {
    calls = [];
    responder = options => languageQuestionsFor(options);
    await generateBalancedQuiz({ language, avoidAngles: [], nonce: `shared-${language}` }, () => {});
    assert.ok(calls.every(call => call.model === DEFAULT_QUIZ_MODEL));
    assert.ok(calls.every(call => JSON.stringify(call.providerOrder) === JSON.stringify(DEFAULT_QUIZ_PROVIDERS)));
    assert.ok(calls.every(call => call.reasoningEffort === 'none'));
  }
});
test('provider outage never substitutes static questions for a fresh AI quiz', async () => {
  calls = [];
  responder = () => { throw new LlmRequestError(undefined, undefined, true); };
  await assert.rejects(generateBalancedQuiz({ language: 'en', avoidAngles: [] }, () => {}), /eight valid fresh questions/);
  assert.equal(calls.length, 12);
});
test('cross-batch settings and work/school contexts retain lower IDs and repair rejected IDs', async () => {
  calls = [];
  responder = options => questionsFor(options, (question, id) => {
    if (calls.length > 2) return question;
    if (id === 5) return { ...question, setting: 'distinct setting 1' };
    if (id === 2) return { ...question, setting: 'office discussion', text: 'At work, a shared plan changes suddenly. What do you do?' };
    if (id === 6) return { ...question, setting: 'school workshop', text: 'At school, a group plan changes suddenly. What do you do?' };
    return question;
  });
  const result = await generateBalancedQuiz({ language: 'en', avoidAngles: [], nonce: 'cross-batch' }, () => {});
  assert.equal(result.questions.length, 8);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(2).map(requestedIds), [[5], [6]]);
  const repairs = calls.slice(2).map(call => JSON.parse(call.userPrompt));
  assert.ok(repairs[0].rejectionReasons['5'].includes('repeated_setting'));
  assert.ok(repairs[1].rejectionReasons['6'].includes('work_school_limit'));
});
test('the overall deadline aborts concurrent calls and prevents repair work after expiry', async () => {
  calls = [];
  const observedSignals = [];
  responder = options => new Promise((resolve, reject) => {
    observedSignals.push(options.signal);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const started = Date.now();
  await assert.rejects(
    generateBalancedQuiz(
      { language: 'en', avoidAngles: [], nonce: 'deadline' },
      () => {},
      { overallMs: 30, initialCallMs: 20, repairCallMs: 10 },
    ),
    /eight valid fresh questions/,
  );
  assert.ok(Date.now() - started < 150);
  assert.equal(calls.length, 2);
  assert.ok(observedSignals.every(signal => signal.aborted));
  assert.ok(calls.every(call => call.timeoutMs <= 20));
});
test('SDK errors cannot carry authorization, cookies, prompts or raw bodies across the boundary', () => {
  const marker = 'synthetic-secret-for-test';
  const raw = Object.assign(new Error(marker), {
    statusCode: 429, headers: { authorization: marker, cookie: marker }, body: marker,
    'data$': { 'request$': { headers: { authorization: marker }, body: marker } },
    error: { metadata: { provider_name: 'DeepInfra', raw: marker } },
  });
  const safe = sanitizeLlmError(raw);
  assert.equal(safe.statusCode, 429); assert.equal(safe.provider, 'deepinfra');
  assert.equal(safe.kind, 'http');
  assert.equal(safe.retryable, true);
  assert.ok(!require('node:util').inspect(safe, { depth: 10 }).includes(marker));
  assert.ok(!JSON.stringify(safe).includes(marker)); assert.equal(safe.cause, undefined);
  assert.equal(sanitizeLlmError({ name: 'TimeoutError' }).name, 'TimeoutError');
  assert.equal(sanitizeLlmError(new Error('OpenRouter returned non-JSON output.')).kind, 'non_json');
  assert.equal(sanitizeLlmError({ name: 'ConnectionError' }).kind, 'connection');
});
const track = (id, overrides = {}) => ({ track_id: id, name: `Song ${id}`, artist: 'Test Artist', knowledge: {
  known: true, themes: ['commitment', 'perseverance'], relationship_stance: 'independence', mood: 'determined', energy: 'driving', setting: 'forward motion', summary: 'A song about perseverance.', is_thai: false, ...overrides,
} });
test('English users never get Thai songs; Thai users get every song; lyric_language overrides is_thai', () => {
  const pool = [
    track('en'), track('kpop', { lyric_language: 'ko' }), track('legacy-th', { is_thai: true }),
    track('reviewed-th', { lyric_language: 'th', is_thai: false }),
    track('thai-artist-english', { lyric_language: 'en', is_thai: true }),
    { track_id: 'unreviewed', name: 'เพลง', artist: 'X' },
  ];
  assert.deepEqual(eligibleForLanguage(pool, 'en').map(t => t.track_id), ['en', 'kpop', 'thai-artist-english']);
  assert.equal(eligibleForLanguage(pool, 'th').length, pool.length);
});
test('selection: weak matches never win, picks are seeded, cooldowns and exposure spread choices', () => {
  const best = track('best'), near = track('near'), weak = track('weak', { themes: ['heartbreak'], mood: 'melancholy' });
  const ranked = [{ track: best, score: 55 }, { track: near, score: 52 }, { track: weak, score: 10 }];
  assert.deepEqual(shortlistSongs(ranked).map(r => r.track.track_id), ['best', 'near']);
  const seeds = Array.from({ length: 400 }, (_, i) => `seed-${i}`);
  const pick = (options) => seeds.map(seed => pickSong(ranked, { seed, ...options }).track.track_id);
  assert.ok(pick({}).every(id => id !== 'weak'));
  assert.ok(pick({ sessionRecent: ['best', 'near'] }).every(id => id !== 'weak'));
  assert.equal(pickSong(ranked, { seed: 'same' }).track.track_id, pickSong(ranked, { seed: 'same' }).track.track_id);
  const share = (ids, id) => ids.filter(x => x === id).length / ids.length;
  assert.ok(share(pick({}), 'near') > 0.2, 'near-best songs share selections');
  assert.ok(share(pick({ sessionRecent: ['best'] }), 'near') > 0.9, 'personal cooldown');
  assert.ok(share(pick({ exposure: { best: 30 } }), 'near') > share(pick({}), 'near'), 'global exposure');
  const brief = { themes: ['perseverance'], stance: ['independence'], mood: ['determined'], energy: ['driving'], setting: [] };
  const pool = Array.from({ length: 40 }, (_, i) => track(`weak${i}`, { themes: ['heartbreak'], relationship_stance: 'yearning', mood: 'melancholy', energy: 'still' }));
  pool.push(best);
  assert.equal(rankSongs(pool, brief)[0].track.track_id, 'best');
  assert.deepEqual(rankSongs([best], brief), rankSongs([track('best', { vibe: 'cozy', celestial_affinity: ['galaxy'] })], brief).map(r => ({ ...r, track: best })));
  assert.equal(pickSong([], { seed: 'x' }), undefined);
});
test('concept vocabulary matches synonyms and Thai descriptors', () => {
  const yearning = track('yearning', { themes: ['longing'], relationship_stance: 'missing someone', mood: 'wistful', energy: 'still', setting: 'night' });
  const thai = track('thai', { themes: ['คิดถึง'], relationship_stance: 'โหยหา', mood: 'เศร้า', energy: 'ช้า', setting: 'กลางคืน' });
  const party = track('party', { themes: ['celebration'], relationship_stance: 'friendship', mood: 'euphoric', energy: 'driving', setting: 'club' });
  const brief = { themes: ['yearning'], stance: ['pining'], mood: ['melancholy'], energy: ['slow'], setting: ['late-night'] };
  const ranked = rankSongs([party, yearning, thai], brief);
  assert.equal(ranked.at(-1).track.track_id, 'party');
  assert.ok(ranked.find(r => r.track.track_id === 'thai').score > 0);
});
const visualReveal = (fixed, song) => ({
  ...fixed, central_symbol: 'diamond', creature: { kind: 'dragon', accent: 'none', motion: 'fly', name: 'Sol' },
  primary_color: '#00aaff', secondary_color: '#ffffff', rotation_speed: 0.5, particle_density: 'medium',
  celestial_config: { celestial_type: 'neutron_star', neutron_star: { seed: 42, pulse_intensity: 0.5, jet_length: 1, magnetic_tilt: 0.4 } },
  spotify_track_id: song.track_id, spotify_search_query: `${song.name} ${song.artist}`,
  personality_reading: `Your commitment shines with focused energy. ${song.name} by ${song.artist} echoes your perseverance. Sol shares your courage.`,
});
test('integrated reveal assesses without catalog, fixes classification/song before writing, preserves full song identity', async () => {
  const { answers, assessment } = fixture('driven', 'neutron_star');
  assessment.song_brief = { themes: ['perseverance'], stance: [], mood: ['determined'], energy: ['driving'], setting: [] };
  catalog = [track('one')]; calls = [];
  responder = options => {
    if (options.purpose === 'assessment') {
      assert.ok(!options.systemPrompt.includes('Song one')); assert.deepEqual(JSON.parse(options.userPrompt), answers);
      return assessment;
    }
    const data = JSON.parse(options.userPrompt);
    assert.equal(data.fixed.celestial_type, 'neutron_star'); assert.equal(data.selected_song.name, 'Song one');
    assert.ok(!('vibe' in data.selected_song));
    return visualReveal(data.fixed, data.selected_song);
  };
  const result = await runAnalyze({ answers, language: 'en' }, () => {});
  assert.equal(calls.length, 2); assert.equal(result.theme, 'driven'); assert.equal(result.profile_version, 2);
  assert.match(result.reveal_id, /^[a-f0-9-]{36}$/); assert.equal(stars.length, 0, 'reveals are never auto-published');
  assert.equal(selections.at(-1), 'one');
  assert.equal(typeof result.reveal_token, 'string');
  const { loadReveal } = require('../lib/revealStore.ts');
  assert.equal((await loadReveal(result.reveal_id, result.reveal_token)).reveal.theme, 'driven');
  assert.equal(await loadReveal(result.reveal_id, 'wrong-token'), null);
});
test('analyze deterministically restores an omitted selected-song artist without a reveal retry', async () => {
  const { answers, assessment } = fixture('driven', 'neutron_star');
  catalog = [track('one')]; calls = [];
  responder = options => {
    if (options.purpose === 'assessment') return assessment;
    const data = JSON.parse(options.userPrompt);
    return {
      ...visualReveal(data.fixed, data.selected_song),
      personality_reading: `พลังของคุณชัดเจนจากคำตอบ เพลง “${data.selected_song.name}” สะท้อนความมุ่งมั่นนั้น และ Sol ก็ร่วมเดินทางไปกับคุณ`,
    };
  };
  const result = await runAnalyze({ answers, language: 'th' }, () => {});
  assert.match(result.personality_reading, /“Song one” โดย Test Artist/);
  assert.equal(calls.filter(call => call.purpose === 'reveal').length, 1);
});
test('invalid assessment retries once and never writes a creative default', async () => {
  calls = []; responder = () => ({ answers: [], song_brief: emptyBrief() }); catalog = [track('one')];
  await assert.rejects(
    runAnalyze({ answers: fixture('driven', 'neutron_star').answers }, () => {}),
    error => {
      assert.deepEqual(analyzeFailureDiagnostic(error), {
        stage: 'assessment', kind: 'validation', attempt: 2,
      });
      return true;
    },
  );
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.purpose === 'assessment'));
  assert.ok(!calls[0].systemPrompt.includes(ASSESSMENT_REPAIR_PROMPT));
  assert.ok(calls[1].systemPrompt.includes(ASSESSMENT_REPAIR_PROMPT));
});
test('reveal failures expose a privacy-safe stage and kind after retry exhaustion', async () => {
  const { answers, assessment } = fixture('driven', 'neutron_star');
  catalog = [track('one')]; calls = [];
  responder = options => options.purpose === 'assessment' ? assessment : {};
  await assert.rejects(runAnalyze({ answers, language: 'en' }, () => {}), error => {
    const diagnostic = analyzeFailureDiagnostic(error);
    assert.deepEqual(diagnostic, {
      stage: 'reveal', kind: 'validation', attempt: 2,
    });
    assert.ok(!JSON.stringify(diagnostic).includes(answers[0].answer));
    return true;
  });
  assert.equal(calls.filter(call => call.purpose === 'reveal').length, 2);
});
test('stored legacy labels remain readable and current labels reach companion context', () => {
  assert.equal(profileLabel({ vibe: 'cynical' }, 'th'), 'เย็นชา');
  assert.equal(profileLabel({ vibe: 'cynical', theme: 'questioning' }, 'en'), 'Questioning');
  assert.equal(profileLabel({ vibe: 'cynical', theme: 'questioning', profile_version: 2 }, 'en'), 'Questioning');
  const reveal = { ...visualReveal({ vibe: 'cynical', celestial_type: 'neutron_star' }, track('one')), profile_version: 2, theme: 'questioning' };
  assert.match(buildCreatureChatPrompt(reveal, 'en'), /Questioning: Independent judgment/);
});
test('profile counts deduplicate a reveal UUID', async () => {
  const input = { profile_version: 2, reveal_id: '00000000-0000-4000-8000-000000000001', theme: 'driven', vibe: 'intense', celestial_type: 'neutron_star', language: 'th' };
  await Promise.all([incrementProfileStat(input), incrementProfileStat(input)]);
  const after = await getProfileStats();
  assert.equal(after.stats.total, 1); assert.equal(after.stats.driven, 1); assert.equal(after.stats['driven:neutron_star'], 1);
  await assert.rejects(incrementProfileStat({ ...input, vibe: 'cozy' }));
});
test('stats API exposes only current counters and rejects the removed payload shape', async () => {
  const statsRoute = require('../app/api/stats/route.ts');
  const incrementRoute = require('../app/api/stats/increment/route.ts');
  const response = await statsRoute.GET();
  const data = await response.json();
  assert.equal(data.success, true);
  assert.deepEqual(Object.keys(data).sort(), ['source', 'stats', 'success']);
  const legacy = await incrementRoute.POST(new Request('http://localhost/api/stats/increment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vibe: 'cute' }),
  }));
  assert.equal(legacy.status, 400);
});
test('JSON and SSE routes use the current generation and analysis by default; malformed input never reaches a model', async () => {
  const quizRoute = require('../app/api/generate-quiz/route.ts');
  const analyzeRoute = require('../app/api/analyze/route.ts');
  const makeRequest = (url, body, stream = false) => new Request(`http://localhost/api/${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(stream ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify(body),
  });
  calls = []; responder = options => questionsFor(options);
  const quiz = await quizRoute.POST(makeRequest('generate-quiz', { language: 'en' }));
  assert.equal(quiz.status, 200); assert.equal((await quiz.json()).questions.length, 8);
  assert.equal(quiz.headers.get('x-quiz-request-count'), '2');
  assert.equal(quiz.headers.get('x-quiz-output-tokens'), '100');
  assert.equal(quiz.headers.get('x-quiz-cost-usd'), '0.002');
  const quizStream = await quizRoute.POST(makeRequest('generate-quiz', { language: 'en' }, true));
  assert.match(await quizStream.text(), /event: result/); assert.equal(calls.length, 4);
  const { answers, assessment } = fixture('driven', 'neutron_star');
  catalog = [track('one')]; calls = [];
  responder = opts => opts.purpose === 'assessment' ? assessment : visualReveal(JSON.parse(opts.userPrompt).fixed, JSON.parse(opts.userPrompt).selected_song);
  const bad = await analyzeRoute.POST(makeRequest('analyze', { answers: [{ questionId: 1, answer: 3 }] }));
  assert.equal(bad.status, 400); assert.equal(calls.length, 0);
  const jsonResult = await analyzeRoute.POST(makeRequest('analyze', { answers, language: 'en' }));
  assert.equal(jsonResult.status, 200); assert.equal((await jsonResult.json()).profile_version, 2);
  const streamResult = await analyzeRoute.POST(makeRequest('analyze', { answers, language: 'en' }, true));
  const output = await streamResult.text();
  assert.match(output, /event: progress/); assert.match(output, /event: result/); assert.match(output, /"profile_version":2/);
  responder = () => ({});
  const failure = await analyzeRoute.POST(makeRequest('analyze', { answers }, true));
  const failureText = await failure.text();
  assert.match(failureText, /event: error/); assert.ok(!failureText.includes('event: result'));

  calls = [];
  responder = () => { throw new LlmRequestError(429, 'groq'); };
  const failedQuiz = await quizRoute.POST(makeRequest('generate-quiz', { language: 'en', nonce: 'failed-metrics' }));
  assert.equal(failedQuiz.status, 502);
  assert.equal(failedQuiz.headers.get('x-quiz-request-count'), '12');
  assert.equal(failedQuiz.headers.get('x-quiz-failed-requests'), '12');
  assert.equal(failedQuiz.headers.get('x-quiz-output-tokens'), '0');
});

test('matching JSON/SSE quiz requests share one in-flight job while nonce, language, and history isolate jobs', async () => {
  const quizRoute = require('../app/api/generate-quiz/route.ts');
  const makeRequest = (body, stream = false) => new Request('http://localhost/api/generate-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(stream ? { Accept: 'text/event-stream' } : {}) },
    body: JSON.stringify(body),
  });
  calls = [];
  const deferred = [];
  responder = options => new Promise(resolve => deferred.push({ options, resolve }));
  const jsonPending = quizRoute.POST(makeRequest({ language: 'en', nonce: 'shared', avoidAngles: [' B ', 'a'] }));
  const ssePending = quizRoute.POST(makeRequest({ language: 'en', nonce: 'shared', avoidAngles: ['A', 'b'] }, true));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  for (const item of deferred.splice(0)) item.resolve(questionsFor(item.options));
  const [jsonResponse, sseResponse] = await Promise.all([jsonPending, ssePending]);
  assert.equal((await jsonResponse.json()).questions.length, 8);
  const streamText = await sseResponse.text();
  assert.match(streamText, /event: progress/);
  assert.match(streamText, /event: result/);
  assert.equal(require('../lib/quizJobs.ts').activeQuizJobCount(), 0);

  calls = [];
  responder = options => languageQuestionsFor(options);
  await Promise.all([
    quizRoute.POST(makeRequest({ language: 'en', nonce: 'isolation', avoidAngles: ['one'] })),
    quizRoute.POST(makeRequest({ language: 'en', nonce: 'isolation', avoidAngles: ['two'] })),
    quizRoute.POST(makeRequest({ language: 'th', nonce: 'isolation', avoidAngles: ['one'] })),
    quizRoute.POST(makeRequest({ language: 'en', nonce: 'different-nonce', avoidAngles: ['one'] })),
  ]);
  assert.equal(calls.length, 8);
  assert.equal(new Set(calls.map(call => call.nonce)).size, 8,
    'lower-level LLM deduplication must not merge different quiz jobs');
});

test('client request identity is shared for matching work and rotated for an explicit retry', () => {
  const {
    acquireQuizRequestNonce,
    releaseQuizRequestNonce,
  } = require('../lib/quizRequestNonce.ts');
  const first = acquireQuizRequestNonce([' B ', 'a'], 'en');
  const matching = acquireQuizRequestNonce(['A', 'b'], 'en');
  const retry = acquireQuizRequestNonce(['a', 'b'], 'en', true);
  assert.equal(matching, first);
  assert.notEqual(retry, first);
  releaseQuizRequestNonce(['a', 'b'], 'en', retry);
  assert.notEqual(acquireQuizRequestNonce(['a', 'b'], 'en'), retry);
});

test('quiz and reveal streams tolerate cancellation, late progress, and worker errors', async () => {
  const helpers = [require('../lib/quizProgress.ts').quizSseStream, require('../lib/analyzeProgress.ts').sseStream];
  for (const streamOf of helpers) {
    for (const fail of [false, true]) {
      let finish, report;
      const stream = streamOf(progress => { report = progress; return new Promise((resolve, reject) => { finish = () => fail ? reject(new Error('worker failed')) : resolve({ ok: true }); }); });
      await Promise.resolve();
      const reader = stream.getReader();
      await reader.cancel();
      assert.doesNotThrow(() => report({ stage: 'writing', completed: 1, total: 8 }));
      finish();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await reader.read()).done, true);
    }
    let report;
    const completed = streamOf(progress => { report = progress; return Promise.resolve({ ok: true }); });
    assert.match(await new Response(completed).text(), /event: result/);
    assert.doesNotThrow(() => report({ stage: 'writing', completed: 8, total: 8 }));
    const thrown = streamOf(() => { throw new Error('sync failure'); });
    assert.match(await new Response(thrown).text(), /event: error/);
  }
});

test('creature behavior: arrival sequence, reactions, cooldowns, listening and rest', () => {
  const { createBehavior, step, DURATIONS } = require('../three/creature/behavior.ts');
  let b = createBehavior(0, true);
  assert.equal(b.state, 'sleep');
  b = step(b, { type: 'arrive' }, 1);
  assert.equal(b.state, 'notice');
  b = step(b, { type: 'tick' }, 1 + DURATIONS.notice);
  assert.equal(b.state, 'notice', 'waking from sleep takes longer');
  b = step(b, { type: 'tick' }, 1 + DURATIONS.wakeNotice + 0.01);
  assert.equal(b.state, 'greet');
  assert.equal(step(b, { type: 'tap' }, 3).state, 'greet', 'greeting is not interrupted by taps');
  b = step(b, { type: 'tick' }, 1 + DURATIONS.wakeNotice + DURATIONS.greet + 0.02);
  assert.equal(b.state, 'idle');
  b = step(b, { type: 'tap' }, 10);
  assert.deepEqual([b.state, b.reaction], ['react', 'happy']);
  b = step(step(b, { type: 'tap' }, 10.5), { type: 'tap' }, 11);
  assert.equal(b.reaction, 'dizzy');
  b = step(step(step(b, { type: 'tap' }, 12), { type: 'tap' }, 12.3), { type: 'tap' }, 12.6);
  assert.equal(b.reaction, 'happy', 'dizzy spin has a cooldown');
  b = step(b, { type: 'longPress' }, 13);
  assert.equal(b.reaction, 'shy');
  b = step(b, { type: 'typing', active: true }, 13.1);
  assert.equal(b.state, 'react', 'typing does not cut a reaction');
  b = step(b, { type: 'tick' }, 13 + DURATIONS.react + 0.01);
  b = step(b, { type: 'typing', active: true }, 15);
  assert.equal(b.state, 'listen');
  b = step(b, { type: 'talkStart' }, 16);
  assert.equal(b.state, 'talk');
  b = step(b, { type: 'talkEnd', emotion: 'excited' }, 18);
  assert.deepEqual([b.state, b.reaction], ['react', 'excited']);
  b = step(step(b, { type: 'tick' }, 20), { type: 'tick' }, 20 + 46);
  assert.equal(b.state, 'rest');
  let calm = createBehavior(0, false, true);
  calm = step(step(step(calm, { type: 'tap' }, 1), { type: 'tap' }, 1.2), { type: 'tap' }, 1.4);
  assert.equal(calm.reaction, 'happy', 'reduced motion never spins');
});

test('personal-information check flags contact details but not ordinary readings', () => {
  const { findPersonalInfo } = require('../lib/piiCheck.ts');
  assert.deepEqual(findPersonalInfo('Your warmth shows in how you check in on friends. “Apocalypse” by Cigarettes After Sex echoes that.'), []);
  assert.ok(findPersonalInfo('email me at a.b@example.com').includes('email'));
  assert.ok(findPersonalInfo('call 081-234-5678').length > 0);
  assert.ok(findPersonalInfo('แอดไลน์มาได้นะ ไลน์: abc').includes('thai_contact'));
  assert.ok(findPersonalInfo('follow @someone.here').includes('handle'));
});

test('worlds: consented snapshot, one per reveal, owner-only control, reports hide', async () => {
  const store = require('../lib/worldStore.ts');
  const reveal = { ...visualReveal({ vibe: 'intense', celestial_type: 'neutron_star' }, track('one')), reveal_id: '00000000-0000-4000-8000-000000000099', theme: 'driven', profile_version: 2 };
  const stored = { reveal, language: 'en', isrc: 'USABC1234567', song: { name: 'Song one', artist: 'Test Artist' }, tokenHash: 'x', createdAt: 1 };
  const hidden = store.buildSnapshot(stored, false);
  assert.equal(hidden.reading, null);
  assert.deepEqual(hidden.song, { track_id: 'one', isrc: 'USABC1234567', name: 'Song one', artist: 'Test Artist' });
  assert.ok(!JSON.stringify(hidden).includes('answers'));
  const published = await store.publishWorld(reveal.reveal_id, store.buildSnapshot(stored, true));
  assert.ok(published.ownerToken && published.world.id);
  const again = await store.publishWorld(reveal.reveal_id, store.buildSnapshot(stored, true));
  assert.equal(again.existingId, published.world.id);
  const id = published.world.id;
  assert.equal((await store.getWorld(id)).reading, reveal.personality_reading);
  assert.ok((await store.listWorlds(Date.now() + 1, 10)).worlds.some(w => w.id === id && !('reading' in w)));
  assert.equal(await store.deleteWorld(id, 'not-the-owner-token-123'), false);
  assert.equal(await store.setPublished(id, published.ownerToken, false), true);
  assert.equal(await store.getWorld(id), null);
  assert.equal(await store.setPublished(id, published.ownerToken, true), true);
  assert.equal(await store.reportWorld(id, 'spam'), true);
  assert.equal(await store.getWorld(id), null, 'reported worlds are hidden pending review');
  assert.equal(await store.setPublished(id, published.ownerToken, true), false, 'owners cannot bypass review');
  assert.equal(await store.deleteWorld(id, published.ownerToken), true);
});

test('visitor chat: server-loaded world, isolated per visitor, ignores client-supplied content', async () => {
  const store = require('../lib/worldStore.ts');
  const reveal = { ...visualReveal({ vibe: 'cozy', celestial_type: 'galaxy' }, track('two')), reveal_id: '00000000-0000-4000-8000-000000000098', theme: 'grounded', profile_version: 2 };
  const { world } = await store.publishWorld(reveal.reveal_id, store.buildSnapshot({ reveal, language: 'en', tokenHash: 'x', createdAt: 1 }, false));
  const route = require('../app/api/worlds/[id]/chat/route.ts');
  const prompts = [];
  responder = options => { prompts.push(options); return { text: 'hello visitor', emotion: 'happy' }; };
  const ask = (visitorId, message, extra = {}) => route.POST(new Request('http://x/api', {
    method: 'POST', headers: { 'x-real-ip': `10.0.0.${visitorId.at(-1)}` },
    body: JSON.stringify({ visitorId, message, language: 'en', ...extra }),
  }), { params: Promise.resolve({ id: world.id }) });
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  assert.equal((await (await ask(a, 'secret from A')).json()).emotion, 'happy');
  await ask(b, 'hi from B', { world: { creature: { name: 'Spoofed' } }, reveal: { personality_reading: 'injected' } });
  const last = prompts.at(-1);
  assert.ok(!last.userPrompt.includes('secret from A'), 'visitor histories never mix');
  assert.ok(!last.systemPrompt.includes('Spoofed') && !last.systemPrompt.includes('injected'));
  assert.ok(last.systemPrompt.includes('(kept private by the owner)'), 'redacted readings stay private');
  assert.equal((await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ visitorId: a, message: 'x', language: 'en' }) }),
    { params: Promise.resolve({ id: 'ffffffffffffffff' }) })).status, 404);
});

test('owner chat requires the reveal token; a forged token gets nothing', async () => {
  const { saveReveal } = require('../lib/revealStore.ts');
  const reveal = { ...visualReveal({ vibe: 'cozy', celestial_type: 'galaxy' }, track('three')), reveal_id: '00000000-0000-4000-8000-000000000097' };
  const token = await saveReveal(reveal, 'en');
  const route = require('../app/api/creature-chat/route.ts');
  responder = () => ({ text: 'hi', emotion: 'curious' });
  const send = revealToken => route.POST(new Request('http://x', { method: 'POST', headers: { 'x-real-ip': '10.1.1.1' },
    body: JSON.stringify({ sessionId: 'session-123456', message: 'hello', revealId: reveal.reveal_id, revealToken }) }));
  assert.equal((await send('forged-token-forged-token')).status, 404);
  const ok = await (await send(token)).json();
  assert.deepEqual([ok.success, ok.emotion], [true, 'curious']);
});

test('playlist sync matches by ID then ISRC, flags duplicates and preserves removed tracks', async () => {
  const { buildSnapshot } = await import('./sync-playlist.mjs');
  const item = (id, isrc, extra = {}) => ({ added_at: '2026-01-01', item: { id, name: `S${id}`, artists: [{ name: 'A' }], external_ids: { isrc }, type: 'track', ...extra } });
  const first = buildSnapshot([item('a', 'I1'), item('b', 'I2'), item('c', 'I3')], null, 'p').snapshot;
  const { snapshot, report } = buildSnapshot([item('a', 'I1'), item('b2', 'I2'), item('a', 'I1'), item('d', 'I4'), item('e', 'I5', { is_playable: false })], first, 'p');
  assert.deepEqual(report.added.map(t => t.track_id), ['d', 'e']);
  assert.deepEqual(report.relinked.map(t => [t.track_id, t.previous_track_id]), [['b2', 'b']]);
  assert.deepEqual(report.removed.map(t => t.track_id), ['c']);
  assert.equal(report.duplicates.length, 1);
  assert.deepEqual(report.unavailable.map(t => t.track_id), ['e']);
  assert.deepEqual(snapshot.tracks.find(t => t.track_id === 'c'), { ...first.tracks[2], status: 'removed', retained: false });
  assert.deepEqual(snapshot.tracks.find(t => t.track_id === 'b2').aliases, ['b']);
});
