#!/usr/bin/env node
/**
 * M6: zvuk remaku proti originálu — hrana po hraně v T-stavech.
 *
 *   ./tools/matchsound.mjs [--verbose]
 *
 * ★ Předloha je `tools/tracesound.py`: skutečný kód obsluhy přerušení
 * `$FB08` z obrazu hry v simulátoru Z80 nad připravenou pamětí (každý
 * požadavek 1–255, dva naráz, kanály obsazené, zbytky z paměti hry) a každý
 * `OUT` na port `$FE`. Remake je **kód, který hraje v prohlížeči**:
 * `app/beeperPlayer.js` nad tou samou pamětí. Pro každou obsluhu se
 * porovná každá hrana (T od první instrukce `$FB08`, bit 4), délka obsluhy
 * a paměť po ní (`$F061`–`$F0B2`, `$FC88`).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const loadClassicScript = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
const BeeperPlayer = loadClassicScript(path.join(ROOT, 'app/beeperPlayer.js'));
const LO = 0xF061, HI = 0xF0B3;

function main() {
  const verbose = process.argv.includes('--verbose');
  const file = path.join(ROOT, 'build/sound/paths.json');
  if (!fs.existsSync(file)) {
    console.error('chybí build/sound/paths.json – spusť ./tools/tracesound.py');
    process.exit(2);
  }
  const { cases } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const image = fs.readFileSync(path.join(ROOT, 'build/trace/idle/init.bin'));
  let checks = 0, diffs = 0, interrupts = 0;
  for (const c of cases) {
    const memory = Uint8Array.from(image);
    const start = Buffer.from(c.memory, 'hex');
    memory.set(start, LO);
    const player = new BeeperPlayer(memory);
    let bad = null;
    for (let i = 0; i < c.interrupts.length && !bad; i++) {
      const ref = c.interrupts[i];
      let made;
      try {
        made = player.interrupt();
      } catch (error) {
        bad = `obsluha ${i+1}: ${error.message}`;
        break;
      }
      interrupts++;
      checks++;
      if (made.length !== ref.length) {
        bad = `obsluha ${i+1}: délka ${made.length} T, originál ${ref.length}`;
        break;
      }
      checks++;
      if (made.outs.length !== ref.outs.length) {
        bad = `obsluha ${i+1}: ${made.outs.length} hran, originál ${ref.outs.length}`;
        break;
      }
      for (let k = 0; k < ref.outs.length; k++) {
        checks++;
        if (made.outs[k][0] !== ref.outs[k][0] || made.outs[k][1] !== ref.outs[k][1]) {
          bad = `obsluha ${i+1}, hrana ${k+1}: T ${made.outs[k][0]} bit ${made.outs[k][1]}, originál T ${ref.outs[k][0]} bit ${ref.outs[k][1]}`;
          break;
        }
      }
      if (bad) { break; }
      const after = Buffer.concat([Buffer.from(memory.subarray(LO, HI)), Buffer.from([memory[0xFC88]])]).toString('hex');
      checks++;
      if (after !== ref.after) {
        bad = `obsluha ${i+1}: paměť po ní jiná`;
        if (verbose) {
          console.log('  remake   '+after+'\n  originál '+ref.after);
        }
      }
    }
    if (bad) {
      diffs++;
      console.log(`${c.name}: ${bad}`);
    } else if (verbose) {
      console.log(`${c.name}: ${c.interrupts.length} obsluh OK`);
    }
  }
  console.log(`matchsound: ${cases.length} případů, ${interrupts} obsluh, ${checks} kontrol, ${diffs} rozdílů`);
  process.exit(diffs ? 1 : 0);
}

main();
