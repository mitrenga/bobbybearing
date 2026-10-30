#!/usr/bin/env node
/**
 * LOAD TAPE: co remake zahraje a zapíše, proti kazetě.
 *
 *   ./tools/mksnapshot.sh && ./tools/mktape.py && ./tools/mkscreen.py && ./tools/matchtape.mjs
 *
 * - `data/tape.json` nese bloky tak, jak jdou po pásce (`tools/mktape.py`);
 *   kontroluje se, že jsou **bajt po bajtu** z kazety (všechny čtyři celé —
 *   `bblib.tzx_blocks()` přes `python3`) a že časování turbo bloků je z TZX
 * - obrázek, který `app/tapeLoadingModel.js` během nahrávání zapíše do
 *   videopaměti — po události `tapeByte` bajtu obrázku bajt na `order[...]`
 *   z `data/loading.json` — je **přesně loading screen** (`data/loading.json`
 *   videoRAM); každou adresu obrázku zavaděč zapíše jednou
 * - **celé nahrávání bloku 4**: obrázek a po každém bajtu kreslení zavaděče
 *   z `data/overlay.json` (běžící text, počítadlo) dá **celou obrazovku
 *   simulovaného nahrání na vstupu do hry** (`build/entry.bin`), 6912 kontrol
 *   i v buňkách zavaděče
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// ★ buňky, do kterých zavaděč během nahrávání kreslí (tools/matchloading.py OVERLAY)
function overlay(i) {
  let row, col;
  if (i >= 6144) { row = Math.floor((i-6144)/32); col = (i-6144) % 32; } else {
    const y = ((i >> 11) & 3)*64 + ((i >> 5) & 7)*8 + ((i >> 8) & 7);
    row = y >> 3; col = i & 31;
  }
  return (row === 23 && col >= 1 && col <= 21) || ((row === 22 || row === 23) && col >= 28);
}

async function main() {
  const tape = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tape.json'), 'utf8'));
  const loading = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/loading.json'), 'utf8'));
  const overlayData = JSON.parse(fs.readFileSync(path.join(ROOT, "data/overlay.json"), "utf8"));
  const raw = JSON.parse(execFileSync('python3', ['-c',
    'import sys, json; sys.path.insert(0, "' + HERE + '"); import bblib as L; '
    + 'print(json.dumps([[bytes(b["raw"]).hex(), b["timing"]] for b in L.tzx_blocks()]))'],
    {maxBuffer: 1 << 26}));

  let checks = 0, diffs = 0;
  tape.blocks.forEach((block, i) => {
    const mine = Buffer.from(block.bytes, 'hex');
    const real = Buffer.from(raw[i][0], 'hex').subarray(0, mine.length);
    let d = 0;
    for (let k = 0; k < mine.length; k++) { checks++; if (mine[k] !== real[k]) { d++; } }
    const t = raw[i][1];
    if (t) {
      const want = [t.pilot, t.pilotPulses, t.sync1, t.sync2, t.zero, t.one];
      const got = [block.pilot, block.pilotPulses, block.sync[0], block.sync[1], block.zero, block.one];
      want.forEach((v, k) => { checks++; if (v !== got[k]) { d++; } });
    }
    diffs += d;
    console.log(`blok ${block.block} ${block.kind.padEnd(5)} ${String(mine.length).padStart(5)} B `
                + `z ${block.length} proti kazetě: ${d} rozdílů`);
  });

  const picture = Buffer.from(loading.videoRAM, 'base64');
  const block = tape.blocks.find((b) => b.pictureBytes);
  const [first, count] = block.pictureBytes;
  const screen = new Uint8Array(6912);
  const seen = new Set();
  let d = 0;
  // the events the sound sends: one per byte of the picture, `at` counted
  // from the first one (svision ZXMachineSounds.tapeBlock)
  for (let at = 0; at < count; at++) {
    const where = loading.order[at];
    checks++;
    if (where === undefined || seen.has(where)) { d++; continue; }
    seen.add(where);
    screen[where] = picture[where];
  }
  for (let i = 0; i < 6912; i++) { checks++; if (screen[i] !== picture[i]) { d++; } }
  diffs += d;
  console.log(`obrázek z událostí tapeByte = data/loading.json   ${count+6912} kontrol, ${d} rozdílů`);

  // the whole second block as tapeLoadingModel plays it: an event after every
  // byte of `eventBytes`, the picture's bytes poked, then what the loader drew
  const events = block.eventBytes;
  // data/overlay.json: after byte n the state of all `cells` (deflated)
  const states = zlib.inflateSync(Buffer.from(overlayData.states, 'base64'));
  const cells = overlayData.cells;
  const drawn = {};
  overlayData.bytes.forEach((n, k) => {
    drawn[n] = cells.map((off, i) => [off, states[k*cells.length+i]]);
  });
  checks++;
  if (states.length !== overlayData.bytes.length*cells.length) { diffs++; }
  const full = new Uint8Array(6912);
  for (let at = 0; at < events[1]; at++) {
    const n = events[0]+at;
    if (n >= first && n < first+count) {
      const where = loading.order[n-first];
      full[where] = picture[where];
    }
    (drawn[n] || []).forEach(([off, v]) => { full[off] = v; });
  }
  // what the loader draws after the last byte comes with tapeBlockEnd
  (drawn[events[0]+events[1]] || []).forEach(([off, v]) => { full[off] = v; });
  const entryScreen = fs.readFileSync(path.join(ROOT, 'build/entry.bin'));
  d = 0;
  checks++;
  if (events[0] !== 0 || events[1] !== Buffer.from(block.bytes, 'hex').length) { d++; }
  for (let i = 0; i < 6912; i++) { checks++; if (full[i] !== entryScreen[i]) { d++; } }
  diffs += d;
  console.log(`celý blok 4 s kreslením zavaděče = obrazovka na vstupu ${6913} kontrol, ${d} rozdílů`);

  const entry = fs.readFileSync(path.join(ROOT, 'build/entry.bin'));
  d = 0;
  let n = 0;
  for (let i = 0; i < 6912; i++) {
    if (overlay(i)) { continue; }
    n++; checks++;
    if (picture[i] !== entry[i]) { d++; }
  }
  diffs += d;
  console.log(`loading.json / obrazovka simulátoru na vstupu      ${n} kontrol, ${d} rozdílů`);
  console.log(`celkem ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
