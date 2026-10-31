#!/usr/bin/env node
/**
 * `data/memory.json`: the game's memory at the start of a game, for the
 * worker — as little of it as the game needs.
 *
 *   ./tools/tracephysics.py --all && ./tools/mkmemory.mjs
 *
 * ★ The memory is the original's in the menu, the moment `0` starts the
 * game (`$74F3`, `build/trace/<skript>/start.bin`, the same for every
 * recording without a patch; M5). The new game (`BobbyLogic.newGame`,
 * `$7D87`) builds the screen, the buffer and the variables out of it. Out
 * of it goes:
 *
 * - **what the port reads before it writes it** (`app/bobbyLogic.js`): the
 *   new game, then every recording until it ends or stops at what is not
 *   ported, the building of each of the 245 rooms with its entities, the
 *   three ends of a game (`$7D06`: their texts `$749D`, `$7D5C`, `$F7DB`,
 *   the brothers' balls on the panel …) and the remake's menu (the screen
 *   after a game `$71BB` and its passes `$720C`, END_SCREENS, MENU_PASSES)
 *   — the variables, the tables, the font, the texts, the operands of the
 *   self-modifying code;
 * - the font with the brothers' names `$F80C`-`$FA27`, the sprites
 *   `$BA00`-`$C7FF`, the tables of the ball's physics `$CA12`-`$CBE6` and
 *   the tables of the sound effects `$FBF3`-`$FC93` (app/beeperPlayer.js),
 *   whole (the recordings meet only some of each).
 *
 * Room `$99` is left out of the rooms: nothing leads to it.
 *
 * What `data/world.json` already has is left out (it is the same bytes),
 * and so is the ROM — but for its one byte the game reads: ★ `$7E99` tests
 * `($16A8)` by a slip of the original (HL comes back from `$F24E` as the
 * operand of `$F4A0`; sources/docs/physics.md §10), and that byte is in the
 * ROM, `$ED`. Only a brother brought home reads it, which no recording
 * without a patch reaches, so it is listed by hand. Regions closer than
 * `GAP` bytes are joined.
 * tools/matchphysics.mjs --from-data then starts the recordings from
 * `world.json` + `memory.json` instead of `init.bin` and must find the same
 * game.
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
globalThis.WorldRenderer = loadClassicScript(path.join(ROOT, 'app/worldRenderer.js'));
const BobbyLogic = loadClassicScript(path.join(ROOT, 'app/bobbyLogic.js'));

const GAP = 16;
// ★ always whole: the font `$F70C` from the space and the brothers' names
// `$FA00` (5 × 8 B) — the recordings have met only the first name;
// the sprites `$00`-`$6F` (`$BA00`, 32 B each: the ball rolling, stunned,
// the brothers, the panel) and the tables of the ball's physics `$CA12`-
// `$CBE6` (profiles, edges, slopes): the recordings meet only some of each
const WHOLE = [[0xF80C, 0xFA28, 'font'], [0xBA00, 0xC800, 'sprites'],
               [0xCA12, 0xCBE7, 'tables'],
               // ★ the sound (M6, app/beeperPlayer.js): the six bytes of each
               // effect 1-8 ($FBF3, $FC4D …) and the template of a pitch
               // ($FC85) that the interrupt handler copies into a channel —
               // read by the player, not by the port of the main loop
               [0xFBF3, 0xFC94, 'effects'],
               // ★ the brothers (physics.md §10): the count and the 7 places
               // of $EE49 (3 B: state, room, cell) and the 8 places of
               // $EE5F (4 B: place, cell, room), 5 of which the start of a
               // game draws ($F260, L & 7) — the recordings have met only
               // the first three, so a drawn brother 3-7 came out of zeros
               [0xEE48, 0xEE7F, 'brothers'],
               // ★ the one byte of ROM the game reads ($7E99, physics.md §10)
               [0x16A8, 0x16A9, 'rom']];
// ★ the three ends of a game (`$7D06`): the text and the attribute each
// calls it with — the time out ($7494), all home ($7D5C), one lost ($F7DB)
const END_SCREENS = [[0x749D, 0x70, 'timeout'], [0x7D5C, 0x50, 'won'], [0xF7DB, 0x78, 'lost']];
// the remake's menu (gameWorker.js mode 'menu'): passes of `$720C` with the
// keys of CURSOR — down over the six discs, left on the last (a choice
// taken), back up and right onto the arrow (the start)
const MENU_PASSES = [[80, {down: true}], [10, {left: true}], [80, {up: true}], [40, {right: true}]];
const ROOMS = 245;
// ★ no exit leads to room $99, and its stream is the blocks' graphics
// (sources/docs/world.md §6): its entities read code, not data
const UNREACHABLE = [0x99];

/** A BobbyLogic that notes every address read before it was written. */
function watched(memory, reads) {
  const logic = new BobbyLogic(memory);
  const written = new Set();
  logic.rd = (a) => {
    a &= 0xFFFF;
    if (!written.has(a)) {
      reads.add(a);                 // the ROM too: a read there is a read of a constant
    }
    return memory[a];
  };
  const wr = logic.wr.bind(logic);
  logic.wr = (a, v) => {
    written.add(a & 0xFFFF);
    wr(a, v);
  };
  return logic;
}

