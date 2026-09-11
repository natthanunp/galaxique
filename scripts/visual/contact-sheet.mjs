import sharp from 'sharp';
import {readdir} from 'node:fs/promises';
const root='artifacts/galaxy/review';
for(const width of [1440,390]){
 const files=(await readdir(root)).filter(f=>f.startsWith(`${width}-`)&&/-(bird|cat|dragon|fish|fox|jelly|spirit)\.png$/.test(f)).sort();
 const w=width===390?195:360,h=width===390?450:250,cols=6;
 const layers=[];
 for(let i=0;i<files.length;i++){
  const f=files[i],left=i%cols*w,top=Math.floor(i/cols)*h;
  layers.push({input:await sharp(`${root}/${f}`).resize(w,h-28,{fit:'contain',background:'#060813'}).toBuffer(),left,top});
  const title=f.replace(`${width}-`,'').replace('.png','');
  layers.push({input:Buffer.from(`<svg width="${w}" height="28"><rect width="100%" height="100%" fill="#060813"/><text x="6" y="17" font-size="10" fill="#e6e6ef">${title}</text></svg>`),left,top:top+h-28});
 }
 if(files.length)await sharp({create:{width:w*cols,height:h*Math.ceil(files.length/cols),channels:3,background:'#060813'}}).composite(layers).jpeg({quality:85}).toFile(`${root}/${width}-contact.jpg`);
}
