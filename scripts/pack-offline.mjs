import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const index = fs.readFileSync('dist/index.html', 'utf8');
const jsFile = index.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
const cssFile = index.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
if (!jsFile || !cssFile) throw new Error('Built CSS/JS references were not found');
const css = fs.readFileSync(path.resolve('dist', cssFile), 'utf8').replace(/<\/style/gi, '<\\/style');
const js = fs.readFileSync(path.resolve('dist', jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Meme币庄家模拟器</title><link rel="icon" href="data:,">
<style>${css}</style></head><body><div id="root"></div>
<script type="module">${js}</script></body></html>`;
const out = process.argv[2] || 'standalone/Meme币庄家模拟器-提币结算修复-20261107.html';
fs.writeFileSync(out, html, { flag: 'wx' });
console.log(JSON.stringify({ file: path.resolve(out), bytes: Buffer.byteLength(html), sha256: crypto.createHash('sha256').update(html).digest('hex'), jsFile, cssFile }));