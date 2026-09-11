// Exercise device classification and cooldown recovery without a GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const loadDependency = createRequire(import.meta.url);
function load(file, globals = {}, aliases = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => aliases[name] || loadDependency(name), ...globals });
  return exports;
}
function device({ width = 1440, ua = 'Chrome/140', touch = false, cores = 8, ram = 8 } = {}) {
  return load('lib/perf.ts', { window: { innerWidth: width, devicePixelRatio: 3 }, navigator: { userAgent: ua, maxTouchPoints: touch ? 5 : 0, hardwareConcurrency: cores, deviceMemory: ram } });
}
assert.equal(device().initialQualityTier(), 'high');
const capableIPhone = device({ width: 390, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Mobile/15E148 Safari/604.1', touch: true, cores: 6 });
assert.equal(capableIPhone.initialQualityTier(), 'high', 'narrow modern iPhones should not be classified as low-power');
assert.equal(capableIPhone.targetDpr(), 2);
assert.equal(device({ width: 430, ua: 'Android 13; Mobile', touch: true, cores: 8, ram: 8 }).initialQualityTier(), 'high', 'capable modern Android should start high');
assert.equal(device({ width: 430, ua: 'Android 13; Mobile', touch: true, cores: 6, ram: 4 }).initialQualityTier(), 'medium');
assert.equal(device({ width: 430, ua: 'Android 9; Mobile', touch: true }).initialQualityTier(), 'low');
assert.equal(device({ width: 390, touch: true, cores: 4 }).initialQualityTier(), 'low');
assert.equal(device({ ua: 'Firefox/140' }).initialQualityTier(), 'medium');
const perf = device();
assert.equal(perf.tierDprCap('low', 1.5), 1);
assert.equal(perf.tierDprCap('medium', 1.5), 1.25);
assert.ok(perf.tierParticleMultiplier('low') < perf.tierParticleMultiplier('medium'));
let now = 0;
const { usePerfStore } = load('store/perfStore.ts', { performance: { now: () => now } }, { '@/lib/perf': perf });
usePerfStore.getState().initialize();
usePerfStore.getState().downgrade();assert.equal(usePerfStore.getState().tier, 'high');
now = 8001;usePerfStore.getState().downgrade();assert.equal(usePerfStore.getState().tier, 'medium');
usePerfStore.getState().downgrade();assert.equal(usePerfStore.getState().tier, 'medium', 'cooldown prevents oscillation');
now = 16002;usePerfStore.getState().downgrade();assert.equal(usePerfStore.getState().tier, 'low');
now = 24003;usePerfStore.getState().upgrade();assert.equal(usePerfStore.getState().tier, 'medium');
now = 32004;usePerfStore.getState().upgrade();assert.equal(usePerfStore.getState().tier, 'high');
console.log('PASS: device classification, DPR/particle budgets, tier downgrade, cooldown and recovery');
