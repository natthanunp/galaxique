/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit, paid smoke test of the real pipeline; never changes the running server.
// node --env-file=.env.local scripts/preview-thai-quiz.cjs <model-id> [count] [provider] [reasoning-effort]
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const [model, count = '1', provider = 'groq', reasoningEffort = 'default'] = process.argv.slice(2);
if (!model || !/^[1-5]$/.test(count)) throw new Error('Supply a model ID and a count from 1 to 5.');
process.env.OPENROUTER_THAI_QUIZ_MODEL = model;
if (reasoningEffort === 'default') delete process.env.OPENROUTER_THAI_QUIZ_REASONING_EFFORT;
else process.env.OPENROUTER_THAI_QUIZ_REASONING_EFFORT = reasoningEffort;
if (!/^[a-z0-9/-]+$/.test(provider)) throw new Error('Supply one provider slug.');
process.env.OPENROUTER_THAI_QUIZ_PROVIDER_ORDER = provider;
// Explicit transport selection; inherited server configuration cannot alter a comparison.
process.env.THAI_QUIZ_ENGINE = provider === 'typhoon' ? 'typhoon' : 'openrouter';
if (provider === 'typhoon' && model !== 'typhoon-v2.5-30b-a3b-instruct') {
  throw new Error('The Typhoon transport supports typhoon-v2.5-30b-a3b-instruct.');
}
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { generateBalancedQuiz } = require('../lib/quiz.ts');
// Only this synthetic-data preview can print generated batches, for reviewing
// prose that validation withheld. Production logging remains sanitized.
if (process.env.QUIZ_PREVIEW_CONTENT === 'true') {
  const llm = require('../lib/llm.ts');
  const originalCall = llm.callLlm;
  llm.callLlm = async options => {
    const result = await originalCall(options);
    console.log(JSON.stringify({ requestedIds: JSON.parse(options.userPrompt).requestedIds, batch: result }));
    return result;
  };
}
(async () => {
  const noncePrefix = process.env.QUIZ_PREVIEW_NONCE_PREFIX ?? 'thai-review';
  const startIndex = Number.parseInt(process.env.QUIZ_PREVIEW_START_INDEX ?? '0', 10);
  for (let offset = 0; offset < Number(count); offset++) {
    const index = startIndex + offset;
    const started = Date.now();
    try {
      const quiz = await generateBalancedQuiz({ language: 'th', avoidAngles: [], nonce: `${noncePrefix}-${index}` }, () => {});
      const { QUIZ_GENERATION_METRICS } = require('../lib/quiz.ts');
      console.log(JSON.stringify({ model, provider, reasoningEffort, elapsedMs: Date.now() - started, metrics: quiz[QUIZ_GENERATION_METRICS], quiz }));
    } catch (error) {
      const { QUIZ_GENERATION_METRICS } = require('../lib/quiz.ts');
      console.log(JSON.stringify({ model, provider, reasoningEffort, elapsedMs: Date.now() - started,
        metrics: error?.[QUIZ_GENERATION_METRICS], error: error.name }));
      process.exitCode = 1;
    }
  }
})();
