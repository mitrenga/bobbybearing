#!/usr/bin/env node
/**
 * Místnosti, jak je postaví remake, proti tomu, jak je postaví originál.
 *
 *   ./tools/traceworld.py && ./tools/dumpworld.py && ./tools/matchworld.mjs [--room N] [--verbose]
 *
 * Reference dělá `tools/traceworld.py`: v simulátoru z jedné kopie paměti hry
 * zavolá pro každou z 245 místností `$808C` a `$7935` originálu a pak přenos
 * na obrazovku `$9387`. Tady se totéž udělá **skutečným kódem, který jde do
 * prohlížeče** — `app/worldRenderer.js` nad `data/world.json` — a porovná se
 * po místnostech:
 *
 * 1. **paměť po stavbě** — každá adresa, kterou originál do `$7CC6` změnil,
 *    i každá, kterou zapsal remake: buffer scény `$CDE7`, mapa `$5EEC`,
 *    seznam `$C8C8`, východy `$C84B`, `$FF00` a proměnné včetně
 *    samomodifikovaných operandů. Kde originál nic nezměnil, musí remake
 *    zapsat totéž, co tam bylo
 * 2. **atribut** — kde v proudu leží (za entitami, M4) a všech 768 buněk
 * 3. **obrazovka** po `$9387` — 6912 bajtů
 * 4. **entity** — `app/bobbyLogic.js` postaví místnost nad celou výchozí
 *    pamětí hry a nahraje její entity (`roomEntities`, `$9629`); celá RAM
 *    `$4000`–`$FFFF` na `$7CD6` (bez atributů a zásobníku) proti originálu
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REF = path.join(ROOT, 'build/world');

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--room') ? Number(args[args.indexOf('--room')+1]) : null;
  const verbose = args.includes('--verbose');
  if (!fs.existsSync(path.join(REF, 'rooms.json'))) {
    console.error('chybí build/world/rooms.json – spusť ./tools/traceworld.py');
    process.exit(2);
  }
  globalThis.atob = globalThis.atob || ((data) => Buffer.from(data, 'base64').toString('binary'));
  const loadClassicScript = createRequire(import.meta.url)(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
  const WorldRenderer = loadClassicScript(path.join(ROOT, 'app/worldRenderer.js'));
  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));
  const ref = JSON.parse(fs.readFileSync(path.join(REF, 'rooms.json'), 'utf8'));
  const base = fs.readFileSync(path.join(ROOT, ref.base));       // RAM $4000-$FFFF
  const b64 = (s) => Buffer.from(s, 'base64');
  const renderer = new WorldRenderer(world);
  globalThis.WorldRenderer = WorldRenderer;
  const BobbyLogic = loadClassicScript(path.join(ROOT, 'app/bobbyLogic.js'));
  const STACK = [0x6180, 0x61A0];       // zásobník nástroje (traceworld.py)
  // ★ místnost $99 (nesmysl, sources/docs/world.md §6) čte entity až z ROM
  const rom = fs.readFileSync(path.join(REF, 'rom48.bin'));

  let checks = 0, diffs = 0, rooms = 0, bad = 0;
  for (const room of ref.rooms) {
    if (only !== null && room.room !== only) {
      continue;
    }
    rooms++;
    const name = '$'+room.room.toString(16).toUpperCase().padStart(2, '0');
    const problems = [];
    renderer.reset();
    renderer.written = new Set();
    renderer.wr(0xFE4F, room.room);
    renderer.clearBuffer();
    renderer.buildRoom();

    // 1. paměť po stavbě (bez atributů, ty se vyplní až po $7CC6)
    const expect = new Map();
    for (const [start, bytes] of room.static.changes) {
      b64(bytes).forEach((v, i) => expect.set(start+i, v));
    }
    const addresses = new Set([...expect.keys(), ...renderer.written]);
    let memDiff = 0, first = -1;
    for (const a of addresses) {
      if (a >= 0x5800 && a < 0x5B00) {
        continue;
      }
      checks++;
      const want = expect.has(a) ? expect.get(a) : base[a-0x4000];
      if (renderer.mem[a] !== want) {
        memDiff++;
        if (first < 0 || a < first) {
          first = a;
        }
      }
    }
    if (memDiff) {
      problems.push(`paměť ${memDiff} B (první $${first.toString(16).toUpperCase()})`);
    }

    // 2. atribut
    checks++;
    if (renderer.attributeAddress !== room.attrAddress) {
      problems.push(`atribut na $${renderer.attributeAddress.toString(16)}, originál $${room.attrAddress.toString(16)}`);
    }
    let attrDiff = 0;
    for (let i = 0x5800; i < 0x5B00; i++) {
      checks++;
      if (renderer.mem[i] !== room.attr) {
        attrDiff++;
      }
    }
    if (attrDiff) {
      problems.push(`atributy ${attrDiff} B`);
    }

    // 3. obrazovka po $9387
    renderer.copyToScreen();
    const screen = b64(room.screen);
    const mine = renderer.screen();
    let scrDiff = 0;
    for (let i = 0; i < 6912; i++) {
      checks++;
      if (mine[i] !== screen[i]) {
        scrDiff++;
      }
    }
    if (scrDiff) {
      problems.push(`obrazovka ${scrDiff} B`);
    }

    // 4. entity: celá RAM po $9629
    let entDiff = 0;
    const memory = new Uint8Array(65536);
    memory.set(rom, 0);
    memory.set(base, 0x4000);
    const logic = new BobbyLogic(memory);
    logic.fillAttributes = () => {};    // stav na $7CD6, před výplní atributů
    try {
      logic.wr(0xFE4F, room.room);
      logic.clearBuffer();
      logic.buildRoom();
      const want = Uint8Array.from(base);
      for (const [start, bytes] of room.entities) {
        want.set(b64(bytes), start-0x4000);
      }
      first = -1;
      for (let a = 0x4000; a < 0x10000; a++) {
        if ((a >= 0x5800 && a < 0x5B00) || (a >= STACK[0] && a < STACK[1])) {
          continue;
        }
        checks++;
        if (memory[a] !== want[a-0x4000]) {
          entDiff++;
          if (first < 0) {
            first = a;
          }
        }
      }
      if (entDiff) {
        problems.push(`entity ${entDiff} B (první $${first.toString(16).toUpperCase()}`
                      +` ${memory[first]}/${want[first-0x4000]})`);
      }
    } catch (error) {
      entDiff = 1;
      problems.push(`entity: ${error.message}`);
    }

    const n = memDiff+attrDiff+scrDiff+entDiff+(renderer.attributeAddress !== room.attrAddress ? 1 : 0);
    diffs += n;
    if (n) {
      bad++;
      console.log(`místnost ${name}: ${problems.join(', ')}`);
    } else if (verbose) {
      console.log(`místnost ${name}: OK (${addresses.size} adres)`);
    }
  }
  console.log(`matchworld: ${rooms} místností, ${checks} kontrol, ${diffs} rozdílů`
              + (bad ? ` (${bad} místností nesedí)` : ''));
  process.exit(diffs ? 1 : 0);
}

main();
