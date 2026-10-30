#!/usr/bin/env node
/**
 * Projde celou smyčku workeru bez prohlížeče.
 *
 *   ./tools/runworker.mjs [--frames N] [--verbose]
 *
 * `app/gameWorker.js` se spustí v atrapě prostředí workeru (postMessage,
 * setTimeout, Date) se skutečnými daty (`data/world.json`,
 * `data/memory.json`) a projde se celý
 * protokol z `app/WORKER-PROTOCOL.md`: `init`, `controls`, `tick`, `pause`,
 * `continue` a `reset`.
 *
 * Kontroluje se:
 *
 * - worker odpoví na `init` snímkem s obrazovkou (6912 bajtů) originálu na
 *   startu hry (místnost `$00` s panelem, `build/trace/idle/init.bin`) — ★ od
 *   M5 ji z paměti menu v datech postaví sám (`BobbyLogic.newGame`); bez
 *   dat odpoví zprávou `error`
 * - tik je jeden průchod hlavní smyčky: počítadlo průchodů o jeden
 * - ★ **hra je originálu**: bez kláves je obrazovka po každém ze 200 průchodů
 *   táž jako v záznamu `idle` originálu (`tools/tracephysics.py`) — klávesy
 *   jdou do převodu jako hodnoty portů (`BobbyLogic.keyboardPort`)
 * - ★ s klávesou vpravo se koule rozjede, vyjede z místnosti `$00` do `$02`
 *   se zlým Bearingem a hra jede dál (M4), přechod zazní — snímek nese
 *   celý efekt 5 (hrany přes víc snímků stroje) na sběrnici `game` (M6, M7)
 * - skóre remaku (M7): každý snímek nese `score` `{brothers, rooms, time}`;
 *   na startu nuly (startovní místnost se nepočítá), po přechodu do `$02`
 *   `rooms` 1 a `time` = tiky hodin originálu do té chvíle (průchody + 1 za
 *   místnost), dál se bez pokroku nemění; návrat do `$00` nic nepřidá
 * - ovládání: stav dorazí celý, ★ čtyři směry originálu a `Q` CHEAT
 *   (`left`, `right`, `up`, `down`, `cheat`), neznámá klávesa (fire originál
 *   nemá) se zahodí
 * - semínko: ★ jde do generátoru pořadí bratrů `$EE7F`/`$EE80` před
 *   losováním — stejný seed = stejná partie, jiný seed = jiné pořadí (jméno
 *   hledaného bratra v panelu), každý snímek nese stav generátoru
 * - ★ **hodiny** (R-046, rozhodnutí operátora: konstantní tempo `TICK_MS` na
 *   průchod): s podstrčeným časem worker za simulovanou vteřinu udělá
 *   1000/`TICK_MS` průchodů, **nikdy nemá naplánovaný víc než jeden časovač**, `pause`
 *   je zastaví, `continue` bez `pause` nezaloží druhé, a po dlouhém výpadku
 *   (karta na pozadí) nedohání víc než čtyři průchody naráz
 * - `reset` zastaví a zahodí stav
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import zlib from 'node:zlib';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
// ★ 30 ms a pass, tried from 2026-10-30 (ZADANI chap. 2, app/gameWorker.js PASS_MS)
const TICK_MS = 30;
const DATA = {
  world: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/world.json'), 'utf8')),
  memory: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/memory.json'), 'utf8')),
};
// ★ the original without keys: its memory at the start and after each pass
// (tools/tracephysics.py --script idle)
const IDLE = path.join(ROOT, 'build/trace/idle');

/**
 * Worker v atrapě. Hodiny jsou podstrčené: `clock.now` je čas, který worker
 * vidí v `Date.now()`, a `advance(ms)` ho posouvá a spouští časovače, které
 * mezitím vypršely – tak, jak by to udělal prohlížeč.
 */
