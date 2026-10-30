#!/usr/bin/env node
/**
 * Hledá skripty kláves, které projdou co nejvíc kódu fyziky koule —
 * pro záznamy originálu (`tools/tracephysics.py`), ne místo nich.
 *
 *   ./tools/searchphysics.mjs [--rounds 3000] [--seed 1] [--max 12] [--start idle] [--prefix search]
 *
 * Převod (`app/bobbyLogic.js`) je ověřený proti originálu bajt po bajtu
 * (`tools/matchphysics.mjs`), takže poslouží jako rychlý simulátor: ze stavu
 * na začátku hry (`build/trace/idle/init.bin`) se ke stavům v zásobě
 * přidávají náhodné úseky kláves (směry, úhlopříčky, nic, `Q`; 4–120
 * průchodů) a stav se nechá, když převod prošel **blok kódu, který ještě
 * nikdo neprošel** (pokrytí V8 přes `node:inspector`). Úsek, který dojde na
 * nepřevedené místo (`unported`), se zahodí celý — záznam musí jít celý
 * proti převodu.
 *
 * Klávesy jsou **po průchodech** a do převodu jdou jako hodnoty portů
 * (`BobbyLogic.keyboardPort`), stejně jako je tracer dá originálu. Výsledek
 * (`tools/physicsscripts.json`) je výběr skriptů, které dohromady pokryjí
 * všechno nalezené; **teprve záznam originálu** z nich (`tracephysics.py`)
 * a `matchphysics.mjs` je autorita — hledání jen vybírá, kudy jet.
 *
 * Zásobu stavů nasadí i **existující záznamy** (`build/trace/*`): klávesy
 * po průchodech se z nich odvodí z hodnot portů (první čtení každé půlřady
 * v průchodu) a převod je s nimi přehraje — tak hledání začne i tam, kam
 * náhoda od startu nedojede (místnost `$01` ze záznamu `fuzz2`).
 *
 * `--start NAME` startuje z paměti záznamu `build/trace/NAME` (i se
 * záplatou z jeho `inputs.json`, tracephysics.py `patch` — bratr
 * v místnosti `$00` — a se startem z pozdějšího průchodu jiného záznamu,
 * `prefix` — místnost `$01`) a nalezené skripty nesou tutéž záplatu
 * a start; `--prefix` je jméno skriptů (`search1`…), stávající skripty
 * jiného jména v souboru zůstanou.
 *
 * Na konci vypíše metody převodu s bloky, které vybrané skripty neprojdou
 * (řádky) — i ty, které hledání našlo, ale do `--max` skriptů se nevešly.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import inspector from 'node:inspector';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const loadClassicScript = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
globalThis.atob = globalThis.atob || ((d) => Buffer.from(d, 'base64').toString('binary'));
globalThis.WorldRenderer = loadClassicScript(path.join(ROOT, 'app/worldRenderer.js'));
const LOGIC = path.join(ROOT, 'app/bobbyLogic.js');

// ★ ovládání KEYBOARD na startu: P nahoru, L dolů, Z vlevo, X vpravo, Q CHEAT
const KEY = {up: 'P', down: 'L', left: 'Z', right: 'X', cheat: 'Q'};
const MOVES = [['up'], ['down'], ['left'], ['right'], ['up', 'left'], ['up', 'right'],
               ['down', 'left'], ['down', 'right'], [], [], ['cheat']];
const OUT = path.join(HERE, 'physicsscripts.json');
// app/svision/tools/classicScript.cjs wraps the source in this
const WRAP = '(function (module, exports) {'.length;
const seen = new Map();   // every block V8 reported, "start-end" -> [start, end]

const session = new inspector.Session();
session.connect();
const post = (method, params) => new Promise((resolve, reject) => {
  session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
});

/** Seeded PRNG (mulberry32): the search can be repeated. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a+0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t+Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0)/4294967296;
  };
}

/** The blocks of bobbyLogic.js run since the last call ("start-end"). */
async function covered() {
  const {result} = await post('Profiler.takePreciseCoverage');
  const out = new Set();
  for (const script of result) {
    if (!script.url.endsWith('bobbyLogic.js')) {
      continue;
    }
    for (const fn of script.functions) {
      for (const r of fn.ranges) {
        seen.set(r.startOffset+'-'+r.endOffset, [r.startOffset, r.endOffset]);
        if (r.count > 0) {
          out.add(r.startOffset+'-'+r.endOffset);
        }
      }
    }
  }
  return out;
}

