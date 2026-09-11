// Local-only fixtures: block API mutations, notifications and external services.
// PLAYWRIGHT_MODULE may point at an existing installation; no app dependency added.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const label = process.argv[2] || 'after';
const out = `artifacts/galaxy/${label}`;
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome', headless:true});
const results=[];
const base={vibe:'mysterious',celestial_type:'galaxy',central_symbol:'none',primary_color:'#8b7ce8',secondary_color:'#e7ae80',rotation_speed:0.3,particle_density:'high',spotify_search_query:'fixture',personality_reading:'You find beauty in the quiet spaces. Your curiosity lights the way. A universe of possibility awaits.',creature:{kind:'fox',accent:'none',motion:'orbit',name:'Lumi'}};
for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
 const context=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:true});
 await context.route('**/api/**',route=>route.fulfill({json:{success:true,stars:[],stats:{total:6,cute:1,cozy:1,mysterious:1,intense:1,whimsical:1,cynical:1},track:null}}));
 for(const scene of (process.env.VIDEO ? ['galaxy'] : ['home','galaxy','black_hole','neutron_star'])) {
  for(let run=0;run<3;run++) {
   const page=await context.newPage();
   await page.addInitScript(({reveal})=>{
    localStorage.setItem('galaxique-quiz',JSON.stringify({version:1,state:{language:'en',reveal,questions:[],answers:[]}}));
    let seed=42; Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    window.__draws=0; window.__drawSamples=[];
    for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {const orig=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.__draws++;return orig.apply(this,args)}}
   },{reveal:{...base,celestial_type:scene==='home'?'galaxy':scene}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:3000/${scene==='home'?'':'reveal'}`);
   await page.waitForFunction(()=>document.querySelectorAll('canvas').length>0);
   if(scene!=='home') await page.getByRole('button',{name:'Share to Story',exact:true}).waitFor();
   await page.waitForTimeout(2200);
   const metrics=await page.evaluate(async()=>{
    const frames=[],draws=[];let last=performance.now();window.__draws=0;
    await new Promise(resolve=>{const tick=t=>{frames.push(t-last);last=t;draws.push(window.__draws);window.__draws=0;if(frames.length<120)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});
    frames.shift();draws.shift();frames.sort((a,b)=>a-b);draws.sort((a,b)=>a-b);
    return {fps:1000/frames[Math.floor(frames.length/2)],p95Ms:frames[Math.floor(frames.length*.95)],drawCalls:draws[Math.floor(draws.length/2)],loadMs:performance.getEntriesByType('navigation')[0].loadEventEnd,canvasCount:document.querySelectorAll('canvas').length};
   });
   if(run===0) await page.screenshot({path:`${out}/${viewport.width}-${scene}.png`});
   if(scene==='galaxy' && !process.env.VIDEO){
    await page.getByRole('button',{name:'Share to Story',exact:true}).click();
    const start=Date.now();await page.getByRole('button',{name:'Save photo',exact:true}).click();
    try {await page.locator('img[src^="blob:"]').waitFor({timeout:30000});metrics.photoMs=Date.now()-start;if(run===0)await page.screenshot({path:`${out}/${viewport.width}-photo-preview.png`});}catch{metrics.photoError=await page.locator('[role="dialog"]').innerText()}
   }
   if(process.env.VIDEO) {
    await page.getByRole('button',{name:'Share to Story',exact:true}).click();const start=Date.now();await page.getByRole('button',{name:'Save MP4 video',exact:true}).click();
    try{await page.locator('video[src^="blob:"]').waitFor({timeout:90000});metrics.videoMs=Date.now()-start;if(run===0){await page.locator('video').evaluate(v=>{v.pause();v.currentTime=4});await page.waitForTimeout(200);await page.screenshot({path:`${out}/${viewport.width}-video-preview.png`});}}catch{metrics.videoError=await page.locator('[role="dialog"]').innerText()}
   }
   const entry={viewport,scene,run,...metrics,errors};results.push(entry);console.log(JSON.stringify(entry));
   await writeFile(`${out}/metrics.json`,JSON.stringify(results,null,2));await page.close();
  }
 }
 await context.close();
}
await browser.close();
