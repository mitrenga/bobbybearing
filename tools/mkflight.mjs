#!/usr/bin/env node
/**
 * Data pro test flight: celá partie originálu z nahrávky RZX jako vstupy
 * workeru.
 *
 *   ./tools/mkflight.mjs [--name rzx1] [--out testFlight.json]
 *
 * Bere výstup `tools/tracerules.py` (`build/rules/<name>/`): `inputs.json`
 * jsou hodnoty, které `IN` originálu dostal v každém průchodu hlavní smyčkou
 * (`[port, hodnota]`), a `start.bin` paměť ve chvíli startu hry (`$74F3`).
 * Od paměti workeru (`data/memory.json`) se start nahrávky liší jen ve
 * ★ stavu generátoru pořadí bratrů `$EE7F`/`$EE80` (jediná náhoda hry)
 * a ★ volbě ovládání `$FEE7` — obojí jde do dat, worker je dosadí před
 * `newGame` (`app/WORKER-PROTOCOL.md`, `flight`).
 *
 * Než data zapíše, přehraje je převodem (`app/bobbyLogic.js`) ze startu
 * workeru: výsledek každého průchodu musí sedět s originálem a poslední
 * průchod je konec hry. Jiný rozdíl paměti než ty dva bajty je chyba.
 *
 * Tvar (`testFlightPage.php` ho schová do `appIconSprite`):
 *
 * - `seed` — `$EE7F` + 256 × `$EE80`, `controls` — `$FEE7`
 * - `table` — různé sady čtení portů průchodu, každá `[[port, hodnota], …]`
 * - `runs` — průchody jako běhy: znak `ALPHABET` = index do `table`,
 *   za ním počet průchodů desítkově (bez čísla 1)
 * - `interrupts` — ★ kolik přerušení měl originál v každém průchodu (snímky
 *   RZX), běhy stejně; worker je pustí místo svých 1,5 na průchod, protože
 *   obsluha přerušení při třech plných kanálech píše přes `$F081`- a tempo
 *   přerušení tak dosáhne až do hry
 * - `passes`, `outcome` — počet průchodů a konec hry originálu
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { loadLogic, dataMemory } from './matchphysics.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
// tisknutelné ASCII bez číslic (za znakem běhu jde jeho délka), mezery,
// `"` a `\` (82 hodnot) — app/gameWorker.js FLIGHT_ALPHABET
export const ALPHABET = Array.from({length: 94}, (_, i) => String.fromCharCode(33+i))
  .filter((c) => !/[0-9"\\]/.test(c)).join('');

/**
 * Hodnoty po průchodech jako běhy: znak `ALPHABET` = hodnota, za ním délka.
 * @param {number[]} values
 * @returns {string|null} null, když se hodnota do abecedy nevejde.
 */
function encodeRuns(values) {
  let out = '';
  for (let i = 0; i < values.length;) {
    let n = 1;
    while (i+n < values.length && values[i+n] === values[i]) {
      n++;
    }
    if (values[i] < 0 || values[i] >= ALPHABET.length) {
      return null;
    }
    out += ALPHABET[values[i]]+(n > 1 ? String(n) : '');
    i += n;
  }
  return out;
}

function hex(v, n = 2) { return '$'+v.toString(16).toUpperCase().padStart(n, '0'); }

function main() {
  const args = process.argv.slice(2);
  const arg = (name, value) => (args.includes(name) ? args[args.indexOf(name)+1] : value);
  const name = arg('--name', 'rzx1');
  const out = path.resolve(ROOT, arg('--out', 'testFlight.json'));
  const dir = path.join(ROOT, 'build/rules', name);
  if (!fs.existsSync(path.join(dir, 'start.bin'))) {
    console.error(`chybí ${path.relative(ROOT, dir)}/start.bin – spusť ./tools/tracerules.py --name ${name}`);
    process.exit(1);
  }
  const { inputs, outcomes, frames, firstFrame } = JSON.parse(fs.readFileSync(path.join(dir, 'inputs.json'), 'utf8'));
  const start = fs.readFileSync(path.join(dir, 'start.bin'));

  // ★ start nahrávky proti paměti workeru: jen generátor a volba ovládání
  const { memory, covered } = dataMemory();
  const own = new Set([0xEE7F, 0xEE80, 0xFEE7]);
  const other = [];
  for (let a = 0x4000; a < 0x10000; a++) {
    if (covered[a] && !own.has(a) && memory[a] !== start[a]) {
      other.push(`${hex(a, 4)} ${hex(memory[a])}/${hex(start[a])}`);
    }
  }
  if (other.length) {
    console.error(`start nahrávky se od data/memory.json liší i jinde: ${other.slice(0, 10).join(', ')}`);
    process.exit(1);
  }
  const seed = start[0xEE7F] | (start[0xEE80] << 8);
  const controls = start[0xFEE7];

  // běhy nad tabulkou sad čtení portů
  const table = [], index = new Map();
  const runs = encodeRuns(inputs.map((reads) => {
    const key = JSON.stringify(reads);
    if (!index.has(key)) {
      index.set(key, table.length);
      table.push(reads);
    }
    return index.get(key);
  }));
  // ★ přerušení v průchodu: snímky RZX mezi konci průchodů
  const interrupts = encodeRuns(frames.map((frame, i) => frame-(i ? frames[i-1] : firstFrame)));
  if (runs === null || interrupts === null) {
    console.error(`hodnota mimo abecedu (${ALPHABET.length}): ${table.length} sad portů, `
                  +`nejvíc ${Math.max(...frames.map((f, i) => f-(i ? frames[i-1] : firstFrame)))} přerušení`);
    process.exit(1);
  }

  // přehrát ze startu workeru, jak to udělá worker
  const BobbyLogic = loadLogic();
  memory[0xEE7F] = seed & 0xFF;
  memory[0xEE80] = seed >> 8;
  memory[0xFEE7] = controls;
  const logic = new BobbyLogic(memory);
  logic.newGame();
  let outcome = 'pass';
  for (let i = 0; i < inputs.length; i++) {
    outcome = logic.pass(inputs[i]);
    if ((outcome === 'pass') !== (outcomes[i] === 'pass')) {
      console.error(`průchod ${i+1}: výsledek ${outcome}, originál ${outcomes[i]}`);
      process.exit(1);
    }
  }
  if (outcome === 'pass') {
    console.error(`partie po ${inputs.length} průchodech neskončila`);
    process.exit(1);
  }

  const flight = {source: name, passes: inputs.length, outcome: outcome, seed: seed, controls: controls,
                  table: table, runs: runs, interrupts: interrupts};
  fs.writeFileSync(out, JSON.stringify(flight)+'\n');
  console.log(`mkflight: ${name}, ${inputs.length} průchodů → ${outcome}, seed ${hex(seed, 4)}, ovládání ${controls}, `
              +`${table.length} sad portů, ${runs.length} + ${interrupts.length} znaků běhů → ${path.relative(ROOT, out)}`);
}

main();
