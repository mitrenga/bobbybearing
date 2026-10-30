#!/usr/bin/env node
/**
 * M4: entity záznamů originálu proti `app/bobbyLogic.js` — a pokrytí kódu
 * entit.
 *
 *   ./tools/matchentities.mjs [--all | --script NAME] [--from-data] [--verbose]
 *
 * Porovnání je totéž jako v `tools/matchphysics.mjs` (importuje jeho
 * `runScript`): remake startuje z paměti záznamu a po každém průchodu se
 * porovná celá RAM `$4000`–`$FFFF`. Navíc:
 *
 * - **pokrytí** (V8 přes `node:inspector`): které bloky metod entit
 *   v `app/bobbyLogic.js` (`entities` … `spriteOperands`, `roomEntities`,
 *   `badBearing`, `mechanism`, `device`, `deviceCell`) záznamy prošly a které
 *   ne — vypíše neprojeté s čísly řádků; milník je hotový, když záznamy
 *   dají 0 rozdílů a seznam neprojetých bloků je prázdný až na to, co žádná
 *   místnost nemá (zařízení typů 3 a 7);
 * - **průchody s entitami**: kolik průchodů mělo v místnosti mechanismy
 *   (`$C864`), zařízení (`$6126`) nebo zlé Bearingy (`$FE7B`), a které
 *   místnosti to byly.
 *
 * Bez `--all` jede jen záznamy entit: skripty ze `searchphysics` (`SEARCHED`:
 * `ent*` od startu, `s07*`… ze stavů v místnostech s entitami) a ruční
 * záznamy `ENTITY_SCRIPTS` (teleporty, bratr v místnosti s entitami);
 * `--all` všechny (pokrytí z celé sady, ≈ 6 min).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import inspector from 'node:inspector';
import { runScript, loadLogic, useData } from './matchphysics.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LOGIC = path.join(ROOT, 'app/bobbyLogic.js');
// app/svision/tools/classicScript.cjs wraps the source in this
const WRAP = '(function (module, exports) {'.length;
// ★ záznamy po snímcích a se záplatou, které do entit dojedou (physics.md
// §9, §11): starší záznamy M3, bratr nalezený na svém místě, teleporty
// a bratr v místnostech s entitami
const ENTITY_SCRIPTS = ['roll', 'pause', 'fuzz1', 'fuzz2', 'fuzz3', 'brother2', 'brother4',
                        'found1', 'tele51', 'teleA2', 'bro02', 'bro02b', 'bro07', 'bro08'];
// skripty po průchodech z `searchphysics --prefix`: od startu (ent) a ze
// stavů st07, st06, tele51, teleA2, bro02, bro08
const SEARCHED = /^(ent|s07|s06|s51|sA2|b02|b08)\d+$/;
// metody entit: od první k poslední v souboru, a nahrání entit místnosti
const FIRST = 'entities', LAST = 'spriteOperands';
const ALSO = ['roomEntities', 'badBearing', 'mechanism', 'device', 'deviceCell'];

const session = new inspector.Session();
session.connect();
const post = (method, params) => new Promise((resolve, reject) => {
  session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
});

function hex(v, n = 2) { return '$'+v.toString(16).toUpperCase().padStart(n, '0'); }

/** The methods of bobbyLogic.js: name -> [first line, last line]. */
function methods() {
  const lines = fs.readFileSync(LOGIC, 'utf8').split('\n');
  const out = new Map();
  let open = null;
  lines.forEach((line, i) => {
    const m = line.match(/^  ([a-zA-Z0-9]+)\(.*\) \{(?: return .*\})?$/);
    if (m && !line.endsWith('}')) {
      open = [m[1], i+1];
    } else if (m) {
      out.set(m[1], [i+1, i+1]);          // one-line method
    } else if (open && line.startsWith('  } // '+open[0])) {
      out.set(open[0], [open[1], i+1]);
      open = null;
    }
  });
  return out;
}

