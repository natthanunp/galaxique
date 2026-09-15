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
stub('lib/songSelectionStore.ts', { getRecentSelections: async () => ({ trackIds: [], source: 'memory' }), recordSelection: async id => selections.push(id) });
let catalog = [];
stub('lib/spotify.ts', { spotifyConfigured: () => true, getSpotifyPlaylistTracks: async () => catalog });
stub('lib/songKnowledge.ts', { enrichPlaylistTracks: async tracks => tracks });
stub('lib/constellationStore.ts', { addStar: async star => stars.push(star) });
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
const { THEMES, CELESTIAL_TYPES, THEME_VIBE, profileLabel } = require('../lib/profile.ts');
const { ASSESSMENT_PROMPT, ASSESSMENT_REPAIR_PROMPT, validateAssessment, selectProfile, analyzeBodySchema } = require('../lib/profileAssessment.ts');
const { validQuizQuestion, questionRejectionReasons, shuffleOptions, generateBalancedQuiz, buildBalancedQuizPrompt, createScenarioPlan, QUIZ_TOPICS, QUIZ_GENERATION_METRICS, DEFAULT_THAI_QUIZ_MODEL, DEFAULT_THAI_QUIZ_PROVIDER } = require('../lib/quiz.ts');
const { rankSongs, selectSong } = require('../lib/songMatching.ts');
const { runAnalyze } = require('../lib/analyze.ts');
const { incrementProfileStat, getProfileStats } = require('../lib/profileStatsStore.ts');
const { sanitizeLlmError, LlmRequestError } = require('../lib/llmError.ts');
const { buildCreatureChatPrompt } = require('../prompts/creatureChatPrompt.ts');
const { withRequestDeadline } = require('../lib/requestDeadline.ts');
const { callTyphoonQuiz, TYPHOON_QUIZ_MODEL } = require('../lib/typhoonQuiz.ts');
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

test('Typhoon transport makes one JSON request and sanitizes failures without retries', async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.TYPHOON_API_KEY;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TYPHOON_API_KEY;
    else process.env.TYPHOON_API_KEY = originalKey;
  });
  process.env.TYPHOON_API_KEY = 'fixture-key';
  const options = { systemPrompt: 'fixture-system', userPrompt: 'fixture-user', maxTokens: 3200, timeoutMs: 1000 };
  let requests = 0;
  global.fetch = async (url, init) => {
    requests++;
    assert.equal(url, 'https://api.opentyphoon.ai/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.model, TYPHOON_QUIZ_MODEL);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 3200);
    return Response.json({ choices: [{ message: { content: '{"questions":[]}' } }] });
  };
  assert.deepEqual(await callTyphoonQuiz(options), { questions: [] });
  assert.equal(requests, 1);
  global.fetch = async () => { requests++; return new Response('private upstream body', { status: 429 }); };
  await assert.rejects(callTyphoonQuiz(options), error => error.statusCode === 429 && !error.message.includes('private'));
  assert.equal(requests, 2, '429 must not trigger hidden retries');
  global.fetch = async () => Response.json({ choices: [{ message: { content: 'not JSON' } }] });
  await assert.rejects(callTyphoonQuiz(options), error => error.kind === 'non_json');
  let abortedSignal;
  global.fetch = async (_, init) => { abortedSignal = init.signal; return new Promise(() => {}); };
  await assert.rejects(callTyphoonQuiz({ ...options, timeoutMs: 10 }), { name: 'TimeoutError' });
  assert.equal(abortedSignal.aborted, true);
});

