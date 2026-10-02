/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit, paid smoke test of the real pipeline with the shared model in config/models.ts.
// node --env-file=.env.local scripts/preview-thai-quiz.cjs [count]
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const [count = '1'] = process.argv.slice(2);
if (!/^[1-5]$/.test(count)) throw new Error('Supply a count from 1 to 5.');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { generateBalancedQuiz } = require('../lib/quiz.ts');
const { SHARED_MODEL, TASKS } = require('../config/models.ts');
const model = SHARED_MODEL.model;
const provider = SHARED_MODEL.providers.join(',');
const reasoningEffort = TASKS.quiz.reasoningEffort;
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
