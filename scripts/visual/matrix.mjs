import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/galaxy/review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const vibes=['cute','cozy','mysterious','intense','whimsical','cynical'];
const colors=['#f472b6','#fbbf77','#887bdd','#ed7659','#72cfba','#94a3b8'];
const creatures=['bird','cat','dragon','fish','fox','jelly','spirit'];
const types=['galaxy','black_hole','neutron_star'];
const reveal={vibe:'mysterious',celestial_type:'galaxy',central_symbol:'none',primary_color:'#887bdd',secondary_color:'#e7ae80',rotation_speed:.3,particle_density:'high',spotify_search_query:'fixture',personality_reading:'You find beauty in the quiet spaces. Your curiosity lights the way. A universe of possibility awaits.'};
const questions=Array.from({length:8},(_,i)=>({id:i+1,text:`Where does your curiosity take you? ${i+1}`,options:['Among the stars','Into the forest','Beside the sea','Somewhere new'].map(text=>({text}))}));
const stars=Array.from({length:24},(_,i)=>({id:`fixture-${i}`,vibe:vibes[i%6],celestialType:types[i%3],creatureKind:creatures[i%7],creatureName:'Lumi',primaryColor:colors[i%6],secondaryColor:'#e7ae80',readingSnippet:reveal.personality_reading,songName:'A quiet sky',songArtist:'Local fixture',createdAt:0}));
const report=[];
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,serviceWorkers:'block',hasTouch:width===390,isMobile:width===390});
 await context.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('generate-quiz')?{questions,pickedAngles:[]}:{success:true,stars,stats:{total:24,...Object.fromEntries(vibes.map(v=>[v,4]))},track:null}}));
 async function pageFor(path,custom={},language="en"){
  const page=await context.newPage();const errors=[];const failed=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${r.url()}`)});
  await page.addInitScript(({reveal,language})=>localStorage.setItem('galaxique-quiz',JSON.stringify({version:1,state:{language,reveal,questions:[],answers:[]}})),{reveal:{...reveal,...custom},language});
  await page.goto(`http://127.0.0.1:3000/${path}`);await page.waitForTimeout(1600);
  return {page,errors,failed};
 }
 for(const path of ['','quiz','constellation']){
  const {page,errors,failed}=await pageFor(path);
  if(path==='quiz')await page.getByText('Where does your curiosity take you? 1',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/${width}-${path||'home'}.png`,fullPage:true});
  report.push({width,path,errors,failed,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  await page.close();
 }
 const thai=await pageFor('quiz',{},'th');await thai.page.screenshot({path:`${out}/${width}-thai-quiz.png`});await thai.page.close();
 for(let ti=0;ti<3;ti++)for(let vi=0;vi<6;vi++){
  const kind=creatures[(ti*6+vi)%7];const key=`${width}-${types[ti]}-${vibes[vi]}-${kind}`;
  const {page,errors,failed}=await pageFor('reveal',{vibe:vibes[vi],celestial_type:types[ti],primary_color:colors[vi],creature:{kind,accent:'none',motion:kind==='fish'?'swim':kind==='bird'||kind==='dragon'?'fly':'orbit',name:kind}});
  await page.getByRole('button',{name:'Share to Story',exact:true}).waitFor();
  await page.waitForTimeout(700);await page.screenshot({path:`${out}/${key}.png`});
  if(vi===0 && width===1440){await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(950,550,{steps:15});await page.mouse.up();await page.screenshot({path:`${out}/${key}-orbit.png`});}
  if(ti===0){await page.waitForTimeout(1000);await page.screenshot({path:`${out}/${key}-animation.png`});}
  if(width===390){await page.mouse.wheel(0,600);await page.waitForTimeout(100);}
  report.push({width,key,errors,failed,scrollY:await page.evaluate(()=>scrollY),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  await page.close();
 }
 // Motion preference changes must freeze both renderers and preserve resizing.
 const {page}=await pageFor('reveal');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);
 const still=await page.screenshot();await page.waitForTimeout(500);const still2=await page.screenshot();
 report.push({width,reducedMotionPixelsStable:still.equals(still2)});
 await page.setViewportSize({width:width===390?844:1100,height:width===390?390:740});await page.screenshot({path:`${out}/${width}-resize-reduced.png`});await page.close();
 const fallback=await context.newPage();await fallback.route('**/assets/galaxy/**',r=>r.abort());await fallback.goto('http://127.0.0.1:3000/');await fallback.waitForTimeout(700);await fallback.screenshot({path:`${out}/${width}-missing-assets.png`});
 report.push({width,fallbackContent:await fallback.locator('h1').innerText()});await fallback.close();
 await context.close();await writeFile(`${out}/checks.json`,JSON.stringify(report,null,2));
}
await browser.close();
