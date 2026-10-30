#!/usr/bin/env node
/**
 * Záznam originálu průchod po průchodu proti `app/bobbyLogic.js`.
 *
 *   ./tools/matchphysics.mjs [--script idle] [--all] [--from-data] [--verbose]
 *
 * Záznam dělá `tools/tracephysics.py` (`build/trace/<skript>/`): paměť
 * originálu na začátku prvního průchodu (`init.bin`), hodnoty instrukcí
 * `IN` v každém průchodu (`inputs.json`) a RAM po každém průchodu
 * (`passes.xor.gz`).
 *
 * Remake startuje **ze stejné paměti** a se stejnými vstupy udělá stejný
 * počet průchodů **skutečným kódem, který jde do prohlížeče**
 * (`BobbyLogic.pass`). Po každém se porovná **celá RAM `$4000`–`$FFFF`**
 * bajt po bajtu — obrazovka, buffer scény, mapa, proměnné koule, seznamy
 * objektů, samomodifikované operandy — kromě `SKIP`: zásobníku (návratové
 * adresy a uložené registry nejsou stav hry) a toho, co zapisuje jen
 * obsluha přerušení (zvuk, M6).
 *
 * `--from-data`: remake nestartuje z `init.bin`, ale **z dat, která dostane
 * worker** — `data/world.json` + `data/memory.json` (`tools/mkmemory.mjs`)
 * nad nulami, `BobbyLogic.composeMemory`. Porovnávají se adresy, které data
 * pokrývají nebo které remake zapsal (zbytek paměti v prohlížeči nikdo
 * nečte); jakékoli čtení mimo data by se projevilo jako rozdíl. Záznamy se
 * záplatovaným startem (`patch`, bratr v místnosti `$00`) nebo se startem
 * z pozdějšího průchodu jiného záznamu (`prefix`, místnost `$01`) se z dat
 * nejedou.
 *
 * ★ M5: záznam bez záplaty má `start.bin` (paměť menu na `$74F3`) — remake
 * z ní začne novou hru (`BobbyLogic.newGame`, `$D969` → `$7D87`) a paměť na
 * začátku prvního průchodu se porovná s `init.bin`; s `--from-data` totéž
 * z dat. Záznam s koncem hry (`outcomes`: poslední `gameover`) musí v tom
 * průchodu vrátit jiný výsledek než `pass` a paměť koncové obrazovky.
 *
 * Při prvním rozdílu vypíše průchod, adresu a obě hodnoty a skončí — další
 * průchody by začínaly z jiné paměti.
 *
 * `tools/matchentities.mjs` (M4) na tomhle nástroji stojí: importuje
 * `runScript` a přidává pokrytí kódu entit.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const loadClassicScript = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
globalThis.atob = globalThis.atob || ((d) => Buffer.from(d, 'base64').toString('binary'));
let BobbyLogic = null;

/**
 * app/worldRenderer.js and app/bobbyLogic.js loaded (once); tools that
 * measure coverage (matchentities.mjs) call it after they start the
 * profiler, so that the script is compiled under it.
 * @returns {Function} BobbyLogic.
 */
export function loadLogic() {
  if (!BobbyLogic) {
    globalThis.WorldRenderer = loadClassicScript(path.join(ROOT, 'app/worldRenderer.js'));
    BobbyLogic = loadClassicScript(path.join(ROOT, 'app/bobbyLogic.js'));
  }
  return BobbyLogic;
}

// [od, do) — co se neporovnává
export const SKIP = [
  // ★ zásobník hry (SP = $619E na vstupu, hlavní smyčka na $619C) a pod ním
  // to, co tam nechají volání a přerušení
  [0x6140, 0x619E, 'zásobník'],
  // ★ obsluha přerušení $FB08 / přehrávač $FB8C: požadavky a tři kanály
  // (sources/docs/disasm_notes.md §4); hlavní smyčka je jen zapisuje
  [0xF061, 0xF081, 'zvuk (přerušení)'],
  // ★ $FC75 (efekt přehrávače $FB8C) si přepíše bajt své tabulky $FC85 a pak
  // ji zkopíruje do slotu; jiný zápis obsluha přerušení mimo $F061-$F080 nemá
  [0xFC88, 0xFC89, 'zvuk (tabulka efektu)'],
];

