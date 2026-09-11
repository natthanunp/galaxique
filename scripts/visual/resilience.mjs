import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
const out='artifacts/galaxy/review';await mkdir(out,{recursive:true});
const reveal={vibe:'cozy',celestial_type:'galaxy',central_symbol:'heart',primary_color:'#edb570',secondary_color:'#829fcf',rotation_speed:.3,particle_density:'high',spotify_search_query:'fixture',personality_reading:'You find beauty in the quiet spaces. Your curiosity lights the way. A universe of possibility awaits.',creature:{kind:'fish',accent:'none',motion:'swim',name:'Lumi'}};
const questions=Array.from({length:8},(_,i)=>({id:i+1,text:`A quiet sky ${i+1}`,options:['Stars','Sea','Forest','Home'].map(text=>({text}))}));
const calls=[];
await context.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;calls.push(path);return r.fulfill({json:path.endsWith('generate-quiz')?{questions,pickedAngles:[]}:path.endsWith('analyze')?reveal:{success:true,stars:[],stats:{total:0},track:null}})});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 localStorage.setItem('galaxique-quiz',JSON.stringify({version:1,state:{language:'en',reveal:null,questions:[],answers:[]}}));
 window.__draws=0;
 for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const orig=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.__draws++;return orig.apply(this,args)}}
 window.__paints=0;
 const orig=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(...args){if(this.canvas.isConnected)window.__paints++;return orig.apply(this,args)};
});
await page.goto('http://127.0.0.1:3000/quiz');
for(let i=1;i<=8;i++){
 await page.getByText(`A quiet sky ${i}`,{exact:true}).waitFor();
 await page.getByRole('button',{name:'Stars',exact:false}).click();
 await page.getByRole('button',{name:i===8?'Reveal my universe':'Next',exact:true}).click();
}
await page.waitForURL('**/reveal');await page.getByRole('button',{name:'Share to Story',exact:true}).waitFor();
await page.waitForTimeout(1200);
await page.mouse.wheel(0,550);await page.waitForTimeout(200);
const scroll=await page.evaluate(()=>({y:scrollY,canvasPointerEvents:getComputedStyle(document.querySelector('canvas')).pointerEvents}));
await page.getByRole('button',{name:'Share to Story',exact:true}).click();await page.getByRole('button',{name:'Save photo',exact:true}).click();
await page.locator('img[src^="blob:"]').waitFor({timeout:30000});
const photo=await page.locator('img[src^="blob:"]').evaluate(async img=>({size:(await(await fetch(img.src)).blob()).size,width:img.naturalWidth,height:img.naturalHeight}));
await page.screenshot({path:`${out}/390-photo-preview.png`});
await page.getByRole('button',{name:'Close',exact:true}).first().click();
await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(1500);
const drawStart=await page.evaluate(()=>window.__draws);await page.waitForTimeout(500);const drawEnd=await page.evaluate(()=>window.__draws);
const revealReducedMotionPaused=drawStart===drawEnd;
await page.emulateMedia({reducedMotion:'no-preference'});
// All page backgrounds now use WebGL; verify the quiz scene pauses and resumes.
await page.goto('http://127.0.0.1:3000/quiz');await page.waitForTimeout(800);
await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);
const reducedStart=await page.evaluate(()=>window.__draws);await page.waitForTimeout(300);const reducedEnd=await page.evaluate(()=>window.__draws);
await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(100);
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
await page.waitForTimeout(100);const hiddenStart=await page.evaluate(()=>window.__draws);await page.waitForTimeout(300);const hiddenEnd=await page.evaluate(()=>window.__draws);
await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(150);const resumed=await page.evaluate(()=>window.__draws);
// Missing local assets and browsers without ImageBitmap keep a usable reveal/export.
const fallback=await context.newPage();const fallbackErrors=[];
fallback.on('pageerror',e=>fallbackErrors.push(e.message));
await fallback.addInitScript(reveal=>{
 localStorage.setItem('galaxique-quiz',JSON.stringify({version:1,state:{language:'en',reveal,questions:[],answers:[]}}));
 Object.defineProperty(window,'createImageBitmap',{value:undefined,configurable:true});
},reveal);
await fallback.route('**/assets/galaxy/**',r=>r.abort());
await fallback.route('**/assets/creatures/ao/**',r=>r.abort());
await fallback.goto('http://127.0.0.1:3000/reveal');
await fallback.getByRole('button',{name:'Share to Story',exact:true}).waitFor();await fallback.waitForTimeout(600);
await fallback.screenshot({path:`${out}/390-reveal-missing-assets.png`});
await fallback.getByRole('button',{name:'Share to Story',exact:true}).click();await fallback.getByRole('button',{name:'Save photo',exact:true}).click();
await fallback.locator('img[src^="blob:"]').waitFor({timeout:30000});
const compatibilityPhoto=await fallback.locator('img[src^="blob:"]').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
await fallback.close();
const report={fallbackErrors,compatibilityPhoto,revealReducedMotionPaused,flowReachedReveal:true,calls,errors,scroll,photo,reducedMotionCanvasPaused:reducedStart===reducedEnd,simulatedHiddenCanvasPaused:hiddenStart===hiddenEnd,resumed:resumed>hiddenEnd};
await writeFile(`${out}/resilience.json`,JSON.stringify(report,null,2));console.log(report);await browser.close();