/** Runs `segment` ([{passes, held}]) from `memory`; null at a place not ported. */
function runSegment(BobbyLogic, memory, segment) {
  const mem = Uint8Array.from(memory);
  const logic = new BobbyLogic(mem);
  for (const {passes, held} of segment) {
    const controls = {};
    held.forEach((name) => { controls[name] = true; });
    for (let i = 0; i < passes; i++) {
      try {
        logic.pass((port) => BobbyLogic.keyboardPort(port, controls));
      } catch (error) {
        if (/^unported/.test(error.message)) {
          return null;
        }
        throw error;
      }
    }
  }
  return mem;
}

/**
 * The keys of a recording, pass by pass, out of the values its ports gave:
 * the first read of each half-row in the pass decides. Joined into segments.
 * @returns {Array} [{passes, held}].
 */
function recordedPath(inputs) {
  const ROWS = {up: 0xDFFE, down: 0xBFFE, left: 0xFEFE, right: 0xFEFE, cheat: 0xFBFE};
  const BITS = {up: 0x01, down: 0x02, left: 0x02, right: 0x04, cheat: 0x01};
  const path = [];
  for (const pass of inputs) {
    const first = new Map();
    for (const [port, value] of pass) {
      if (!first.has(port)) { first.set(port, value); }
    }
    const held = Object.keys(ROWS).filter((name) => first.has(ROWS[name]) && !(first.get(ROWS[name]) & BITS[name]));
    const last = path[path.length-1];
    if (last && last.held.join() === held.join()) {
      last.passes++;
    } else {
      path.push({passes: 1, held});
    }
  }
  return path;
}

/** A path of segments as a script by passes for tracephysics.py. */
function toScript(segments) {
  const keys = [];
  let at = 0;
  for (const {passes, held} of segments) {
    for (const name of held) {
      keys.push([at, at+passes, KEY[name]]);
    }
    at += passes;
  }
  return {passes: at, keys};
}

