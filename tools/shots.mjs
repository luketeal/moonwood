/* ---------------------------------------------------------------------------
   MOONWOOD SHOT HARNESS

   Takes the same handful of pictures of the game every time, so that a change
   to the way it looks can be judged by putting two sets side by side instead
   of by remembering what it used to look like.

       node tools/shots.mjs --tag before
       ... make a change ...
       node tools/shots.mjs --tag after

   and shots/before-*.png and shots/after-*.png are the same four places in the
   same three lands, lit the same way, frozen at the same instant.

   WHAT IT IS GOOD FOR: how the game LOOKS.
   WHAT IT IS NOT: how fast the game RUNS. Headless Chromium here draws with
   SwiftShader, which is software - it is perhaps a hundred times slower than
   a real graphics chip, and a frame time measured from it means nothing at
   all. Speed has to be checked on a real device.

   Options:
     --tag <name>      what to call this set            (default "shot")
     --out <dir>       where to put them                (default "shots")
     --scenes a,b      only these scenes                (default all)
     --quality <q>     high | med | low                 (default "high")
     --width, --height picture size                     (default 900x650)
     --hud             leave the dials and buttons in (they are hidden by
                       default, so what is compared is the 3-D picture)
     --list            print the scene names and stop

   It needs Playwright. If it is not already about:  npm i -D playwright
--------------------------------------------------------------------------- */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------------------
   THE PLACES WE ALWAYS LOOK

   Four spots, chosen because between them they show everything a change to the
   look is likely to affect: crowded silhouettes, water, open ground with the
   wind in it, and the one land that is all fog and stone.

   x and y are where he stands; `a` is the way he is facing, and the camera
   sits behind and above that. The numbers come from the lands themselves -
   the Great Pine is at 1800,900, the river crosses 2200,1400, and so on.
--------------------------------------------------------------------------- */
const SCENES = [
  { name: 'moonwood-pines', land: 'moonwood', x: 1350, y: 1500, a: -0.93,
    why: 'crowded pines - faceting, edge crawl, how shapes hold apart' },
  { name: 'moonwood-river', land: 'moonwood', x: 1900, y: 1400, a: 0,
    why: 'the river - water shading and the moon lying on it' },
  { name: 'sunfield-mill',  land: 'sunfield', x: 1700, y: 1900, a: -0.46,
    why: 'open country - grass, wind, a landmark against the sky' },
  { name: 'ruins-tower',    land: 'ruins',    x: 1700, y: 1400, a: 0,
    why: 'mist and stone - the flattest, lowest-contrast land there is' }
];

/* The instant every picture is frozen at. Everything that moves by itself in
   this game - the wind, the water, the fireflies, the campfire - is worked out
   from Date.now(), so pinning that pins all of it, and two runs line up. */
const FROZEN_AT = 1700000000000;

/* ------------------------------------------------------------------ args -- */
function parseArgs(argv) {
  const o = { tag: 'shot', out: 'shots', scenes: null, quality: 'high', width: 900, height: 650, list: false, hud: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--list') { o.list = true; continue; }
    if (k === '--hud') { o.hud = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`${k} needs a value`);
    if (k === '--tag') o.tag = v;
    else if (k === '--out') o.out = v;
    else if (k === '--scenes') o.scenes = v.split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--quality') o.quality = v;
    else if (k === '--width') o.width = Number(v);
    else if (k === '--height') o.height = Number(v);
    else throw new Error(`no such option: ${k}`);
  }
  if (!['high', 'med', 'low'].includes(o.quality)) throw new Error(`--quality must be high, med or low`);
  if (!Number.isFinite(o.width) || !Number.isFinite(o.height)) throw new Error('--width and --height must be numbers');
  return o;
}

/* ------------------------------------------------------- a little server -- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',   // modules will not load as anything else
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serve(root) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/') p = '/index.html';
        // Keep the server inside the repo, whatever the request asks for.
        const full = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));
        if (!full.startsWith(root) || !existsSync(full)) { res.writeHead(404); return res.end('not found'); }
        const body = await readFile(full);
        res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream' });
        res.end(body);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* --------------------------------------------------------- finding chromium */