function startWorker(onMessage) {
  const clock = {now: 1000000, timers: [], nextId: 1, maxPending: 0};
  const sandbox = {
    console,
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
    btoa: (data) => Buffer.from(data, 'binary').toString('base64'),
    Date: {now: () => clock.now},
    setTimeout: (fn, ms) => {
      const id = clock.nextId++;
      clock.timers.push({id, fn, at: clock.now+Math.max(0, ms)});
      clock.maxPending = Math.max(clock.maxPending, clock.timers.length);
      return id;
    },
    clearTimeout: (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); },
    postMessage: onMessage,
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  // importScripts() jako ve workeru: cesty vůči app/, query se zahodí
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const name = file.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', name), 'utf8'), context, {filename: name});
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'), context,
                  {filename: 'gameWorker.js'});
  return {
    send(message) { sandbox.onmessage({data: message}); },
    advance(ms, step = 1) {
      const end = clock.now+ms;
      while (clock.now < end) {
        clock.now = Math.min(end, clock.now+step);
        const due = clock.timers.filter((t) => t.at <= clock.now);
        clock.timers = clock.timers.filter((t) => t.at > clock.now);
        due.forEach((t) => t.fn());
      }
    },
    clock,
    context,
  };
}

let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) {
    failures++;
    console.log('  CHYBA: '+label);
  }
}

function run(initData, frames, verbose, controls) {
  const messages = [];
  const worker = startWorker((message) => {
    messages.push(message);
    if (verbose) { console.log(JSON.stringify(message).slice(0, 200)); }
  });
  worker.send({id: 'init', initData: Object.assign({headless: true}, DATA, initData)});
  if (controls) { worker.send(Object.assign({id: 'controls'}, controls)); }
  for (let step = 0; step < frames; step++) {
    worker.send({id: 'tick'});
  }
  return {worker, messages};
}

const lastScreen = (msgs) => {
  for (let i = msgs.length-1; i >= 0; i--) { if (msgs[i].screen) { return msgs[i].screen; } }
  return null;
};
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

