import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const src='artifacts/galaxy/source', out='public/assets/galaxy';
await mkdir(out,{recursive:true});
await sharp(`${src}/galaxy-desktop.png`).resize(1920,1200).webp({quality:82}).toFile(`${out}/galaxy-desktop.webp`);
await sharp(`${src}/galaxy-desktop.png`).resize(780,1400,{fit:'cover',position:'right'}).webp({quality:80}).toFile(`${out}/galaxy-mobile.webp`);
for(const size of [512,1024]) for(const name of ['stellar-emission','dust-absorption','deep-field']) await sharp(`${src}/${name}.png`).resize(size,size).webp({quality:88}).toFile(`${out}/${name}-${size}.webp`);