async function loadPlaywright() {
  const tries = ['playwright', 'playwright-core',
                 '/opt/node22/lib/node_modules/playwright/index.mjs'];
  for (const t of tries) {
    try { return await import(t); } catch { /* next */ }
  }
  throw new Error('Playwright is not installed. Try:  npm i -D playwright && npx playwright install chromium');
}

/* ------------------------------------------------------------------ main -- */
const opt = parseArgs(process.argv.slice(2));

if (opt.list) {
  for (const s of SCENES) console.log(`${s.name.padEnd(16)} ${s.why}`);
  process.exit(0);
}

const wanted = opt.scenes ? SCENES.filter(s => opt.scenes.includes(s.name)) : SCENES;
if (!wanted.length) throw new Error(`no scene matched. --list shows them all.`);

// An --out that is already absolute is meant as it stands; anything else is
// taken as relative to the repo.
const outDir = isAbsolute(opt.out) ? opt.out : join(ROOT, opt.out);
await mkdir(outDir, { recursive: true });

const { server, port } = await serve(ROOT);
const { chromium } = await loadPlaywright();

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--hide-scrollbars', '--mute-audio']
});

const problems = [];
let shot = 0;

try {
  for (const scene of wanted) {
    const page = await browser.newPage({
      viewport: { width: opt.width, height: opt.height },
      deviceScaleFactor: 1
    });

    const errs = [];
    page.on('pageerror', e => errs.push(`js: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

    // ?gfx pins the quality - which also stops the game quietly dropping a
    // step when the software renderer cannot keep up, so every run is drawn
    // to the same standard.
    await page.goto(`http://127.0.0.1:${port}/index.html?gfx=${opt.quality}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /begin adventure/i }).click();

    // The renderer has to exist before we can put him anywhere.
    await page.waitForFunction(() => window.MW && window.MW.R, null, { timeout: 20000 });

    // Stand him where the scene says. The land is built the first frame after
    // p.land changes, so this is also what triggers the build.
    await page.evaluate(({ land, x, y, a }) => {
      window.MW.p.land = land; window.MW.p.x = x; window.MW.p.y = y; window.MW.p.a = a;
    }, scene);

    // Let the land build and the camera swing round and settle behind him.
    await page.waitForTimeout(6000);

    /* Walking him into a land can put him on top of a monster, and a fight
       dims the moon, thickens the fog and swings the camera round - so the
       picture would be of a fight, not of the place. Say so rather than
       quietly filing it with the rest. */
    if (await page.evaluate(() => !!window.MW.battle)) {
      errs.push('a fight started here - move the scene away from the monster');
    }

    // The dials and buttons are the same in every run and cover a third of the
    // picture, so they go unless they were asked for.
    if (!opt.hud) {
      await page.addStyleTag({ content:
        '#hud,#storyhint,#message,#saved,#compass,#banner,#controls,#moves,#travel,#ability,#act,#ui{display:none!important}' });
    }

    // Stop the clock, so the wind, the water and the fireflies are caught at
    // the same instant in every run, then give it two frames to draw frozen.
    await page.evaluate(t => { Date.now = () => t; }, FROZEN_AT);
    await page.evaluate(() => new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r))));

    const file = join(outDir, `${opt.tag}-${scene.name}.png`);
    await page.screenshot({ path: file });
    shot++;

    // A black picture means it drew nothing, which is worth saying out loud
    // rather than leaving to be noticed later.
    const lit = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const g = c.getContext('webgl2') || c.getContext('webgl');
      return g ? { w: c.width, h: c.height, lost: g.isContextLost() } : null;
    });
    if (!lit || lit.lost) errs.push('the 3-D context was lost or never started');

    const where = relative(process.cwd(), file) || file;
    if (errs.length) { problems.push(`${scene.name}: ${errs[0]}`); console.log(`  !  ${where}  (${errs[0]})`); }
    else console.log(`  ok ${where}`);

    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${shot} picture${shot === 1 ? '' : 's'} in ${relative(process.cwd(), outDir) || outDir}/ tagged "${opt.tag}" (quality ${opt.quality}, ${opt.width}x${opt.height})`);
if (problems.length) {
  console.error(`\n${problems.length} went wrong:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