function main() {
  const traces = path.join(ROOT, 'build/trace');
  const names = fs.readdirSync(traces).sort();
  // ★ M5: the memory the game starts from is the menu's ($74F3, start.bin):
  // the new game (BobbyLogic.newGame) builds the screen, the buffer and the
  // variables itself, so only what it reads goes into the data
  const init = fs.readFileSync(path.join(traces, 'newgame', 'start.bin'));
  const reads = new Set();
  let passes = 0;
  for (const name of names) {
    const dir = path.join(traces, name);
    if (!fs.existsSync(path.join(dir, 'inputs.json'))) {
      continue;                 // a recording still being made
    }
    const { inputs, patch, prefix, start } = JSON.parse(fs.readFileSync(path.join(dir, 'inputs.json'), 'utf8'));
    if (patch || prefix) {
      continue;                 // a patched or later start is not the game's (tracephysics.py)
    }
    if (start && !init.equals(fs.readFileSync(path.join(dir, 'start.bin')))) {
      throw new Error(`${name}: start.bin is not the same as newgame's`);
    }
    const logic = watched(Uint8Array.from(init), reads);
    logic.newGame();
    // a recording without start.bin (recorded before M5) starts where the
    // new game must have got: its init.bin
    const first = fs.readFileSync(path.join(dir, 'init.bin'));
    for (let a = 0x4000; a < 0x10000; a++) {
      // but for the stack and the sound (matchphysics.mjs SKIP)
      if ((a >= 0x6140 && a < 0x619E) || (a >= 0xF061 && a < 0xF081) || a === 0xFC88) {
        continue;
      }
      if (logic.mem[a] !== first[a]) {
        throw new Error(`${name}: the new game does not give its init.bin (${a.toString(16)})`);
      }
    }
    for (const input of inputs) {
      try {
        logic.pass(input);
      } catch (error) {
        if (!/^unported/.test(error.message)) {
          throw error;
        }
        break;
      }
      passes++;
    }
  }
  for (let n = 0; n < ROOMS; n++) {
    if (UNREACHABLE.includes(n)) {
      continue;
    }
    const logic = watched(Uint8Array.from(init), reads);
    logic.wr(0xFE4F, n);
    logic.clearBuffer();
    try {
      logic.buildRoom();
    } catch (error) {
      if (!/^unported/.test(error.message)) {
        throw error;
      }
    }
  }

  // the ends of a game, each from a new game
  for (const [text, attribute, outcome] of END_SCREENS) {
    const logic = watched(Uint8Array.from(init), reads);
    logic.newGame();
    logic.endScreen(text, attribute, outcome);
  }
  // the remake's menu: room $1E with six discs (BobbyLogic.MENU_PATCH) and
  // the screen after a game over it, then its passes
  {
    const logic = watched(Uint8Array.from(init), reads);
    Object.keys(BobbyLogic.MENU_PATCH).forEach((address) => {
      logic.wr(+address, BobbyLogic.MENU_PATCH[address]);
    });
    logic.afterGame();
    for (const [count, controls] of MENU_PASSES) {
      for (let i = 0; i < count; i++) {
        logic.afterGamePass((port) => BobbyLogic.keyboardPort(port, controls, BobbyLogic.CURSOR_KEYS));
        if (logic.outcome === 'start') {
          break;
        }
      }
    }
  }

  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8'));
  const inWorld = new Set();
  for (const region of Object.values(world.regions)) {
    const length = Buffer.from(region.bytes, 'base64').length;
    for (let i = 0; i < length; i++) {
      inWorld.add(region.address+i);
    }
  }
  const wanted = new Set([...reads].filter((a) => !inWorld.has(a)));
  for (const [from, to] of WHOLE) {
    for (let a = from; a < to; a++) {
      if (!inWorld.has(a)) {        // the arrows $C620 are in world.json
        wanted.add(a);
      }
    }
  }
  const sorted = [...wanted].sort((a, b) => a-b);
  const spans = [];
  for (const a of sorted) {
    const last = spans[spans.length-1];
    if (last && a-last[1] <= GAP) {
      last[1] = a+1;
    } else {
      spans.push([a, a+1]);
    }
  }
  const hex = (v) => v.toString(16).toUpperCase().padStart(4, '0');
  const regions = {};
  let bytes = 0;
  for (const [from, to] of spans) {
    const whole = WHOLE.find(([start]) => start === from);
    const name = whole ? whole[2] : 'm'+hex(from);
    regions[name] = {address: from, bytes: init.subarray(from, to).toString('base64')};
    bytes += to-from;
  }
  fs.writeFileSync(path.join(ROOT, 'data/memory.json'), JSON.stringify({regions}, null, 1)+'\n');
  console.log(`data/memory.json: ${spans.length} úseků, ${bytes} B `
              + `(${wanted.size} adres; ${passes} průchodů z ${names.length} záznamů, ${ROOMS-UNREACHABLE.length} místností, `
              + `${END_SCREENS.length} konce hry, menu)`);
  for (const [from, to] of spans) {
    console.log(`  $${hex(from)}–$${hex(to-1)}  ${to-from} B`);
  }
}

main();
