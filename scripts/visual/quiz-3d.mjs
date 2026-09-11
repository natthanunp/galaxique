import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const out='artifacts/galaxy/quiz-3d';await mkdir(out,{recursive:true});const report=[];
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,hasTouch:width===390,isMobile:width===390,serviceWorkers:'block'});
 let questionsReady,analysisReady;
 const questionGate=new Promise(resolve=>questionsReady=resolve),analysisGate=new Promise(resolve=>analysisReady=resolve);
 const questions=Array.from({length:8},(_,i)=>({id:i+1,text:`Where do you find wonder? ${i+1}`,options:['Stars','Sea','Forest','Home'].map(text=>({text}))}));
 const reveal={vibe:'cozy',celestial_type:'galaxy',central_symbol:'none',primary_color:'#edb570',secondary_color:'#829fcf',rotation_speed:.3,particle_density:'medium',spotify_search_query:'fixture',personality_reading:'Your curiosity lights the way. You find beauty in quiet places. A universe awaits.'};
 await context.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('generate-quiz')){await questionGate;return r.fulfill({json:{questions,pickedAngles:[]}})}
  if(path.endsWith('analyze')){await analysisGate;return r.fulfill({json:reveal})}
  return r.fulfill({json:{success:true,stars:[],stats:{total:0},track:null}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('galaxique-quiz',JSON.stringify({version:1,state:{language:'en',reveal:null,questions:[],answers:[]}}));
  window.__draws=0;for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const fn=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.__draws++;return fn.apply(this,args)}}
 });
 await page.goto('http://127.0.0.1:3000/quiz');await page.getByText('Preparing your questions…',{exact:true}).waitFor();await page.waitForFunction(()=>window.__draws>14);
 await page.evaluate(()=>{window.__quizCanvas=document.querySelector('canvas')});
 async function check(stage){
  const start=await page.evaluate(()=>window.__draws);await page.waitForTimeout(650);const draws=await page.evaluate(()=>window.__draws)-start;
  const sameCanvas=await page.evaluate(()=>document.querySelector('canvas')===window.__quizCanvas);
  const count=await page.locator('canvas').count();assert.ok(draws>0,`${stage}: must animate`);assert.equal(count,1);assert.ok(sameCanvas);
  await page.screenshot({path:`${out}/${width}-${stage}.png`});return {stage,draws,sameCanvas,count};
 }
 const stages=[await check('loading-questions')];questionsReady();await page.getByText('Where do you find wonder? 1',{exact:true}).waitFor();stages.push(await check('questionnaire'));
 for(let i=1;i<=8;i++){
  await page.getByText(`Where do you find wonder? ${i}`,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Stars',exact:false}).click();
  await page.getByRole('button',{name:i===8?'Reveal my universe':'Next',exact:true}).click();
 }
 await page.locator('[role="status"]').first().waitFor();stages.push(await check('loading-result'));analysisReady();await page.waitForURL('**/reveal');await page.getByRole('button',{name:'Share to Story',exact:true}).waitFor();
 await page.goto('http://127.0.0.1:3000/constellation');await page.waitForFunction(()=>window.__draws>14);const start=await page.evaluate(()=>window.__draws);await page.waitForTimeout(500);const constellation3D=await page.evaluate(()=>window.__draws)>start;assert.ok(constellation3D);
 report.push({width,stages,reachedReveal:true,constellation3D,errors});console.log(JSON.stringify(report.at(-1)));await context.close();
}
await writeFile('docs/galaxy/quiz-3d.json',JSON.stringify(report,null,2));await browser.close();