test('Thai Typhoon selection uses the same complete-quiz pipeline with no OpenRouter fallback', async t => {
  const originalFetch = global.fetch;
  const originalEngine = process.env.THAI_QUIZ_ENGINE;
  const originalKey = process.env.TYPHOON_API_KEY;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of [['THAI_QUIZ_ENGINE', originalEngine], ['TYPHOON_API_KEY', originalKey]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.THAI_QUIZ_ENGINE = 'typhoon';
  delete process.env.TYPHOON_API_KEY;
  calls = [];
  await assert.rejects(generateBalancedQuiz({ language: 'th', avoidAngles: [] }, () => {}), /TYPHOON_API_KEY/);
  assert.equal(calls.length, 0);
  process.env.TYPHOON_API_KEY = 'fixture-key';
  const pending = [];
  global.fetch = (_, init) => new Promise(resolve => pending.push({ body: JSON.parse(init.body), resolve }));
  const result = generateBalancedQuiz({ language: 'th', avoidAngles: [] }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2, 'initial batches must be concurrent');
  for (const { body, resolve } of pending) {
    const ids = JSON.parse(body.messages[1].content).requestedIds;
    resolve(Response.json({ choices: [{ message: { content: JSON.stringify({ questions: ids.map(thaiQuestion) }) } }] }));
  }
  assert.equal((await result).questions.length, 8);
  assert.equal(calls.length, 0);
  let failedRequests = 0;
  global.fetch = async () => { failedRequests++; return new Response('', { status: 429 }); };
  await assert.rejects(generateBalancedQuiz({ language: 'th', avoidAngles: [] }, () => {}), /eight valid fresh questions/);
  assert.equal(failedRequests, 6, 'only initial calls and two targeted repair rounds are permitted');
  assert.equal(calls.length, 0, 'a Typhoon outage must never fall back to OpenRouter');
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
const englishQuestion = (id, overrides = {}) => ({
  id,
  topic: QUIZ_TOPICS[id - 1],
  setting: `distinct setting ${id}`,
  angle: `Angle ${id}`,
  text: `In situation ${id}, what do you do?`,
  options: ['Ask a friend', 'Consider the options', 'Try something new', 'Make a plan'].map(text => ({ text })),
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
  options: [
    'หยุดคิดสักครู่แล้วจัดลำดับสิ่งสำคัญใหม่',
    'ชวนคนที่เกี่ยวข้องมาคุยแล้วหาทางออกร่วมกัน',
    'ลองปรับแผนทันทีแล้วค่อยแก้รายละเอียดระหว่างทาง',
    'เก็บข้อมูลที่มีให้ครบก่อนตัดสินใจเลือกวิธีใหม่',
  ].map(text => ({ text })),
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
test('question validation rejects bad scripts, overlong or duplicate options; shuffle preserves texts and IDs', () => {
  const q = englishQuestion(1);
  assert.equal(validQuizQuestion(q, 'en'), true);
  assert.equal(validQuizQuestion({ ...q, text: 'When two important plans overlap unexpectedly, how do you decide which commitment deserves your attention first today?' }, 'en'), true);
  assert.equal(validQuizQuestion({ ...q, options: [{ text: 'Ask a trusted friend for another perspective' }, ...q.options.slice(1)] }, 'en'), true);
  assert.equal(validQuizQuestion({ ...q, options: Array(4).fill({ text: 'same' }) }, 'en'), false);
  const thai = {
    ...q,
    setting: 'a difficult household task',
    text: 'เจองานยากที่ต้องรีบจัดการ คุณจะเริ่มยังไง?',
    options: [
      'ถามเพื่อนให้ช่วยมองอีกมุมหนึ่ง',
      'คิดภาพรวมให้ชัดก่อนค่อยลงมือ',
      'ลองวิธีใหม่แล้วค่อยปรับไประหว่างทาง',
      'วางแผนเป็นขั้นตอนแล้วทำทีละส่วน',
    ].map(text => ({ text })),
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
  assert.equal(validQuizQuestion({ ...thai, options: [{ text: 'ฟังเพลงที่ชอบ' }, ...thai.options.slice(1)] }, 'th'), true);
  assert.equal(validQuizQuestion({ ...thai, id: 2, options: [{ text: 'ไม่ทำอะไรเลยสักพัก' }, ...thai.options.slice(1)] }, 'th'), true);
  assert.equal(validQuizQuestion({ ...thai, id: 5, options: [{ text: 'ไม่ทำอะไรเลยสักพัก' }, ...thai.options.slice(1)] }, 'th'), false);
  assert.ok(questionRejectionReasons({ ...thai, options: [{ text: 'ฟัง' }, ...thai.options.slice(1)] }, 'th').some(reason => reason.startsWith('option_1_too_short(actual=')));
  assert.equal(validQuizQuestion({ ...thai, options: [{ text: 'สุ่มเลือกไปเลย' }, ...thai.options.slice(1)] }, 'th'), false);
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
        options: question.options.map(option => option.text),
      }
    : question));
  deferred[1].resolve(questionsFor(deferred[1].options, (question, id) => id === 8
    ? { ...question, options: Array(4).fill({ text: 'Same choice' }) }
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
  assert.ok(buildBalancedQuizPrompt('th', [8], true).includes('ตัวเลือกละ 8–48'));
  assert.ok(calls.every(c => c.singleAttempt && c.allowProviderFallbacks === false));
  assert.ok(calls.slice(0, 2).every(c => c.timeoutMs <= 12000));
  assert.ok(calls.slice(2).every(c => c.timeoutMs <= 8000));
  assert.ok(calls.every(c => c.reasoningEffort === 'low'));
  assert.ok(calls.every(c => c.model === 'openai/gpt-oss-20b'));
  assert.deepEqual(calls[0].providerOrder, ['groq']);
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
    providers: ['groq'],
    finishReasons: ['stop'],
  });
  calls = []; responder = () => ({ questions: [] });
  await assert.rejects(generateBalancedQuiz({ language: 'en', avoidAngles: [] }, () => {}), /eight valid fresh questions/);
  assert.equal(calls.length, 6);
  assert.ok(calls[2].maxTokens > calls[0].maxTokens / 2);
});
test('provider failures repair on the same model and provider without fallback or hidden retries', async () => {
  calls = [];
  responder = options => {
    if (requestedIds(options)[0] === 1 && calls.length <= 2) throw new LlmRequestError(429, 'groq');
    return questionsFor(options);
  };
  const result = await generateBalancedQuiz({ language: 'en', avoidAngles: [] }, () => {});
  assert.equal(result.questions.length, 8);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.singleAttempt));
  assert.ok(calls.every(call => call.allowProviderFallbacks === false));
  assert.ok(calls.every(call => call.providerIgnore === undefined));
  assert.ok(calls.every(call => call.model === calls[0].model));
  assert.ok(calls.every(call => JSON.stringify(call.providerOrder) === JSON.stringify(calls[0].providerOrder)));
});
test('Thai model settings select DeepSeek V4 without changing generic model settings and honor overrides', async t => {
  const names = ['OPENROUTER_THAI_QUIZ_MODEL', 'OPENROUTER_THAI_QUIZ_PROVIDER_ORDER', 'OPENROUTER_THAI_QUIZ_REASONING_EFFORT'];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (originals[name] === undefined) delete process.env[name];
      else process.env[name] = originals[name];
    }
  });
  for (const name of names) delete process.env[name];
  calls = [];
  responder = options => languageQuestionsFor(options);
  await generateBalancedQuiz({ language: 'th', avoidAngles: [], nonce: 'selected-default' }, () => {});
  assert.ok(calls.every(call => call.model === DEFAULT_THAI_QUIZ_MODEL));
  assert.ok(calls.every(call => JSON.stringify(call.providerOrder) === JSON.stringify([DEFAULT_THAI_QUIZ_PROVIDER])));
  assert.ok(calls.every(call => call.reasoningEffort === 'none'));

  process.env.OPENROUTER_THAI_QUIZ_MODEL = 'qwen/qwen3-30b-a3b-instruct-2507';
  process.env.OPENROUTER_THAI_QUIZ_PROVIDER_ORDER = 'alibaba';
  delete process.env.OPENROUTER_THAI_QUIZ_REASONING_EFFORT;
  calls = [];
  await generateBalancedQuiz({ language: 'th', avoidAngles: [], nonce: 'reasoning-default' }, () => {});
  assert.ok(calls.every(call => call.reasoningEffort === undefined));
  assert.ok(calls.every(call => call.model === 'qwen/qwen3-30b-a3b-instruct-2507'));
  assert.ok(calls.every(call => JSON.stringify(call.providerOrder) === JSON.stringify(['alibaba'])));
  process.env.OPENROUTER_THAI_QUIZ_REASONING_EFFORT = 'none';
  calls = [];
  await generateBalancedQuiz({ language: 'th', avoidAngles: [], nonce: 'reasoning-none' }, () => {});
  assert.ok(calls.every(call => call.reasoningEffort === 'none'));
});
test('provider outage never substitutes static questions for a fresh AI quiz', async () => {
  calls = [];
  responder = () => { throw new LlmRequestError(undefined, undefined, true); };
  await assert.rejects(generateBalancedQuiz({ language: 'en', avoidAngles: [] }, () => {}), /eight valid fresh questions/);
  assert.equal(calls.length, 6);
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
test('full catalog relevance wins; session/global variety cannot rescue a weak match', () => {
  const best = track('best'), near = track('near'), weak = track('weak', { themes: ['heartbreak'], mood: 'melancholy' });
  const ranked = [{ track: best, score: 55 }, { track: near, score: 52 }, { track: weak, score: 10 }];
  assert.equal(selectSong(ranked, [], Array(50).fill('best')).track.track_id, 'best');
  assert.equal(selectSong(ranked, ['best'], []).track.track_id, 'near');
  assert.notEqual(selectSong(ranked, ['best', 'near'], []).track.track_id, 'weak');
  const brief = { themes: ['perseverance'], stance: ['independence'], mood: ['determined'], energy: ['driving'], setting: [] };
  const pool = Array.from({ length: 40 }, (_, i) => track(`weak${i}`, { themes: ['heartbreak'], relationship_stance: 'yearning', mood: 'melancholy', energy: 'still' }));
  pool.push(best);
  assert.equal(rankSongs(pool, brief)[0].track.track_id, 'best');
  assert.deepEqual(rankSongs([best], brief), rankSongs([track('best', { vibe: 'cozy', celestial_affinity: ['galaxy'] })], brief).map(r => ({ ...r, track: best })));
  assert.equal(selectSong([], [], []), undefined);
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
  assert.match(result.reveal_id, /^[a-f0-9-]{36}$/); assert.equal(stars.at(-1).songArtist, 'Test Artist');
  assert.equal(stars.at(-1).theme, 'driven'); assert.equal(selections.at(-1), 'one');
});
test('invalid assessment retries once and never writes a creative default', async () => {
  calls = []; responder = () => ({ answers: [], song_brief: emptyBrief() }); catalog = [track('one')];
  await assert.rejects(runAnalyze({ answers: fixture('driven', 'neutron_star').answers }, () => {}));
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.purpose === 'assessment'));
  assert.ok(!calls[0].systemPrompt.includes(ASSESSMENT_REPAIR_PROMPT));
  assert.ok(calls[1].systemPrompt.includes(ASSESSMENT_REPAIR_PROMPT));
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
  assert.equal(failedQuiz.headers.get('x-quiz-request-count'), '6');
  assert.equal(failedQuiz.headers.get('x-quiz-failed-requests'), '6');
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
