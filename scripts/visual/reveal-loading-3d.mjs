import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},serviceWorkers:'block'});
 await context.route('**/api/**',r=>r.fulfill({json:{success:true,stats:{total:0},track:null}}));
 let release;const gate=new Promise(resolve=>release=resolve);
 await context.route('**/components_reveal_UniverseCanvas*.js',async r=>{await gate;await r.continue()});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('galaxique-quiz',JSON.stringify({version:1,state:{language:'en',questions:[],answers:[],reveal:{vibe:'cozy',celestial_type:'galaxy',central_symbol:'none',primary_color:'#edb570',secondary_color:'#829fcf',rotation_speed:.3,particle_density:'medium',spotify_search_query:'fixture',personality_reading:'Your curiosity lights the way.'}}}));
  window.__draws=0;for(const name of ['drawArrays','drawElements']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.__draws++;return original.apply(this,args)}}
 });
 await page.goto('http://127.0.0.1:3000/reveal',{waitUntil:'domcontentloaded'});
 await page.getByText('Summoning your universe…',{exact:true}).waitFor();await page.waitForFunction(()=>window.__draws>14);
 const start=await page.evaluate(()=>window.__draws);await page.waitForTimeout(600);const animated=await page.evaluate(()=>window.__draws)>start;assert.ok(animated);
 await page.screenshot({path:`artifacts/galaxy/quiz-3d/${width}-reveal-loading.png`});
 release();await page.waitForFunction(()=>document.querySelector('[aria-label="Share to Story"]')?.disabled===false);
 assert.equal(await page.locator('[data-testid="homepage-universe"]').count(),0,'loading background must unmount when reveal is ready');
 results.push({width,animated,loadingBackgroundUnmounted:true,errors});await context.close();
}
await writeFile('docs/galaxy/reveal-loading-3d.json',JSON.stringify(results,null,2));console.log(results);await browser.close();
