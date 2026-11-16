const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('./build.cjs');
const api = require('../api/game.js');
const root = path.resolve(__dirname, '../public');
const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.otf': 'font/otf', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/game') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    return api(req, res);
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(3000, '127.0.0.1', () => console.log('Local game: http://127.0.0.1:3000'));
