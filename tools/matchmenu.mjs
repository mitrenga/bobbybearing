#!/usr/bin/env node
/**
 * Porovná animaci menu remaku se smyčkou menu originálu.
 *
 *   ./tools/mkscreen.py && ./tools/tracemenu.py && ./tools/matchmenu.mjs
 *
 * `app/screenComposer.js` `menuLoop` (převod `$D6D0` bez kláves: `$D90A`
 * míč v „O", `$D941` XOR do bufferu, `$D9B6` buffer na obrazovku) se otáčí
 * nad `data/screen.json` od stavu za `CALL $D8F5` a po každé otočce se
 * porovná s obrazovkou simulátoru (`build/menu/loops.bin.gz`,
 * `tools/tracemenu.py`):
 *
 * - **řádky 0–12** (bitmapa i atributy): logo s míčem — bajt po bajtu;
 *   řádky 13–23 jsou v remaku okno menu, originál tam má volič ovládání,
 *   který bez kláves stojí a tady se nekreslí (`matchscreen` hlídá, že
 *   mimo okno sedí úvodní obrazovka);
 * - **T-stavy otočky**: co `menuLoop` vrátí, proti změřené otočce.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MENU = path.join(ROOT, 'build/menu');
const ROWS = 13;

async function main() {
  for (const f of ['loops.bin.gz', 'loops.json', 'loop0.bin']) {
    if (!fs.existsSync(path.join(MENU, f))) {
      console.error(`chybí build/menu/${f} — ./tools/tracemenu.py`);
      process.exit(2);
    }
  }
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/screen.json'), 'utf8'));
  const trace = JSON.parse(fs.readFileSync(path.join(MENU, 'loops.json'), 'utf8'));
  const screens = zlib.gunzipSync(fs.readFileSync(path.join(MENU, 'loops.bin.gz')));
  const loop0 = fs.readFileSync(path.join(MENU, 'loop0.bin'));

  const offsets = [];
  for (let y = 0; y < ROWS*8; y++) {
    for (let i = 0; i < 32; i++) { offsets.push(ZXVideoRAM.lineOffset(y)+i); }
  }
  for (let i = 0; i < ROWS*32; i++) { offsets.push(6144+i); }

  let checks = 0, diffs = 0, firstBad = null;
  const compare = (mine, real, label) => {
    for (const at of offsets) {
      checks++;
      if (mine[at] !== real[at]) {
        diffs++;
        if (!firstBad) { firstBad = `${label}: offset $${at.toString(16).toUpperCase()} ${mine[at]} / ${real[at]}`; }
      }
    }
  };

  const render = new ScreenComposer(scene);
  const ram = new ZXVideoRAM();
  render.composeTitle(ram);
  compare(ram.bytes, loop0, 'před první otočkou');
  const state = render.menuStart();
  if (!state) {
    console.error('data/screen.json nemá menu — ./tools/mkscreen.py');
    process.exit(2);
  }
  let tChecks = 0, tDiffs = 0;
  for (const loop of trace.loops) {
    const t = render.menuLoop(ram, state);
    tChecks++;
    if (t !== loop.tstates) { tDiffs++; }
    compare(ram.bytes, screens.subarray((loop.loop-1)*trace.bytes, loop.loop*trace.bytes), `otočka ${loop.loop}`);
  }
  console.log(`obrazovka řádky 0-12 po ${trace.count} otočkách: ${checks} kontrol, ${diffs} rozdílů`
              + (firstBad ? ` (první: ${firstBad})` : ''));
  console.log(`T-stavy otočky: ${tChecks} kontrol, ${tDiffs} rozdílů`);
  console.log(`celkem ${checks+tChecks} kontrol, **${diffs+tDiffs} rozdílů**`);
  process.exit(diffs+tDiffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
