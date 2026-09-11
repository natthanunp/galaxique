import { createRequire } from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];const out='artifacts/galaxy/homepage-3d';await mkdir(out,{recursive:true});
for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,hasTouch:width===390,isMobile:width===390,serviceWorkers:'block'});
 await context.route('**/api/**',r=>r.fulfill({json:{success:true,stats:{total:0},questions:[],pickedAngles:[]}}));
 for(let run=0;run<3;run++){
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('THREE'))errors.push(m.text())});
  await page.addInitScript(()=>{window.__draws=0;for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.__draws++;return original.apply(this,args)}}});
  await page.goto('http://127.0.0.1:3000/');await page.waitForFunction(()=>window.__draws>10);await page.waitForTimeout(2200);
  const metrics=await page.evaluate(async()=>{const times=[];let last=performance.now();const draws=window.__draws;await new Promise(resolve=>{const tick=t=>{times.push(t-last);last=t;if(times.length<120)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});times.shift();times.sort((a,b)=>a-b);return {fps:1000/times[59],p95Ms:times[113],drawCallsPerFrame:(window.__draws-draws)/120,loadMs:performance.getEntriesByType('navigation')[0].loadEventEnd}});
  if(run===0){
   const before=await page.screenshot({path:`${out}/${width}-initial.png`});
   await page.mouse.move(width*.9,100);await page.waitForTimeout(2000);const after=await page.screenshot({path:`${out}/${width}-motion.png`});
   metrics.visibleMotion=!before.equals(after);
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(600);const count=await page.evaluate(()=>window.__draws);await page.waitForTimeout(400);metrics.reducedMotionPaused=count===await page.evaluate(()=>window.__draws);
   await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(100);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(100);const hidden=await page.evaluate(()=>window.__draws);await page.waitForTimeout(300);metrics.hiddenPaused=hidden===await page.evaluate(()=>window.__draws);
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
   metrics.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   await page.locator('a[href="/quiz"]').click();await page.waitForURL('**/quiz');metrics.navigation=true;
  }
  results.push({width,run,...metrics,errors});console.log(JSON.stringify(results.at(-1)));await page.close();
 }
 await context.close();
}
await writeFile('docs/galaxy/homepage-3d.json',JSON.stringify(results,null,2));await browser.close();
