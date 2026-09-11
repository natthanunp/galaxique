import {readFile,writeFile,mkdir} from 'node:fs/promises';
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const comparisons=[];
for(const [before,after] of [['before','after'],['before-video','after-video']]){
 let a,b;try{a=JSON.parse(await readFile(`artifacts/galaxy/${before}/metrics.json`));b=JSON.parse(await readFile(`artifacts/galaxy/${after}/metrics.json`));}catch{continue;}
 for(const width of [1440,390]) for(const scene of [...new Set(a.map(x=>x.scene))]) {
  const old=a.filter(x=>x.viewport.width===width&&x.scene===scene),current=b.filter(x=>x.viewport.width===width&&x.scene===scene);
  if(old.length!==3||current.length!==3)continue;
  for(const metric of (before.endsWith('video') ? ['videoMs'] : ['fps','p95Ms','loadMs','drawCalls','photoMs'])) {
   if(!old.every(x=>typeof x[metric]==='number')||!current.every(x=>typeof x[metric]==='number'))continue;
   const baseline=median(old.map(x=>x[metric])),updated=median(current.map(x=>x[metric]));
   const changePercent=(updated/baseline-1)*100;
   comparisons.push({width,scene,metric,baseline,updated,changePercent,pass:metric==='fps'?changePercent>=-5:changePercent<=5});
  }
 }
}
await mkdir('docs/galaxy',{recursive:true});
await writeFile('docs/galaxy/comparison.json',JSON.stringify(comparisons,null,2));
console.table(comparisons.map(x=>({...x,baseline:x.baseline.toFixed(2),updated:x.updated.toFixed(2),changePercent:x.changePercent.toFixed(1)})));
