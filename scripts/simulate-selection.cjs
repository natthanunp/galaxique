/* eslint-disable @typescript-eslint/no-require-imports */
// Offline song-selection simulation. No network, no Redis, no LLM.
//   node scripts/simulate-selection.cjs [briefsPerLanguage=3000]
//   node scripts/simulate-selection.cjs --propose-golden   write data/golden/proposed.json for owner curation
// Writes docs/selection-simulation.json and prints a summary per language.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];

const { CONCEPTS } = require('../lib/conceptVocabulary.ts');
const { rankSongs, pickSong, shortlistSongs, eligibleForLanguage } = require('../lib/songMatching.ts');
const { knowledgeFileSchema, SELECTABLE_STATUSES } = require('../lib/catalogSchema.ts');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sample = (random, list, n) => Array.from({ length: n }, () => list[Math.floor(random() * list.length)]);

const ids = Object.keys(CONCEPTS);
const pool = (prefix) => ids.filter(id => prefix ? id.startsWith(prefix) : !id.startsWith('energy_')).flatMap(id => CONCEPTS[id].en);
const SETTINGS = ['night', 'daylight', 'rain', 'city', 'nature', 'party', 'drive', 'routine'].flatMap(id => CONCEPTS[id].en);
const ENERGY = pool('energy_');
const THEMES = pool();

/** Synthetic briefs in the assessment's shape: English tags, some fields empty. */
function syntheticBrief(random) {
  return {
    themes: sample(random, THEMES, 2 + Math.floor(random() * 3)),
    stance: sample(random, THEMES, Math.floor(random() * 3)),
    mood: sample(random, THEMES, 1 + Math.floor(random() * 2)),
    energy: random() < 0.8 ? sample(random, ENERGY, 1) : [],
    setting: random() < 0.6 ? sample(random, SETTINGS, 1) : [],
  };
}

function loadCatalog() {
  const approved = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog/approved.json'), 'utf8'));
  const knowledge = knowledgeFileSchema.parse(JSON.parse(fs.readFileSync(path.join(root, 'data/catalog/knowledge.json'), 'utf8')));
  const all = approved.tracks.filter(t => t.status === 'active').map(t => ({ track_id: t.track_id, name: t.name, artist: t.artist, knowledge: knowledge[t.track_id] }));
  const ineligible = new Map();
  const selectable = all.filter(t => {
    if (!t.knowledge) return ineligible.set(t.track_id, 'no knowledge entry'), false;
    if (!t.knowledge.known) return ineligible.set(t.track_id, 'knowledge marked unknown'), false;
    if (!SELECTABLE_STATUSES.has(t.knowledge.review_status)) return ineligible.set(t.track_id, `review_status ${t.knowledge.review_status}`), false;
    return true;
  });
  return { all, selectable, ineligible };
}

function gini(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length, sum = sorted.reduce((s, v) => s + v, 0);
  if (!n || !sum) return 0;
  return sorted.reduce((acc, v, i) => acc + (2 * (i + 1) - n - 1) * v, 0) / (n * sum);
}

