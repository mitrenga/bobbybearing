#!/usr/bin/env node
/**
 * M5: celé partie originálu proti `app/bobbyLogic.js` — od startu z menu po
 * koncovou obrazovku.
 *
 *   ./tools/matchrules.mjs [--name rzx1] [--verbose]
 *
 * Záznamy jsou v `build/rules/` (`tools/tracerules.py`: partie z nahrávky
 * RZX, 135 880 snímků hráče) a v `build/trace/` ty, které začínají nebo
 * končí hru (`tracephysics.py`: `newgame` od startu bez záplaty, `timeout`,
 * `lasthome`, `lostone` s koncem). Porovnání dělá `tools/matchphysics.mjs`
 * (`runScript`): nová hra ze `start.bin` (`BobbyLogic.newGame`) musí dát
 * paměť prvního průchodu, pak celá RAM po každém průchodu, a průchod, ve
 * kterém hra končí, musí vrátit jiný výsledek než `pass` a paměť koncové
 * obrazovky (`$7D45`).
 *
 * Navíc se **počítá, co se v partii stalo** — místnosti, bratři nalezení
 * (`$FE35`), doma a ztracení (`$FEF0`), omráčení Bobbyho (`$FE50`), čas na
 * konci, pauzy — jako doklad pravidel v `sources/docs/physics.md` §12.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { runScript } from './matchphysics.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const RULES = path.join(ROOT, 'build/rules');
const TRACE = path.join(ROOT, 'build/trace');
// ★ záznamy tracephysics.py se startem nebo koncem hry (M5)
const TRACE_SCRIPTS = ['newgame', 'timeout', 'lasthome', 'lostone'];

function hex(v, n = 2) { return '$'+v.toString(16).toUpperCase().padStart(n, '0'); }

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const list = [];
  if (args.includes('--name')) {
    list.push([args[args.indexOf('--name')+1], RULES]);
  } else {
    if (fs.existsSync(RULES)) {
      fs.readdirSync(RULES).sort().forEach((n) => list.push([n, RULES]));
    }
    TRACE_SCRIPTS.forEach((n) => { if (fs.existsSync(path.join(TRACE, n))) { list.push([n, TRACE]); } });
  }
  let checks = 0, diffs = 0, total = 0, open = 0;
  for (const [name, base] of list) {
    const rooms = new Set();
    let found = 0, stunned = 0, lastBrothers = null, home = 0, lost = 0, time = '';
    const onPass = (logic) => {
      rooms.add(logic.rd(0xFE4F));
      const b = logic.rd(0xFE35);
      if (lastBrothers !== null && b < lastBrothers) { found++; }
      lastBrothers = b;
      if (logic.rd(0xFE50) !== 0) { stunned++; }
      home = 0; lost = 0;
      for (let i = 0; i < 5; i++) {
        const v = logic.rd(0xFEF0+i);
        if (v === 0xFF) { lost++; } else if (i >= 5-b) { home++; }
      }
      time = [0xFE66, 0xFE67, 0xFE68, 0xFE69].map((a) => hex(logic.rd(a))).join(' ');
    };
    const [c, d, n, u] = runScript(name, verbose, onPass, base);
    checks += c; diffs += d; total += n; open += u;
    console.log(`  ${name}: ${rooms.size} místností, bratrů ubylo ${found}×, průchodů s omráčeným Bobbym ${stunned}, `
                + `ztracených ${lost}, čas na konci ${time}`);
  }
  console.log(`matchrules: ${list.length} záznamů, ${total} průchodů, ${checks} kontrol, ${diffs} rozdílů`
              + (open ? `; ${open} záznamů nedojelo (nepřevedené místo)` : ''));
  process.exit(diffs || open ? 1 : 0);
}

main();
