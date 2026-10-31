#!/usr/bin/env node
/**
 * Porovná obrazovky, které remake složí, s videopamětí originálu.
 *
 *   ./tools/mksnapshot.sh && ./tools/mkscreen.py && ./tools/matchscreen.mjs
 *
 * Staví je **skutečným kódem, který jde do prohlížeče** —
 * `app/screenComposer.js` nad `data/screen.json` a první snímek
 * `app/gameWorker.js` — a porovnává je bajt po bajtu:
 *
 * 1. **data úvodní obrazovky** — `title.bytes` jsou bajty programu
 *    `$DA30`–`$E515` z obrazu paměti na vstupu do hry (`build/entry.bin`),
 *    a **font hry** pro menu (`font.bytes` = `$F80C`–`$F9E3`, M7)
 * 2. **úvodní obrazovka** — `ScreenComposer.unpack` (převod `$D9D8`) proti
 *    `build/ref/title.scr`: obrazovce simulátoru zastaveného hned za
 *    `CALL $D9D8` (`$D6BA`). Nula říká, že remake úvodní obrazovku originálu
 *    **rozbalí z programu sám**
 * 3. **pod menu** — menu remaku je okno přes spodní část (`composeMenu`);
 *    všechno **mimo okno** se musí shodovat s úvodní obrazovkou originálu,
 *    uvnitř okna se nekontroluje (je to remake)
 * 4. **herní obrazovka** — první snímek workeru (paměť na startu hry z
 *    `data/world.json` a `data/memory.json`) proti obrazovce originálu na
 *    začátku prvního průchodu hlavní smyčky: místnost `$00` s panelem
 *    (`build/trace/idle/init.bin`, `tools/tracephysics.py`); průchody po ní
 *    kontroluje `tools/runworker.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REF_TITLE = path.join(ROOT, 'build/ref/title.scr');
const ENTRY_BIN = path.join(ROOT, 'build/entry.bin');
const TITLE_DATA = 0xDA30;
const REF_START = path.join(ROOT, 'build/trace/idle/init.bin');

function workerFrame(world, memory) {
  let frame = null;
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout: () => {}, Date,
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
    btoa: (data) => Buffer.from(data, 'binary').toString('base64'),
    postMessage: (message) => { if (!frame) { frame = message; } },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const name = file.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', name), 'utf8'), context, {filename: name});
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'),
                  context, {filename: 'gameWorker.js'});
  sandbox.onmessage({data: {id: 'init', initData: {headless: true, world, memory}}});
  return frame;
}

function compare(name, mine, real, skip) {
  let checks = 0, diffs = 0;
  const first = [];
  for (let i = 0; i < real.length; i++) {
    if (skip && skip(i)) { continue; }
    checks++;
    if (mine[i] !== real[i]) {
      diffs++;
      if (first.length < 5) { first.push(`$${(i).toString(16).toUpperCase()}: ${mine[i]} / ${real[i]}`); }
    }
  }
  console.log(`${name.padEnd(46)} ${String(checks).padStart(6)} kontrol, ${diffs} rozdílů`
              + (first.length ? `  (${first.join(', ')})` : ''));
  return [checks, diffs];
}

async function main() {
  for (const f of [REF_TITLE, ENTRY_BIN, REF_START]) {
    if (!fs.existsSync(f)) {
      console.error(`chybí ${path.relative(ROOT, f)} — ./tools/mksnapshot.sh, ./tools/mkscreen.py a ./tools/tracephysics.py`);
      process.exit(2);
    }
  }
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ScreenLayout } = await import(url.pathToFileURL(path.join(ROOT, 'app/screenLayout.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/screen.json'), 'utf8'));
  const entry = fs.readFileSync(ENTRY_BIN);
  const refTitle = fs.readFileSync(REF_TITLE);

  let checks = 0, diffs = 0;
  const add = ([c, d]) => { checks += c; diffs += d; };

  const packed = ScreenComposer.fromBase64(scene.title.bytes);
  add(compare('data úvodní obrazovky = program $DA30-$E515', packed,
              entry.subarray(TITLE_DATA-0x4000, TITLE_DATA-0x4000+packed.length)));

  // ★ the game's font: ' ', '0'-'9', 'A'-'Z' = the program's table at
  // $F70C + 8 × ASCII (the menu draws in a font close to it, gameApp.js
  // zxFonts8x8Menu)
  if (scene.font && scene.font.bytes) {
    const font = ScreenComposer.fromBase64(scene.font.bytes);
    add(compare('font hry = program $F80C-$F9E3', font,
                entry.subarray(scene.font.address-0x4000, scene.font.address-0x4000+font.length)));
  }

  const render = new ScreenComposer(scene);
  const title = new ZXVideoRAM();
  render.composeTitle(title);
  add(compare('úvodní obrazovka ($D9D8) / simulátor $D6BA', title.bytes, refTitle));

  const menu = new ZXVideoRAM();
  render.composeMenu(menu);
  const w = ScreenLayout.MENU_WINDOW;
  const inWindow = (cell) => cell.row >= w.row && cell.row < w.row+w.rows
                             && cell.col >= w.col && cell.col < w.col+w.cols;
  const cellOf = (i) => {
    if (i >= 6144) { return {row: Math.floor((i-6144)/32), col: (i-6144) % 32}; }
    const y = ((i >> 11) & 3)*64 + ((i >> 5) & 7)*8 + ((i >> 8) & 7);
    return {row: y >> 3, col: i & 31};
  };
  add(compare('pod menu: mimo okno = úvodní obrazovka', menu.bytes, refTitle, (i) => inWindow(cellOf(i))));

  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));
  const memory = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/memory.json'), 'utf8'));
  const frame = workerFrame(world, memory);
  const game = Buffer.from(frame.screen, 'base64');
  add(compare('herní obrazovka z workeru = originál na startu hry', game,
              fs.readFileSync(REF_START).subarray(0x4000, 0x5B00)));

  console.log(`celkem ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
