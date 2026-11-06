// Minimal static server for site/ (local preview). Usage: node scripts/serve.js [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'site');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.argv[2] ?? 5173);
createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(p); } catch { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': (types[extname(p)] ?? 'application/octet-stream') + '; charset=utf-8' }).end(body);
}).listen(port, () => console.log(`http://localhost:${port}`));