function main() {
  const args = process.argv.slice(2);
  const frames = args.includes('--frames')
    ? parseInt(args[args.indexOf('--frames')+1], 10) : 100;
  const verbose = args.includes('--verbose');

  // --- bez dat: chyba, ne prázdná hra
  const empty = [];
  startWorker((message) => empty.push(message)).send({id: 'init', initData: {headless: true}});
  check(empty.length === 1 && empty[0].id === 'error', 'init bez data/world.json odpoví zprávou error');
  const half = [];
  startWorker((message) => half.push(message)).send({id: 'init', initData: {headless: true, world: DATA.world}});
  check(half.length === 1 && half[0].id === 'error', 'init bez data/memory.json odpoví zprávou error');

  // --- init a snímek
  const {worker, messages} = run({}, frames, verbose);
  const first = messages[0];
  check(first && first.id === 'frame', 'init odpovědělo snímkem');
  check(first && first.frame === 0 && first.pass === 0, 'snímek po init má frame 0 a pass 0');
  const screen = first && first.screen ? Buffer.from(first.screen, 'base64') : null;
  check(screen && screen.length === 6912, 'snímek po init nese obrazovku, 6912 bajtů');
  const init = fs.readFileSync(path.join(IDLE, 'init.bin'));
  check(screen && screen.equals(init.subarray(0x4000, 0x5B00)),
        'obrazovka po init = obrazovka originálu na startu hry');
  check(first && first.controls !== undefined, 'snímek nese stav ovládání');

  // --- tik: jeden průchod
  const last = messages[messages.length-1];
  check(messages.length === frames+1, `${frames} tiků = ${frames} snímků (+1 za init), je ${messages.length}`);
  check(last.pass === frames && last.frame === frames, `počítadlo průchodů je ${frames} (je ${last.pass})`);
  check(messages.slice(1).every((m) => m.screen), 'každý průchod posílá obrazovku');

  // --- hra originálu: bez kláves obrazovka po každém průchodu jako v idle
  const {inputs} = JSON.parse(fs.readFileSync(path.join(IDLE, 'inputs.json'), 'utf8'));
  const idle = run({}, inputs.length).messages;
  const xor = zlib.gunzipSync(fs.readFileSync(path.join(IDLE, 'passes.xor.gz')));
  const ram = Uint8Array.from(init.subarray(0x4000));
  let bad = -1;
  for (let i = 0; i < inputs.length; i++) {
    for (let k = 0; k < 0xC000; k++) {
      ram[k] ^= xor[i*0xC000+k];
    }
    const mine = idle[i+1] && idle[i+1].screen ? Buffer.from(idle[i+1].screen, 'base64') : null;
    checks++;
    if (!mine || !mine.equals(Buffer.from(ram.subarray(0, 6912)))) {
      failures++;
      bad = i+1;
      break;
    }
  }
  if (bad > 0) {
    console.log(`  CHYBA: obrazovka po průchodu ${bad} jiná než v záznamu idle originálu`);
  }

  // --- vpravo: koule se rozjede, vyjede z místnosti $00 do $02 se zlým
  // Bearingem, magnety a blokem na čas — a hra jede dál (M4)
  const right = run({}, 60, false, {right: true}).messages;
  check(right[20] && right[20].screen !== idle[20].screen,
        's klávesou vpravo je obrazovka po 20 průchodech jiná než bez kláves');
  const stop = right.find((m) => m.id === 'stopped');
  check(!stop, 'v místnosti $02 se zlým Bearingem hra nestojí'
        + (stop ? ` (průchod ${stop.pass}: ${stop.message})` : ''));
  check(right.length === 61 && right[60].id === 'frame' && right[60].pass === 60,
        '60 průchodů s klávesou vpravo = 60 snímků');
  // ★ M6/M7: the sound — the change of room asks for effect 5 ($7858), the
  // interrupt handler takes the request and the frame carries the whole
  // effect rendered (renderEffect) on the bus of the room change
  const effects = right.flatMap((m) => (m.sounds || []).filter((e) => e.id === 'effect'));
  const room = effects.find((e) => e.value === 5);
  check(room && room.bus === 'game', 'přechod místnosti pošle efekt 5 na sběrnici game');
  check(room && room.outs.length > 20 && room.length > 10*69888,
        `efekt 5 je celý: ${room && room.outs.length} hran přes ${room && (room.length/69888).toFixed(0)} snímků`);
  check(effects.every((e) => e.outs.every((o, i) => o[0] >= 0 && o[0] <= e.length && (o[1] === 0 || o[1] === 1) && (i === 0 || o[0] >= e.outs[i-1][0]))),
        'hrany efektu leží v jeho délce, jdou po sobě a mají bit 0/1');
  check(effects.every((e) => e.length % 69888 === 0), 'délka efektu jsou celé snímky stroje');
  check(right.every((m) => (m.sounds || []).every((e) => e.id === 'effect')), 'snímky nesou jen celé efekty, ne jednotlivé obsluhy');

  // --- skóre remaku (M7): tři čísla z paměti originálu po každém průchodu
  check(right.every((m) => m.score && typeof m.score.brothers === 'number' && typeof m.score.rooms === 'number' && typeof m.score.time === 'number'),
        'každý snímek nese score {brothers, rooms, time}');
  check(right[0].score.brothers === 0 && right[0].score.rooms === 0 && right[0].score.time === 0,
        'na startu je skóre nulové: startovní místnost se nepočítá');
  const entered = right.findIndex((m) => m.score && m.score.rooms === 1);
  check(entered > 0, 'po přechodu do místnosti $02 je rooms 1');
  const entry = right[entered];
  // ★ a tick of time every pass and one more for the new room ($7CCB):
  // the remake's counter of the ticks (BobbyLogic.timeTicks) is passes+1
  const expected = entered+1;
  check(entry && entry.score.time === expected,
        `time po přechodu = tiky hodin originálu (${entered} průchodů + místnost → ${expected}, je ${entry && entry.score.time})`);
  check(entry && entry.score.brothers === 0, 'bratři doma 0');
  const inRoom = right.slice(entered).filter((m) => m.score.rooms === 1);
  check(inRoom.length > 10 && inRoom.every((m) => m.score.time === entry.score.time),
        'bez dalšího pokroku se čas nemění');

  // --- ovládání: čtyři směry a CHEAT, celé, neznámá se zahodí
  worker.send({id: 'controls', left: true, up: true, cheat: true, fire: true});
  worker.send({id: 'tick'});
  const controls = messages[messages.length-1].controls;
  check(controls.left && controls.up && controls.cheat && !controls.right && !controls.down,
        'stav ovládání dorazil celý, i CHEAT');
  check(!('fire' in controls), 'neznámá klávesa (fire originál nemá) se zahodila');
  check(Object.keys(controls).sort().join() === 'cheat,down,left,right,up',
        'ovládání má právě čtyři směry a CHEAT');

  // --- semínko: ★ jediná náhoda originálu je stav generátoru pořadí bratrů
  // $EE7F/$EE80; seed do něj jde před losováním (rozhodnuto 2026-10-30)
  const strip = (msgs) => JSON.stringify(msgs.map((m) => Object.assign({}, m, {screen: m.screen ? m.screen.length : 0})));
  const runA = run({seed: 0xABCD}, 60), runC = run({}, 60), runD = run({seed: 0x1234}, 60);
  const a = runA.messages;
  const b = run({seed: 0xABCD}, 60).messages;
  const c = runC.messages;
  const d = runD.messages;
  check(strip(a) === strip(b), 'tentýž seed dá tentýž průběh');
  check(a.every((m) => typeof m.generator === 'number'), 'každý snímek nese stav generátoru');
  check(a[0].generator !== c[0].generator, 'seed změní stav generátoru proti losování z dat');
  check(a[0].generator !== d[0].generator, 'jiný seed, jiný stav generátoru po losování');
  // ★ the order drawn ($FEF0-$FEF4) decides the brothers' places, not the
  // names on the panel (those go by count), so it is read off the memory
  const order = (r) => Array.from(vm.runInContext('state.logic.mem', r.worker.context).subarray(0xFEF0, 0xFEF5)).join();
  check(order(runA) !== order(runC) && order(runA) !== order(runD), `jiný seed, jiné pořadí bratrů (${order(runA)} / ${order(runC)} / ${order(runD)})`);
  check(new Set(order(runA).split(',')).size === 5, 'pět různých míst z osmi');

  // --- reset v headless režimu zastaví tikání
  const before = messages.length;
  worker.send({id: 'reset'});
  worker.send({id: 'tick'});
  check(messages.length === before, 'reset zastaví headless tikání');

  // --- hodiny (R-046)
  const live = [];
  const clocked = startWorker((message) => live.push(message));
  clocked.send({id: 'init', initData: Object.assign({headless: false}, DATA)});
  clocked.advance(1000);
  const ticks = live.length-1;
  check(ticks === Math.round(1000/TICK_MS), `za vteřinu ${Math.round(1000/TICK_MS)} průchodů po ${TICK_MS} ms (je ${ticks})`);
  clocked.advance(10000);
  const tenSeconds = live.length-1-ticks;
  check(Math.abs(tenSeconds-Math.round(10000/TICK_MS)) <= 1,
        `za deset vteřin ${Math.round(10000/TICK_MS)} průchodů (je ${tenSeconds})`);
  check(clocked.clock.maxPending === 1, `nikdy víc než jeden naplánovaný časovač (bylo ${clocked.clock.maxPending})`);

  clocked.send({id: 'pause'});
  const paused = live.length;
  clocked.advance(1000);
  check(live.length === paused, 'pause zastaví hodiny');
  check(clocked.clock.timers.length === 0, 'po pause nezůstal naplánovaný časovač');

  clocked.send({id: 'continue'});
  clocked.send({id: 'continue'});
  check(clocked.clock.timers.length === 1, 'continue dvakrát nezaloží dvoje hodiny');
  const resumed = live.length;
  clocked.advance(1000);
  check(Math.abs(live.length-resumed-Math.round(1000/TICK_MS)) <= 1, `po continue zase ${Math.round(1000/TICK_MS)} průchodů za vteřinu (je ${live.length-resumed})`);

  // karta v pozadí: prohlížeč časovač zdrží o deset vteřin
  const stalled = live.length;
  const timer = clocked.clock.timers[0];
  timer.at = clocked.clock.now+10000;
  clocked.advance(10000+TICK_MS, 1);
  check(live.length-stalled <= 5, `po výpadku nejvýš čtyři průchody naráz, ne stovky (je ${live.length-stalled})`);

  clocked.send({id: 'reset'});
  check(clocked.clock.timers.length === 0, 'reset zastaví hodiny');
  const afterReset = live.length;
  clocked.advance(1000);
  check(live.length === afterReset, 'po reset už nic netiká');

  console.log(`${checks} kontrol, **${failures} chyb**`);
  process.exit(failures ? 1 : 0);
}

main();
