#!/usr/bin/env node
/**
 * Obrazovka po hře originálu (`$71BB`, výběr ovládání koulí) průchod po
 * průchodu proti `app/bobbyLogic.js`.
 *
 *   ./tools/matchaftergame.mjs [--script idle] [--all] [--verbose]
 *
 * Záznam dělá `tools/traceaftergame.py` (`build/aftergame/<skript>/`):
 * paměť na `$71BB` (`init.bin`), RAM po vstupu a po každém průchodu smyčkou
 * `$720C` (`passes.xor.gz`) a hodnoty instrukcí `IN` (`inputs.json`).
 *
 * Remake začne ze stejné paměti, udělá vstup (`BobbyLogic.afterGame`) a pak
 * se stejnými vstupy stejné průchody (`afterGamePass`). Po vstupu i po
 * každém průchodu se porovná **celá RAM `$4000`–`$FFFF`** kromě `SKIP`
 * z `matchphysics.mjs` (zásobník, zvuk přerušení). Průchod, ve kterém
 * originál došel na start hry (`$7481`), musí vrátit `start`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { loadLogic, SKIP } from './matchphysics.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BASE = path.join(ROOT, 'build/aftergame');

function hex(v, n = 4) { return '$'+v.toString(16).toUpperCase().padStart(n, '0'); }

function skipped(a) {
  return SKIP.some(([lo, hi]) => a >= lo && a < hi);
}

/**
 * Jeden záznam proti převodu.
 * @param {string} name - build/aftergame/<name>.
 * @param {boolean} verbose - Každý průchod vypsat.
 * @returns {Array} [kontrol, rozdílů, průchodů].
 */
export function runScript(name, verbose) {
  const BobbyLogic = loadLogic();
  const dir = path.join(BASE, name);
  if (!fs.existsSync(path.join(dir, 'init.bin'))) {
    console.error(`chybí ${path.relative(ROOT, dir)} – spusť ./tools/traceaftergame.py --script ${name}`);
    return [0, 1, 0];
  }
  const { inputs, outcomes } = JSON.parse(fs.readFileSync(path.join(dir, 'inputs.json'), 'utf8'));
  const memory = new Uint8Array(fs.readFileSync(path.join(dir, 'init.bin')));
  const passes = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'passes.xor.gz')));
  const size = 0xC000;
  const ram = new Uint8Array(size);
  const logic = new BobbyLogic(memory);
  let checks = 0;
  for (let i = 0; i < inputs.length; i++) {
    const block = passes.subarray(i*size, (i+1)*size);
    for (let k = 0; k < size; k++) {
      ram[k] ^= block[k];
    }
    const label = i === 0 ? 'vstup $71BB' : `průchod ${i}`;
    try {
      if (i === 0) {
        logic.input = inputs[0].slice();
        logic.afterGame();
        logic.checkInput();
      } else {
        const outcome = logic.afterGamePass(inputs[i]);
        if (outcome !== outcomes[i]) {
          console.log(`${name}: ${label}: výsledek ${outcome}, originál ${outcomes[i]}`);
          return [checks, 1, i];
        }
      }
    } catch (error) {
      console.log(`${name}: ${label}: ${error.message}`);
      return [checks, 1, i];
    }
    for (let k = 0; k < size; k++) {
      const a = k+0x4000;
      if (skipped(a)) {
        continue;
      }
      checks++;
      if (memory[a] !== ram[k]) {
        const list = [];
        let n = 0;
        for (let j = k; j < size; j++) {
          if (!skipped(j+0x4000) && memory[j+0x4000] !== ram[j]) {
            n++;
            if (list.length < 12) {
              list.push(`${hex(j+0x4000)} ${hex(memory[j+0x4000], 2)}/${hex(ram[j], 2)}`);
            }
          }
        }
        console.log(`${name}: ${label}: ${n} rozdílů (remake/originál): ${list.join(', ')}`);
        return [checks, n, i];
      }
    }
    if (verbose) {
      console.log(`${name}: ${label} OK`);
    }
  }
  console.log(`${name}: vstup + ${inputs.length-1} průchodů, ${checks} kontrol, 0 rozdílů`);
  return [checks, 0, inputs.length-1];
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const names = args.includes('--all') ? fs.readdirSync(BASE).sort()
      : [args.includes('--script') ? args[args.indexOf('--script')+1] : 'idle'];
  let checks = 0, diffs = 0, total = 0;
  for (const name of names) {
    const [c, d, n] = runScript(name, verbose);
    checks += c;
    diffs += d;
    total += n;
  }
  console.log(`matchaftergame: ${names.length} záznamů, ${total} průchodů, ${checks} kontrol, ${diffs} rozdílů`);
  process.exit(diffs ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main();
}
