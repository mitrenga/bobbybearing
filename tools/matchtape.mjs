#!/usr/bin/env node
/**
 * LOAD TAPE: co remake zahraje a zapíše, proti kazetě a 2. stupni zavaděče.
 *
 *   ./tools/mksnapshot.sh && ./tools/mktape.py && ./tools/mkscreen.py && ./tools/traceloader.py && ./tools/matchtape.mjs
 *
 * - `data/tape.json` (`tools/mktape.py`): časování a délky čtyř bloků jsou
 *   z TZX (`bblib.tzx_blocks()` přes `python3`), bajty nese jen hlavička
 *   a ty jsou z kazety; bajty bloku 4 pro zvuk dává `AlkatrazLoader.blockBytes`
 *   — kontrolní slovo `$5B7C`, obrázek a proměnné z `data/loading.json`,
 *   program za nimi je jen šum (`audioManager.js`)
 * - `data/loading.json` (`tools/mkscreen.py`): obrázek v pořadí pásky,
 *   proměnné a paměť zavaděče = to, co `tools/traceloader.py` odečetl
 *   z nahrání bez pulzů (`build/ref/loader.json`)
 * - ★ **převod 2. stupně zavaděče** `app/alkatrazLoader.js` proti originálu
 *   krok po kroku: generátor adres (`$F983`) dá všech 6714 adres obrázku
 *   v pořadí originálu; stavový automat textu a počítadla (`$F7AE`) má po
 *   každém z 318 920 kroků (jeden na bit od bajtu 6718) tytéž registry
 *   (`$F7AF`, A', CY', BC', DE', HL', IY, `$F7F3`, `$F8CE`, `$F980`–`$F982`)
 *   a tytéž změny buněk řádků 22–23 jako originál
 * - **celý blok 4** přehraný do převodu (obrázek bajt po bajtu, text,
 *   počítadlo) dá **celou obrazovku simulovaného nahrání na vstupu do hry**
 *   (`build/entry.bin`), 6912 kontrol
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
await import(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs'));
const { AlkatrazLoader } = await import(path.join(ROOT, 'app/alkatrazLoader.js'));

let checks = 0, diffs = 0;
function count(ok) { checks++; if (!ok) { diffs++; } return ok; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function main() {
  const tape = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tape.json'), 'utf8'));
  const loading = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/loading.json'), 'utf8'));
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/ref/loader.json'), 'utf8'));
  const entry = fs.readFileSync(path.join(ROOT, 'build/entry.bin'));
  const raw = JSON.parse(execFileSync('python3', ['-c',
    'import sys, json; sys.path.insert(0, "' + HERE + '"); import bblib as L; '
    + 'print(json.dumps([[bytes(b["raw"]).hex(), b["timing"]] for b in L.tzx_blocks()]))'],
    {maxBuffer: 1 << 26}));

  // --- data/tape.json: the tape's timing and lengths, the header's bytes
  let d0 = diffs;
  tape.blocks.forEach((block, i) => {
    const real = Buffer.from(raw[i][0], 'hex');
    count(block.length === real.length);
    const t = raw[i][1];
    if (t) {
      [t.pilot, t.pilotPulses, t.sync1, t.sync2, t.zero, t.one].forEach((v, k) => {
        count(v === [block.pilot, block.pilotPulses, block.sync[0], block.sync[1], block.zero, block.one][k]);
      });
    }
    if (block.header) {
      count(block.bytes === raw[i][0]);
    } else {
      count(block.bytes === undefined);
    }
  });
  console.log(`data/tape.json proti kazetě (časování, délky, hlavička)  ${checks} kontrol, ${diffs-d0} rozdílů`);

  // --- data/loading.json against the reference of the simulated load
  d0 = diffs; let c0 = checks;
  const picture = await AlkatrazLoader.inflate(loading.picture);
  const refPicture = Buffer.from(ref.picture, 'hex');
  count(picture.length === refPicture.length);
  for (let i = 0; i < refPicture.length; i++) { count(picture[i] === refPicture[i]); }
  const vars = AlkatrazLoader.hex(loading.vars);
  const refVars = Buffer.from(ref.vars, 'hex');
  count(vars.length === refVars.length);
  for (let i = 0; i < refVars.length; i++) { count(vars[i] === refVars[i]); }
  count(same(Object.keys(loading.regions).sort(), Object.keys(ref.regions).sort()));
  Object.keys(ref.regions).forEach((key) => {
    const mine = AlkatrazLoader.base64(loading.regions[key] || '');
    const want = Buffer.from(ref.regions[key], 'hex');
    count(mine.length === want.length);
    for (let i = 0; i < want.length; i++) { count(mine[i] === want[i]); }
  });
  count(same(loading.pictureBytes, tape.blocks[3].pictureBytes));
  console.log(`data/loading.json = obrázek, proměnné a paměť zavaděče    ${checks-c0} kontrol, ${diffs-d0} rozdílů`);

  // --- the generator of addresses
  d0 = diffs; c0 = checks;
  const loader = new AlkatrazLoader(loading.regions);
  const offsets = loader.pictureOffsets();
  count(offsets.length === ref.order.length);
  for (let i = 0; i < ref.order.length; i++) { count(offsets[i] === ref.order[i]); }
  console.log(`generátor adres $F983 = pořadí originálu                 ${checks-c0} kontrol, ${diffs-d0} rozdílů`);

  // --- the state machine, step by step, the whole second block
  d0 = diffs; c0 = checks;
  const screen = new Uint8Array(6912);
  const [first, pictureCount] = loading.pictureBytes;
  const block = tape.blocks[3];
  let k = 0, shown = 0, idleBad = 0;
  for (let n = 0; n < block.length && !loader.done; n++) {
    let value = 0;
    if (n >= first && n < first+pictureCount) { value = picture[n-first]; }
    else if (n >= first+pictureCount && n < first+pictureCount+vars.length) { value = vars[n-first-pictureCount]; }
    for (let bit = 0; bit < 8; bit++, k++) {
      loader.dirty.length = 0;
      loader.step(loader.de & 0xFF);
      const changes = [];
      loader.dirty.forEach((o) => {
        const v = loader.mem[0x4000+o];
        if (v !== screen[o]) { screen[o] = v; changes.push([o, v]); }
      });
      if (k < ref.idle) {
        if (loader.state !== 0xF7B1 || changes.length) { idleBad++; }
        continue;
      }
      const want = ref.steps[k-ref.idle];
      if (!want) { continue; }
      const ok = count(same(loader.snapshot(), want.slice(0, 10)))
                 & count(same(changes.sort((a, b) => a[0]-b[0]), want[11].sort((a, b) => a[0]-b[0])));
      if (!ok && shown++ < 5) {
        console.log(`  krok ${k} (bajt ${n} bit ${bit}): mám ${JSON.stringify(loader.snapshot())} ${JSON.stringify(changes.slice(0, 3))}`);
        console.log(`  ${' '.repeat(String(k).length+20)}chci ${JSON.stringify(want.slice(0, 10))} ${JSON.stringify(want[11].slice(0, 3))}`);
      }
    }
    loader.finishByte(value);
    loader.dirty.forEach((o) => { screen[o] = loader.mem[0x4000+o]; });
    loader.dirty.length = 0;
  }
  count(idleBad === 0);
  count(k >= ref.idle+ref.steps.length);
  count(loader.done);
  console.log(`automat textu a počítadla krok po kroku (${ref.steps.length} kroků) ${checks-c0} kontrol, ${diffs-d0} rozdílů`);

  // --- the whole screen at the end
  d0 = diffs; c0 = checks;
  for (let i = 0; i < 6912; i++) { count(loader.mem[0x4000+i] === entry[i]); }
  console.log(`celý blok 4 v převodu = obrazovka na vstupu do hry      ${checks-c0} kontrol, ${diffs-d0} rozdílů`);

  // --- the bytes the sound plays
  d0 = diffs; c0 = checks;
  const bytes4 = AlkatrazLoader.blockBytes(block, picture, vars);
  count(bytes4.length === first+pictureCount+vars.length);
  count(bytes4[0] === (AlkatrazLoader.CHECK & 0xFF) && bytes4[1] === (AlkatrazLoader.CHECK >> 8));
  for (let i = 0; i < pictureCount; i++) { count(bytes4[first+i] === picture[i]); }
  for (let i = 0; i < vars.length; i++) { count(bytes4[first+pictureCount+i] === vars[i]); }
  tape.blocks.forEach((b, i) => {
    const bytes = AlkatrazLoader.blockBytes(b, picture, vars);
    if (b.header) { count(bytes !== null && Buffer.from(bytes).toString('hex') === raw[i][0]); }
    else if (!b.pictureBytes) { count(bytes === null); }
  });
  console.log(`bajty zvuku: hlavička, kontrolní slovo, obrázek a proměnné bloku 4  ${checks-c0} kontrol, ${diffs-d0} rozdílů`);

  console.log(`celkem ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