/** Line starts (offsets) of the source, for offset → line. */
function lineStarts() {
  const lines = fs.readFileSync(LOGIC, 'utf8').split('\n');
  const starts = [0];
  for (const line of lines) {
    starts.push(starts[starts.length-1]+line.length+1);
  }
  return starts;
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  loadLogic();                            // compiled under the profiler
  if (args.includes('--from-data')) {
    useData();
  }
  let names;
  const all = fs.readdirSync(path.join(ROOT, 'build/trace')).sort();
  if (args.includes('--all')) {
    names = all;
  } else if (args.includes('--script')) {
    names = [args[args.indexOf('--script')+1]];
  } else {
    names = all.filter((n) => SEARCHED.test(n) || ENTITY_SCRIPTS.includes(n));
  }
  let checks = 0, diffs = 0, total = 0, open = 0;
  const withEntities = {mechanisms: 0, devices: 0, enemies: 0, any: 0};
  const rooms = new Set();
  const onPass = (logic) => {
    const m = logic.rd(0xC864) !== 0, d = logic.rd(0x6126) !== 0, e = logic.rd(0xFE7B) !== 0;
    if (m) { withEntities.mechanisms++; }
    if (d) { withEntities.devices++; }
    if (e) { withEntities.enemies++; }
    if (m || d || e) {
      withEntities.any++;
      rooms.add(logic.rd(0xFE4F));
    }
  };
  for (const name of names) {
    const [c, d, n, u] = runScript(name, verbose, onPass);
    checks += c;
    diffs += d;
    total += n;
    open += u;
  }

  // coverage of the entity methods
  const {result} = await post('Profiler.takePreciseCoverage');
  const table = methods();
  const starts = lineStarts();
  const lineOf = (offset) => {
    let lo = 0, hi = starts.length-1;
    while (lo < hi) {
      const mid = (lo+hi+1) >> 1;
      if (starts[mid] <= offset-WRAP) { lo = mid; } else { hi = mid-1; }
    }
    return lo+1;
  };
  const first = table.get(FIRST)[0], last = table.get(LAST)[1];
  const inScope = (line) => (line >= first && line <= last)
      || ALSO.some((m) => table.has(m) && line >= table.get(m)[0] && line <= table.get(m)[1]);
  const methodOf = (line) => {
    for (const [name, [a, b]] of table) {
      if (line >= a && line <= b) { return name; }
    }
    return '?';
  };
  const run = new Set(), seen = new Map();
  for (const script of result) {
    if (!script.url.endsWith('bobbyLogic.js')) { continue; }
    for (const fn of script.functions) {
      for (const r of fn.ranges) {
        if (r.endOffset-r.startOffset > 4000) { continue; }   // the class, the file
        const line = lineOf(r.startOffset);
        if (!inScope(line)) { continue; }
        const key = r.startOffset+'-'+r.endOffset;
        seen.set(key, line);
        if (r.count > 0) { run.add(key); }
      }
    }
  }
  const dead = new Map();
  for (const [key, line] of seen) {
    if (run.has(key)) { continue; }
    const m = methodOf(line);
    if (!dead.has(m)) { dead.set(m, new Set()); }
    dead.get(m).add(line);
  }
  console.log(`průchody s entitami: ${withEntities.any} (mechanismy ${withEntities.mechanisms}, `
              + `zařízení ${withEntities.devices}, zlí Bearingové ${withEntities.enemies}); `
              + `místnosti: ${[...rooms].sort((a, b) => a-b).map((r) => hex(r)).join(' ')}`);
  console.log(`pokrytí kódu entit: ${run.size} z ${seen.size} bloků`
              + (dead.size ? '; neprojeté (metoda: řádky):' : ''));
  for (const [m, lines] of dead) {
    console.log(`  ${m.padEnd(20)} ${[...lines].sort((a, b) => a-b).join(',')}`);
  }
  console.log(`matchentities${args.includes('--from-data') ? ' --from-data' : ''}: ${names.length} záznamů, `
              + `${total} průchodů, ${checks} kontrol, ${diffs} rozdílů`
              + (open ? `; ${open} záznamů nedojelo (nepřevedené místo)` : ''));
  process.exit(diffs || open ? 1 : 0);
}

main();
