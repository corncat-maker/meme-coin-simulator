#!/usr/bin/env node
/** Build one offline HTML from the current Vite dist output. Run npm run build first. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const index = readFileSync(path.join(dist, 'index.html'), 'utf8');
const jsAsset = index.match(/<script\b[^>]*\bsrc="\.\/([^"\s]+\.js)"/i)?.[1];
const cssAsset = index.match(/<link\b[^>]*\bhref="\.\/([^"\s]+\.css)"/i)?.[1];
assert.ok(jsAsset && cssAsset, 'Vite JS/CSS assets were not found in dist/index.html');
const js = readFileSync(path.join(dist, jsAsset), 'utf8')
  .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
  .replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(dist, cssAsset), 'utf8');
assert.ok(!/\bimport\s*(?:\(|[^;]*?\bfrom\s*)["']\.\//.test(js), 'External JS chunks cannot be used by this single-file builder');

// Preserve the existing standalone platform shim; game logic still uses the platform adapter.
const shim = `(function () {
  if (window.lingguang) return;
  var noop = function () {};
  var api = {
    saveFile: function (opts) {
      return new Promise(function (resolve, reject) {
        try {
          var bin = atob((opts && opts.data) || '');
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var blob = new Blob([bytes], { type: 'application/octet-stream' });
          var a = document.createElement('a');
          var url = URL.createObjectURL(blob);
          a.href = url;
          a.download = (opts && opts.fileName) || 'download.bin';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
          resolve({ success: true });
        } catch (e) { reject(e); }
      });
    }
  };
  window.lingguang = new Proxy(api, {
    get: function (t, k) { return k in t ? t[k] : noop; }
  });
})();`;
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<meta name="game-build" content="BTC-OI-units-v2" />
<link rel="icon" href="data:," />
<title>Meme币庄家模拟器</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${shim}</script>
<script type="module">${js}</script>
</body>
</html>
`;
const output = path.join(root, 'standalone', 'Meme币庄家模拟器-独立版.html');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), jsAsset, cssAsset }, null, 2));