/** The methods with blocks the search never ran, with their lines. */
function report(all) {
  const source = fs.readFileSync(LOGIC, 'utf8');
  const lines = source.split('\n');
  const starts = [0];
  for (const line of lines) {
    starts.push(starts[starts.length-1]+line.length+1);
  }
  const lineOf = (offset) => {
    let lo = 0, hi = starts.length-1;
    while (lo < hi) {
      const mid = (lo+hi+1) >> 1;
      if (starts[mid] <= offset-WRAP) { lo = mid; } else { hi = mid-1; }
    }
    return lo+1;
  };
  const methodOf = (line) => {
    for (let i = line-1; i >= 0; i--) {
      const m = lines[i].match(/^  ([a-zA-Z]+)\(.*\) \{$/);
      if (m) { return m[1]; }
    }
    return '?';
  };
  // a block not run whose inside no run block covers
  const dead = new Map();
  for (const [key, [start, end]] of seen) {
    if (all.has(key) || end-start > 4000) {
      continue;
    }
    const first = lineOf(start);
    const method = methodOf(first);
    if (!dead.has(method)) { dead.set(method, []); }
    dead.get(method).push(first);
  }
  console.log('neprojeté bloky (metoda: řádky):');
  for (const [method, list] of dead) {
    console.log(`  ${method.padEnd(18)} ${[...new Set(list)].sort((a, b) => a-b).join(',')}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name)+1]) : def);
  const rounds = opt('--rounds', 3000);
  const random = prng(opt('--seed', 1));
  const max = opt('--max', 12);
  const startName = args.includes('--start') ? args[args.indexOf('--start')+1] : 'idle';
  const prefix = args.includes('--prefix') ? args[args.indexOf('--prefix')+1] : 'search';
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  const BobbyLogic = loadClassicScript(LOGIC);
  const init = new Uint8Array(fs.readFileSync(path.join(ROOT, 'build/trace', startName, 'init.bin')));
  const startInputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/trace', startName, 'inputs.json'), 'utf8'));
  const startPatch = startInputs.patch || null, startPrefix = startInputs.prefix || null;
  const samePatch = (patch, prefix) => JSON.stringify(patch || null) === JSON.stringify(startPatch)
      && JSON.stringify(prefix || null) === JSON.stringify(startPrefix);

  await covered();
  const all = new Set();
  // the pool: states with the path that led there and what it covered
  const pool = [{memory: init, path: [], blocks: new Set()}];
  // seeds: the recordings, replayed by passes, a state every 50 passes
  const traces = path.join(ROOT, 'build/trace');
  for (const name of fs.readdirSync(traces).sort()) {
    const {inputs, patch, prefix: from, passes: byPass} = JSON.parse(fs.readFileSync(path.join(traces, name, 'inputs.json'), 'utf8'));
    if (!samePatch(patch, from) || (byPass && !from)) {
      continue;                 // found before, or another start (tracephysics.py patch, prefix)
    }
    let memory = init, done = [], blocks = new Set();
    for (const step of recordedPath(inputs)) {
      for (let at = 0; at < step.passes;) {
        const n = Math.min(50, step.passes-at);
        const piece = {passes: n, held: step.held};
        await covered();
        const next = runSegment(BobbyLogic, memory, [piece]);
        const got = await covered();
        if (!next) {
          at = step.passes;
          memory = null;
          break;
        }
        got.forEach((b) => { all.add(b); blocks.add(b); });
        memory = next;
        done = done.concat([piece]);
        pool.push({memory, path: done, blocks: new Set(blocks)});
        at += n;
      }
      if (!memory) {
        break;
      }
    }
    console.log(`semínko ${name}: ${toScript(done).passes} průchodů`);
  }
  for (let round = 0; round < rounds; round++) {
    // the newer states a little more often: they are where the search got to
    const parent = pool[Math.floor(pool.length*Math.sqrt(random()))];
    const segment = [];
    const parts = 1+Math.floor(random()*3);
    for (let p = 0; p < parts; p++) {
      segment.push({passes: 4+Math.floor(random()*117), held: MOVES[Math.floor(random()*MOVES.length)]});
    }
    await covered();
    const memory = runSegment(BobbyLogic, parent.memory, segment);
    const blocks = await covered();
    if (!memory) {
      continue;
    }
    const fresh = [...blocks].filter((b) => !all.has(b));
    if (!fresh.length) {
      continue;
    }
    fresh.forEach((b) => all.add(b));
    const mine = new Set([...parent.blocks, ...blocks]);
    pool.push({memory, path: parent.path.concat(segment), blocks: mine});
    console.log(`kolo ${round}: +${fresh.length} bloků (celkem ${all.size}), stav ${pool.length-1}, `
                + `${toScript(parent.path.concat(segment)).passes} průchodů`);
  }

  // the fewest paths that cover it all: greedy by what they add
  const chosen = [];
  const left = new Set(all);
  while (left.size && chosen.length < max) {
    let best = null, gain = 0;
    for (const state of pool) {
      const g = [...state.blocks].filter((b) => left.has(b)).length;
      if (g > gain || (g === gain && best && state.path.length < best.path.length)) {
        best = state;
        gain = g;
      }
    }
    if (!best || !gain) {
      break;
    }
    best.blocks.forEach((b) => left.delete(b));
    chosen.push(best);
  }
  const scripts = {};
  if (fs.existsSync(OUT)) {
    for (const [name, script] of Object.entries(JSON.parse(fs.readFileSync(OUT, 'utf8')))) {
      if (!name.startsWith(prefix)) {
        scripts[name] = script;
      }
    }
  }
  chosen.forEach((state, i) => {
    scripts[prefix+(i+1)] = Object.assign(toScript(state.path), startPatch ? {patch: startPatch} : {},
                                          startPrefix ? {prefix: startPrefix} : {});
  });
  fs.writeFileSync(OUT, JSON.stringify(scripts, null, 1)+'\n');
  const kept = new Set();
  chosen.forEach((state) => state.blocks.forEach((b) => kept.add(b)));
  report(kept);
  const passes = Object.values(scripts).reduce((n, s) => n+s.passes, 0);
  console.log(`${path.relative(ROOT, OUT)}: ${chosen.length} skriptů, ${passes} průchodů, `
              + `${all.size-left.size} z ${all.size} nalezených bloků`);
}

main();