function simulate(language, catalog, count) {
  const tracks = eligibleForLanguage(catalog.selectable, language);
  const random = rng(language === 'th' ? 7 : 11);
  const selected = new Map(), shortlisted = new Map(), bestRanks = new Map();
  const exposure = {};
  const recentGlobal = [];
  let repeats = 0, relevanceSum = 0, zeroBest = 0, shortlistSizes = 0;
  for (let i = 0; i < count; i++) {
    const ranked = rankSongs(tracks, syntheticBrief(random));
    ranked.forEach((r, rank) => bestRanks.set(r.track.track_id, Math.min(bestRanks.get(r.track.track_id) ?? Infinity, rank)));
    if (!ranked.length) continue;
    if (ranked[0].score === 0) zeroBest++;
    // Visitors usually arrive without history; a third have a few recent songs.
    const sessionRecent = random() < 0.33 ? recentGlobal.slice(-3) : [];
    const picked = pickSong(ranked, { seed: `${language}-${i}`, sessionRecent, exposure });
    const id = picked.track.track_id;
    shortlistSizes += picked.shortlist.length;
    for (const r of picked.shortlist) shortlisted.set(r.track.track_id, (shortlisted.get(r.track.track_id) ?? 0) + 1);
    if (recentGlobal.slice(-20).includes(id)) repeats++;
    recentGlobal.push(id);
    selected.set(id, (selected.get(id) ?? 0) + 1);
    relevanceSum += ranked[0].score ? picked.score / ranked[0].score : 1;
    for (const key of Object.keys(exposure)) exposure[key] *= 0.995;
    exposure[id] = (exposure[id] ?? 0) + 1;
  }
  const counts = tracks.map(t => selected.get(t.track_id) ?? 0);
  const top10 = [...counts].sort((a, b) => b - a).slice(0, 10).reduce((s, v) => s + v, 0);
  const neverCompetitive = tracks.filter(t => !shortlisted.has(t.track_id)).map(t => {
    const k = t.knowledge;
    const descriptorWords = [k.themes.join(' '), k.relationship_stance, k.mood, k.energy, k.setting].join(' ').split(/\s+/).filter(Boolean).length;
    return {
      track_id: t.track_id, name: t.name, artist: t.artist,
      reason: descriptorWords < 6 ? 'sparse descriptors' : 'descriptors rarely overlap synthetic briefs',
      best_rank: bestRanks.get(t.track_id) ?? null,
    };
  });
  const excludedByLanguage = catalog.selectable.length - tracks.length;
  return {
    language,
    briefs: count,
    eligible_pool: tracks.length,
    excluded_by_language: excludedByLanguage,
    avg_shortlist_size: +(shortlistSizes / count).toFixed(2),
    shortlist_inclusion: +(shortlisted.size / tracks.length).toFixed(3),
    selection_coverage: +(selected.size / tracks.length).toFixed(3),
    repeat_rate_last20: +(repeats / count).toFixed(3),
    top10_share: +(top10 / count).toFixed(3),
    gini: +gini(counts).toFixed(3),
    mean_relevance_vs_best: +(relevanceSum / count).toFixed(3),
    briefs_with_no_overlap: zeroBest,
    never_competitive: neverCompetitive,
    most_selected: [...selected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, n]) => { const t = tracks.find(x => x.track_id === id); return { name: t.name, artist: t.artist, share: +(n / count).toFixed(3) }; }),
  };
}

function goldenReport(catalog) {
  const file = path.join(root, 'data/golden/briefs.json');
  if (!fs.existsSync(file)) return null;
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  const results = {};
  for (const language of ['en', 'th']) {
    const cases = golden.filter(c => c.language === language && c.acceptable?.length);
    if (!cases.length) continue;
    const tracks = eligibleForLanguage(catalog.selectable, language);
    let hits = 0, shortlistHits = 0;
    for (const c of cases) {
      const ranked = rankSongs(tracks, c.brief);
      const picks = Array.from({ length: 20 }, (_, i) => pickSong(ranked, { seed: `${c.id}-${i}` })?.track.track_id);
      hits += picks.filter(id => c.acceptable.includes(id)).length / picks.length;
      shortlistHits += shortlistSongs(ranked).some(r => c.acceptable.includes(r.track.track_id)) ? 1 : 0;
    }
    results[language] = { cases: cases.length, pick_acceptable_rate: +(hits / cases.length).toFixed(3), shortlist_has_acceptable: +(shortlistHits / cases.length).toFixed(3) };
  }
  return results;
}

function proposeGolden(catalog) {
  const random = rng(2026);
  const cases = [];
  for (const language of ['en', 'th']) {
    const tracks = eligibleForLanguage(catalog.selectable, language);
    for (let i = 1; i <= 30; i++) {
      const brief = syntheticBrief(random);
      cases.push({
        id: `${language}-${String(i).padStart(2, '0')}`, language, brief,
        candidates: rankSongs(tracks, brief).slice(0, 10).map(r => ({ track_id: r.track.track_id, name: r.track.name, artist: r.track.artist })),
        acceptable: [],
      });
    }
  }
  fs.mkdirSync(path.join(root, 'data/golden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/golden/proposed.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('Wrote data/golden/proposed.json. Fill "acceptable" (any catalog track IDs), then save as data/golden/briefs.json.');
}

const catalog = loadCatalog();
if (process.argv.includes('--propose-golden')) {
  proposeGolden(catalog);
} else {
  const count = Number(process.argv[2]) || 3000;
  const report = {
    generated_at: new Date().toISOString(),
    catalog: { active: catalog.all.length, selectable: catalog.selectable.length, ineligible: [...catalog.ineligible].map(([id, reason]) => ({ track_id: id, reason })) },
    languages: ['th', 'en'].map(language => simulate(language, catalog, count)),
    golden: goldenReport(catalog),
  };
  fs.writeFileSync(path.join(root, 'docs/selection-simulation.json'), JSON.stringify(report, null, 2) + '\n');
  for (const r of report.languages) {
    const { never_competitive, most_selected, ...summary } = r;
    console.log(summary, `never competitive: ${never_competitive.length}`, `top: ${most_selected.slice(0, 3).map(s => `${s.name} ${s.share}`).join(', ')}`);
  }
  console.log('catalog:', { active: report.catalog.active, selectable: report.catalog.selectable }, 'golden:', report.golden ?? 'none yet');
}
