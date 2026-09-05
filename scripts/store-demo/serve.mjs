/** Serve the real production build with synthetic caches, isolated from university services. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
import {demoNow, fixture} from './fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(root, 'dist');
const storageSource = await readFile(resolve(root, 'src/storage.ts'), 'utf8');
const constant = name => {
  const value = storageSource.match(new RegExp(`export const ${name} = "([^"]+)";`))?.[1];
  if (!value) throw new Error(`Missing storage constant: ${name}`);
  return value;
};
const records = {
  [constant('KOAN_CACHE_KEY')]: fixture.koan,
  [constant('CLE_CACHE_KEY')]: fixture.cle,
  [constant('GRADES_CACHE_KEY')]: fixture.grades,
  [constant('ONBOARDING_KEY')]: {completed: true, termsVersion: constant('TERMS_VERSION'), privacyVersion: constant('PRIVACY_VERSION'), acceptedAt: demoNow},
};
const bootstrap = `
// Screenshot-only environment; this script is never written into dist or the extension ZIP.
const RealDate = Date;
window.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [${JSON.stringify(demoNow)}])); }
  static now() { return new RealDate(${JSON.stringify(demoNow)}).getTime(); }
};
for (const [key, value] of Object.entries(${JSON.stringify(records)})) localStorage.setItem(key, JSON.stringify(value));
localStorage.setItem(${JSON.stringify(constant('THEME_KEY'))}, 'light');
// CSP blocks network APIs; these guards also prevent official-site navigation from the demo.
window.open = () => null;
document.addEventListener('click', event => {
  const link = event.target.closest?.('a');
  if (link && new URL(link.href, location.href).origin !== location.origin) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
`;
const index = (await readFile(resolve(dist, 'index.html'), 'utf8'))
  .replace('<title>KOAN Plus</title>', '<title>KOAN Plus — 合成データによる撮影用デモ</title>')
  .replace('<head>', '<head><script src="/demo-bootstrap.js"></script>');
const mime = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png'};
const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'");
  res.setHeader('Cache-Control', 'no-store');
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    if (path === '/' || path === '/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(index); return; }
    if (path === '/demo-bootstrap.js') { res.setHeader('Content-Type', mime['.js']); res.end(bootstrap); return; }
    // Serve only the production assets required by the UI, never repository files.
    if (!/^\/(assets\/[\w.-]+\.(js|css)|icon-(16|32|48|128)\.png)$/.test(path)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[extname(path)]);
    res.end(await readFile(resolve(dist, path.slice(1))));
  } catch { res.writeHead(404).end(); }
});
server.listen(4178, '127.0.0.1', () => console.log('Synthetic store demo: http://127.0.0.1:4178 (Ctrl+C to stop)'));
