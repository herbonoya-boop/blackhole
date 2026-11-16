const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const assets = path.join(output, 'assets');
fs.mkdirSync(assets, { recursive: true });
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'font/otf': 'otf', 'font/ttf': 'ttf' };
const exported = new Set();
html = html.replace(/data:(image\/(?:jpeg|png|webp)|font\/(?:otf|ttf));base64,([A-Za-z0-9+/=]+)/g, (_, type, encoded) => {
  const bytes = Buffer.from(encoded, 'base64');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20);
  const name = `${hash}.${extensions[type]}`;
  fs.writeFileSync(path.join(assets, name), bytes);
  exported.add(name);
  return `/assets/${name}`;
});
fs.writeFileSync(path.join(output, 'index.html'), html);
console.log(`Built public/index.html and ${exported.size} deduplicated assets.`);