function hex(v, n = 4) { return '$'+v.toString(16).toUpperCase().padStart(n, '0'); }

function skipped(a) {
  return SKIP.some(([lo, hi]) => a >= lo && a < hi);
}

let fromData = null;      // {memory, covered} s --from-data

export function dataMemory() {
  loadLogic();
  const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
  const world = read('world.json'), memory = read('memory.json');
  const covered = new Uint8Array(65536);
  for (const data of [world, memory]) {
    for (const region of Object.values(data.regions)) {
      covered.fill(1, region.address, region.address+Buffer.from(region.bytes, 'base64').length);
    }
  }
  return {memory: BobbyLogic.composeMemory(world, memory), covered};
}

/**
 * Jeden záznam proti převodu.
 * @param {string} name - build/trace/<name>.
 * @param {boolean} verbose - Každý průchod vypsat.
 * @param {Function} [onPass] - (logic, i) po každém porovnaném průchodu.
 * @param {string} [base] - Adresář záznamů (build/trace; matchrules: build/rules).
 * @returns {Array} [kontrol, rozdílů, průchodů, nedojelo].
 */
export function runScript(name, verbose, onPass, base) {
  loadLogic();
  const dir = path.join(base || path.join(ROOT, 'build/trace'), name);
  if (!fs.existsSync(path.join(dir, 'init.bin'))) {
    console.error(`chybí ${path.relative(ROOT, dir)} – spusť ./tools/tracephysics.py --script ${name}`);
    return [0, 1, 0, 0];
  }
  const { inputs, patch, prefix, start, outcomes } = JSON.parse(fs.readFileSync(path.join(dir, 'inputs.json'), 'utf8'));
  // ★ M5: a recording without a patch starts from the menu's memory
  // (start.bin, $74F3) and the port's new game must give init.bin
  const fromStart = !!start && fs.existsSync(path.join(dir, 'start.bin'));
  const memory = fromData ? Uint8Array.from(fromData.memory)
                          : new Uint8Array(fs.readFileSync(path.join(dir, fromStart ? 'start.bin' : 'init.bin')));
  if (fromData && (patch || prefix)) {
    const how = [prefix ? `od průchodu ${prefix[1]} záznamu ${prefix[0]}` : '',
                 patch ? `záplata ${Object.keys(patch).map((a) => hex(+a)).join(', ')}` : ''];
    console.log(`${name}: start ${how.filter(Boolean).join(', ')} — z dat se nejede`);
    return [0, 0, 0, 0];
  }
  const size = 0xC000;
  // ★ the passes: one file, or segments passes.000.xor.gz … (tracerules.py:
  // a whole game would not fit into memory unpacked) read one at a time
  const segments = fs.existsSync(path.join(dir, 'passes.xor.gz')) ? ['passes.xor.gz']
      : fs.readdirSync(dir).filter((f) => /^passes\.\d+\.xor\.gz$/.test(f)).sort();
  let segment = -1, passes = null, offset = 0;
  const nextPass = () => {
    if (!passes || offset >= passes.length) {
      segment++;
      passes = zlib.gunzipSync(fs.readFileSync(path.join(dir, segments[segment])));
      offset = 0;
    }
    const block = passes.subarray(offset, offset+size);
    offset += size;
    return block;
  };
  const ram = Uint8Array.from(fs.readFileSync(path.join(dir, 'init.bin')).subarray(0x4000));
  const logic = new BobbyLogic(memory);
  const watched = (a) => !skipped(a) && (!fromData || fromData.covered[a] || logic.written.has(a));
  if (fromData) {
    logic.written = new Set();
  }
  let checks = 0;
  if (fromStart || fromData) {
    // the new game ($D969 → $7D87) out of the menu's memory (or the data):
    // the memory at the first pass is the original's
    logic.newGame();
    for (let a = 0x4000; a < 0x10000; a++) {
      if (!watched(a)) {
        continue;
      }
      checks++;
      if (memory[a] !== ram[a-0x4000]) {
        console.log(`${name}: start hry ${fromData ? 'z dat' : 'ze start.bin'}: ${hex(a)} ${hex(memory[a], 2)}, originál ${hex(ram[a-0x4000], 2)}`);
        return [checks, 1, 0, 0];
      }
    }
  }
  for (let i = 0; i < inputs.length; i++) {
    const block = nextPass();
    for (let k = 0; k < size; k++) {
      ram[k] ^= block[k];
    }
    const expected = outcomes ? outcomes[i] : 'pass';
    try {
      const outcome = logic.pass(inputs[i]);
      // ★ M5: the pass the game ends in (all home, the time out) gives an
      // outcome other than 'pass' and the end screen; 'won'/'lost'/'timeout'
      // are all the original's $7D06
      if ((outcome === 'pass') !== (expected === 'pass')) {
        console.log(`${name}: průchod ${i+1}: výsledek ${outcome}, originál ${expected}`);
        return [checks, 1, i, 0];
      }
    } catch (error) {
      if (/^unported/.test(error.message)) {
        // ? not a difference: the port ends here (M3 in progress)
        console.log(`${name}: ${i} průchodů, ${checks} kontrol, 0 rozdílů — `
                    +`průchod ${i+1} stojí na nepřevedeném místě (${error.message})`);
        return [checks, 0, i, 1];
      }
      console.log(`${name}: průchod ${i+1}: ${error.message}`);
      return [checks, 1, i, 0];
    }
    for (let k = 0; k < size; k++) {
      const a = k+0x4000;
      if (!watched(a)) {
        continue;
      }
      checks++;
      if (memory[a] !== ram[k]) {
        let n = 0;
        const list = [];
        for (let j = k; j < size; j++) {
          if (watched(j+0x4000) && memory[j+0x4000] !== ram[j]) {
            n++;
            if (list.length < 12) {
              list.push(`${hex(j+0x4000)} ${hex(memory[j+0x4000], 2)}/${hex(ram[j], 2)}`);
            }
          }
        }
        console.log(`${name}: průchod ${i+1}: ${n} rozdílů (remake/originál): ${list.join(', ')}`);
        return [checks, n, i, 0];
      }
    }
    if (verbose) {
      console.log(`${name}: průchod ${i+1} OK`);
    }
    if (onPass) {
      onPass(logic, i);
    }
  }
  console.log(`${name}: ${inputs.length} průchodů, ${checks} kontrol, 0 rozdílů`);
  return [checks, 0, inputs.length, 0];
}

/** `--from-data`: start z dat místo z init.bin (i pro matchentities). */
export function useData() {
  fromData = dataMemory();
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  if (args.includes('--from-data')) {
    useData();
  }
  let names;
  if (args.includes('--all')) {
    names = fs.readdirSync(path.join(ROOT, 'build/trace')).sort();
  } else {
    names = [args.includes('--script') ? args[args.indexOf('--script')+1] : 'idle'];
  }
  let checks = 0, diffs = 0, total = 0, open = 0;
  for (const name of names) {
    const [c, d, n, u] = runScript(name, verbose);
    checks += c;
    diffs += d;
    total += n;
    open += u;
  }
  console.log(`matchphysics${fromData ? ' --from-data' : ''}: ${names.length} záznamů, ${total} průchodů, ${checks} kontrol, ${diffs} rozdílů`
              + (open ? `; ${open} záznamů nedojelo (nepřevedené místo)` : ''));
  process.exit(diffs || open ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main();
}
