// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * Bobby Bearing game worker.
 *
 * It keeps the game and ticks; the model only sends it the controls and draws
 * the screen that comes back (WORKER-PROTOCOL.md).
 *
 * ★ **The game is the original's, pass for pass** (M3-M5). The
 * worker keeps the original's memory, 64 KB laid out as on the machine —
 * data/world.json and data/memory.json over zeros (tools/mkmemory.mjs) —
 * and runs its main loop `$751E` through the port in app/bobbyLogic.js
 * (sources/docs/physics.md). tools/matchphysics.mjs --from-data starts the
 * recordings of the original from these same data and finds the same
 * memory after every pass. The controls go in as what the keyboard ports
 * give (`BobbyLogic.keyboardPort`), the screen goes out as the video memory.
 *
 * ★ A new game is the original's (`BobbyLogic.newGame`: `$D969` → `$7D87`,
 * M5) out of the menu's memory, and the game ends the original's way: the
 * end screen (`$7D06`) comes in the last `frame` with its `outcome`
 * ('won', 'lost', 'timeout'); the original then waits ≈ 7 s and shows its
 * screen of controls — the model's turn (its menu).
 *
 * ? What is not ported yet (devices no room has) stops the game: the
 * worker sends `stopped` and the model says where (WORKER-PROTOCOL.md).
 *
 * ★ **One clock: the pass of the main loop.** The original's main loop does
 * not wait for the frame — work, a delay that depends on how many balls
 * roll ($7648, 2×/1×/0×), and the sound effects in the interrupt; a pass
 * takes 1.5-2.2 frames, 39.24 ms on average over a whole game. **The remake
 * does not simulate that** (operator's decision 2026-10-29, as in Booty):
 * a pass every `PASS_MS` ms, constant (40 ms at first, 30 ms tried, 35 ms decided on
 * 2026-10-30 by the operator). The time on the panel goes down
 * once a pass in the original ($7404), so the length of a game comes out as
 * the original's average.
 *
 * ★ **One randomness**: the original has no source of it in the game (no
 * `LD A,R`, no FRAMES, no ROM tables, hw_notes.md); the start of a game
 * draws the order of the brothers with the generator over `$EE7F`/`$EE80`
 * ($F260), whose state is what the last game left in memory. The worker
 * builds the memory anew for every game, so the `seed` of `init` goes into
 * `$EE7F`/`$EE80` before the new game (operator 2026-10-30, option 2 of
 * WORKER-PROTOCOL.md): the model gives the first game a seed of the clock
 * and every next game the state the last one ended with (`generator` of
 * the frame), as the original's memory would. `Math.random()` is not used.
 *
 * ★ The clock is a recursive `setTimeout` with an accumulator (R-046): it
 * measures how much time really went by and spends it in whole passes, at
 * most four at once, so a tab coming back from the background does not run
 * off with thousands of them. `setInterval` is not used anywhere.
 */

var query = (typeof self !== 'undefined' && self.location) ? self.location.search : '';
if (typeof importScripts === 'function') {
  importScripts('worldRenderer.js'+query, 'bobbyLogic.js'+query, 'beeperPlayer.js'+query);
}

// ★ 35 ms a pass (operator 2026-10-30, the pace closest to the original by eye; 40 and 30 ms tried before, the original 39.24 ms on average)
// ZADANI chap. 2, ScreenLayout.PASS_MS
var PASS_MS = 35;
var MAX_CATCH_UP = 4;
// ★ the ULA interrupt every 69 888 T = 19.968 ms: the sound handler runs
// once a frame of the machine, so a pass of PASS_MS gets one or two of them
// (M6, physics.md §13) — a deviation like the pace itself: the original
// has 1.5-2.2 frames a pass, the remake 1.5
var FRAME_MS = 69888/3500;
// the menu's steering to a click or a touch (steerToTarget): the middle of
// the ball's sprite from its corner ($FDE8/$FDE9, 16 × 16 px), how near
// is there (px), the passes without a move that end the column, how many
// times a lost column is taken up again, the passes of an axis held
// without speed that tell a wall, that speed (★ $8437: a free axis held
// picks up 2 a pass), and the most passes a target is rolled to (≈ 10 s)
// ★ the ball of the menu: its state ($FDE8-$FEEF, the run $71E9 clears on
// the screen after a game) and the choice with the disc under it ($72D6,
// $72DF) — what the menu keeps over SHOW TAPE LOADING (menuBall)
var BALL_REGIONS = [[0xFDE8, 0xFEF0], [0x72D6, 0x72D7], [0x72DF, 0x72E0]];
var STEER_BALL_CENTRE = 8;
var STEER_TOLERANCE = 3;
var STEER_STILL = 6;
var STEER_RETURNS = 3;
var STEER_STUCK = 3;
var STEER_PICK_UP = 4;
var STEER_MAX_PASSES = 300;

var state = null;
// the ball of the menu when the menu last went (menuBall): the menu comes
// back with it after SHOW TAPE LOADING
var menuBall = null;
var timer = null;
var lastTime = false;
var accumulator = 0;
// the number the model gave the last `init` (WORKER-PROTOCOL.md), or null
// after a reset: every message carries it, so that the app drops what a
// model that went sent before the next one's init (a frame of the menu with
// the ball on the arrow ended the new game at once, 2026-11-01)
var session = null;

/** A message to the model, with the number of the session. */
function post(message) {
  message.session = session;
  postMessage(message);
} // post

function reset() {
  if (state && state.menu && state.logic) {
    menuBall = menuBall || {};
    BALL_REGIONS.forEach((region) => {
      menuBall[region[0]] = state.logic.mem.slice(region[0], region[1]);
    });
  }
  clearTimeout(timer);
  timer = null;
  lastTime = false;
  accumulator = 0;
  session = null;
  state = {
    running: false, paused: false, headless: false,
    // the remake's menu: the original's screen after a game ($71BB) in the
    // room with six discs (BobbyLogic.MENU_PATCH) instead of a game
    menu: false,
    // passes of the main loop since the game started
    pass: 0,
    hiScore: 0,
    // ★ the original's four directions (the Kempston bits of $FDF6) and
    // `Q` CHEAT ($81EA)
    controls: {left: false, right: false, up: false, down: false, cheat: false},
    // the remake's menu: the point the ball rolls to after a click or a
    // touch (steerToTarget), or null, and whether it steered the last pass
    target: null,
    steered: false,
    // the seam for the source of randomness (none in the original)
    seed: null,
    // the port of the main loop over the original's memory
    logic: null,
    // why the game stopped (a place not ported yet), or null
    stopped: null,
    // 'pass' while the game goes on, then how it ended
    outcome: 'pass',
    // ★ the sound: the interrupt handler over the game's memory (M6), the
    // frames of the machine owed to it (ms), and the frames a long handler
    // ran over (its next interrupts are lost: DI)
    beeper: null,
    frameDebt: 0,
    lostFrames: 0,
    // the effects rendered whole, by the value of the request (renderEffect)
    effects: {},
    // the 6912 bytes of the screen, base64
    screen: null,
    // a deduction of the time being shown (countdownStep), or null
    countdown: null,
    // CHEAT taken once a press: after the pass that read it, not again
    // until it is let go (tick, countdownStep)
    cheatBlocked: false,
    sounds: [],
    // the remake's score (M7, outside the original's memory): see score()
    score: {brothers: 0, rooms: 0, time: 0},
    // the rooms Bobby has been in, one byte a room
    visited: new Uint8Array(256)
  };
} // reset

/**
 * ★ The score of the remake (M7, operator 2026-10-30): the original keeps
 * none, so the hall of fame ranks three numbers read off the original's
 * memory after every pass, none of them written back into it:
 *
 * - `brothers` — brought home: `5 − $FE35` less the ones lost (`$FF` in
 *   `$FEF0`-`$FEF4`, brotherStun), 0-5;
 * - `rooms` — the rooms Bobby has been in (`$FE4F`), each once, without
 *   the starting room `$00` — a game left at once scores 0 and is not
 *   stored (R-049);
 * - `time` — the game's time gone by at the moment of the **last
 *   progress** (a new room or a brother home), as the remake's own counter
 *   of the ticks of the original's clock (`BobbyLogic.timeTicks`: one for
 *   every tick of `$7404`, eight to a unit of the panel's last digit; 0 at
 *   the start). The original's clock, not the remake's: `Q` CHEAT and the
 *   penalties cost ticks on purpose; ★ the 1000 a brother home gives the
 *   clock back (`$7E8F`) is not a tick and does not count; what comes
 *   after the last progress does not count either. Rank: brothers and
 *   rooms down, time up.
 */
function score() {
  var mem = state.logic.mem;
  var progress = false;
  var room = mem[0xFE4F];
  if (room !== 0 && !state.visited[room]) {
    state.visited[room] = 1;
    state.score.rooms++;
    progress = true;
  }
  var lost = 0;
  for (var i = 0; i < 5; i++) {
    if (mem[0xFEF0+i] === 0xFF) {
      lost++;
    }
  }
  var brothers = Math.max(0, 5-mem[0xFE35]-lost);
  if (brothers > state.score.brothers) {
    state.score.brothers = brothers;
    progress = true;
  }
  if (progress) {
    state.score.time = state.logic.timeTicks;
  }
} // score

/**
 * The 'frame' message: what the model draws and counts.
 * @param {boolean} withScreen - Whether the screen goes with it.
 */
function frame(withScreen) {
  var out = {
    id: 'frame',
    // R-045: the counter the model reads its third FPS number off
    frame: state.pass,
    pass: state.pass,
    // ★ 'pass', or the way the game ended: 'won' (all brothers home,
    // $7CE5), 'lost' (home with one lost), 'timeout' ($7494), 'quit'
    outcome: state.outcome,
    controls: Object.assign({}, state.controls),
    sounds: state.sounds,
    // M7: the remake's three numbers (score())
    score: Object.assign({}, state.score),
    // ★ the state of the generator of the brothers' order ($EE7F/$EE80):
    // the seed of the next game
    generator: state.logic ? state.logic.mem[0xEE7F] | (state.logic.mem[0xEE80] << 8) : 0
  };
  if (state.menu) {
    // ★ the menu: the cell under the ball ($FE2C) and the choice ($72D6,
    // 0-5 = the discs, $10 under the ball = the arrow, START); the disc
    // under the ball (`$72DF` = cell AND 7, 2-7 → 0-5, else -1) and whether
    // a direction held on it took it in this pass ($724A, left or right)
    var disc = state.logic.mem[0x72DF];
    out.menu = {cell: state.logic.mem[0xFE2C], choice: state.logic.mem[0x72D6],
                disc: disc >= 2 ? disc-2 : -1, taken: !!state.logic.choiceTaken,
                start: state.outcome === 'start',
                // ★ the ball's place on the screen ($FDE8 line, $FDE9 column of
                // its sprite) and whether the pass rolled it to a target
                ball: {x: state.logic.mem[0xFDE9], y: state.logic.mem[0xFDE8]},
                steered: state.steered};
  }
  if (withScreen) {
    out.screen = state.screen;
  }
  state.sounds = [];
  return out;
} // frame

/**
 * One pass of the main loop (`BobbyLogic.pass`), the screen out after it.
 * A place not ported yet stops the game.
 */
function tick() {
  if (state.stopped || !state.running) {
    return;
  }
  var outcome;
  if (state.menu) {
    menuTick();
    return;
  }
  if (state.countdown) {
    countdownStep();
    return;
  }
  state.logic.timeLog = {screen: null, digits: []};
  try {
    // ★ Q held keeps the ball stunned ($81EA: $FE50 = 2 every pass) and
    // the deduction comes when it is let go; the remake reads Q in one pass
    // a press, so the stun, its animation and the deduction go at once
    // (operator 2026-10-31)
    var controls = state.cheatBlocked ? Object.assign({}, state.controls, {cheat: false}) : state.controls;
    if (controls.cheat) {
      state.cheatBlocked = true;
    }
    outcome = state.logic.pass((port) => BobbyLogic.keyboardPort(port, controls));
  } catch (error) {
    state.stopped = error.message;
    state.running = false;
    stopClock();
    post({id: 'stopped', pass: state.pass, message: error.message});
    return;
  }
  state.pass++;
  interrupts();
  score();
  state.screen = toBase64(state.logic.screen());
  var log = state.logic.timeLog;
  state.logic.timeLog = null;
  var steps = log.screen ? Math.floor(log.digits.length*BobbyLogic.TICK_T/3500/PASS_MS) : 0;
  if (steps > 0) {
    state.countdown = {log: log, steps: steps, step: 0, outcome: outcome};
    countdownStep();
    return;
  }
  passDone(outcome);
} // tick

/**
 * ★ A deduction of the time shown as the original shows it (Q CHEAT, a
 * fall: `$7F73`, B × 8 ticks): the original draws the digits after every
 * tick, and the game stands for the ticks' T states (BobbyLogic.TICK_T,
 * 1600 ticks ≈ 1.2 s), the ball still where the deduction found it. The
 * pass is played whole at once (BobbyLogic.timeLog); then, a step every
 * PASS_MS, the screen as the deduction found it with the digits of the
 * tick it would be at, the interrupts going on (the sound); the pass's own
 * frame comes last. The controls are not read meanwhile, as there.
 *
 * Q pressed while it runs is not taken, nor Q still held after it: CHEAT
 * waits till it is let go (`cheatBlocked`) — the remake's, the original
 * reads Q every pass (operator 2026-10-31).
 */
function countdownStep() {
  var c = state.countdown;
  c.step++;
  if (c.step > c.steps) {
    state.countdown = null;
    // Q pressed during the deduction waits till it is let go
    state.cheatBlocked = state.controls.cheat;
    passDone(c.outcome);
    return;
  }
  var screen = c.log.screen.slice();
  BobbyLogic.putTimeDigits(screen, c.log.digits[Math.floor(c.step*c.log.digits.length/(c.steps+1))-1]
                                   || c.log.digits[0]);
  interrupts();
  var out = frame(false);
  out.screen = toBase64(screen);
  post(out);
} // countdownStep

/** The frame of a pass out; a game that ended stops the clock. */
function passDone(outcome) {
  if (outcome !== 'pass') {
    // ★ the game ended ($7D06: the end screen is on the screen; M5): the
    // last frame carries the outcome, the clock stops
    state.running = false;
    stopClock();
    state.outcome = outcome;
  }
  post(frame(true));
} // passDone

/**
 * ★ One turn of the menu: the pass of the screen after a game
 * (`BobbyLogic.afterGamePass`, `$720C`) with the controls on the keys of
 * CURSOR, as the original reads them there (`$FEE7` = 2). The ball on the
 * arrow is outcome 'start' — ? nothing is started yet (the next step of
 * the menu), the ball rolls on. The menu is silent: no interrupts.
 */
function menuTick() {
  steerToTarget();
  try {
    state.outcome = state.logic.afterGamePass((port) => BobbyLogic.keyboardPort(port, state.controls, BobbyLogic.CURSOR_KEYS));
  } catch (error) {
    state.stopped = error.message;
    state.running = false;
    stopClock();
    post({id: 'stopped', pass: state.pass, message: error.message});
    return;
  }
  state.pass++;
  state.screen = toBase64(state.logic.screen());
  post(frame(true));
} // menuTick

/**
 * The remake's menu: the ball rolled to the point of a click or a touch by
 * the four directions, as a player would hold them — the original's code
 * does not know. ★ The directions go along the isometric axes (`$8427`:
 * right/left the velocity `$FDFB` of `h` = `$FDF4`, down/up `$FDFA` of
 * `l` = `$FDF3`) and the screen has the column `$79 + h − l` and the line
 * `(h + l)/2 − height + $3F` (`$83A5`).
 *
 * The column comes first, then the line (operator 2026-10-31):
 *
 * - the column: right + up roll the ball →, left + down ← (when one axis is
 *   against a wall the other one still moves it), until the place the ball
 *   would stop at with the keys let go (stopDistance) is within
 *   STEER_TOLERANCE of the point, or until the ball has not moved for
 *   STEER_STILL passes; a column lost on the way (a wall stopped the drift)
 *   goes back to it, at most STEER_RETURNS times;
 * - the line: the column and the line give the place of each axis to stop
 *   at, and each axis is held towards its own (its momentum from the column
 *   counted), so the column stays. An axis held whose velocity does not
 *   pick up for STEER_STUCK passes is against a wall (the strip of the
 *   menu room goes diagonally): it is let go, and the other one goes where
 *   it keeps the column — the line gives way.
 */
function steerToTarget() {
  var t = state.target;
  state.steered = false;
  if (!t) {
    return;
  }
  var mem = state.logic.mem;
  var h = mem[0xFDF4], l = mem[0xFDF3];
  // where each axis stops with the keys let go
  var stopH = h+stopDistance(signed(mem[0xFDFB]));
  var stopL = l+stopDistance(signed(mem[0xFDFA]));
  var dx = t.x-(mem[0xFDE9]+STEER_BALL_CENTRE);
  var dy = t.y-(mem[0xFDE8]+STEER_BALL_CENTRE);
  var keys = {left: false, right: false, up: false, down: false};
  t.passes++;
  if (t.phase === 'column') {
    var errorColumn = dx-(stopH-h)+(stopL-l);
    t.still = h === t.h && l === t.l ? t.still+1 : 0;
    if (Math.abs(errorColumn) <= STEER_TOLERANCE || t.still >= STEER_STILL) {
      // the places of the axes to stop at: the column of the point, the
      // line of the point (the height as it is now)
      var sum = h+l+2*dy;
      var diff = h-l+dx;
      t.phase = 'line';
      t.diff = diff;
      t.toH = (sum+diff)/2;
      t.toL = (sum-diff)/2;
      t.stillH = t.stillL = 0;
      t.heldH = t.heldL = false;
      t.blockedH = t.blockedL = false;
    } else {
      keys.right = keys.up = errorColumn > 0;
      keys.left = keys.down = errorColumn < 0;
    }
  }
  if (t.phase === 'line' && t.returns < STEER_RETURNS
      && Math.abs(dx-(stopH-h)+(stopL-l)) > 2*STEER_TOLERANCE) {
    // the column the ball was to stop at did not come (a wall stopped the
    // drift): the column again
    t.phase = 'column';
    t.returns++;
    t.still = 0;
    keys.right = keys.up = dx-(stopH-h)+(stopL-l) > 0;
    keys.left = keys.down = !keys.right;
  }
  if (t.phase === 'line') {
    t.stillH = t.heldH && Math.abs(signed(mem[0xFDFB])) < STEER_PICK_UP ? t.stillH+1 : 0;
    t.stillL = t.heldL && Math.abs(signed(mem[0xFDFA])) < STEER_PICK_UP ? t.stillL+1 : 0;
    if (t.stillH >= STEER_STUCK && !t.blockedH) {
      t.blockedH = true;
      t.toL = stopH-t.diff;
    }
    if (t.stillL >= STEER_STUCK && !t.blockedL) {
      t.blockedL = true;
      t.toH = stopL+t.diff;
    }
    var errorH = t.blockedH ? 0 : t.toH-stopH;
    var errorL = t.blockedL ? 0 : t.toL-stopL;
    if ((Math.abs(errorH) <= STEER_TOLERANCE && Math.abs(errorL) <= STEER_TOLERANCE)
        || (t.blockedH && t.blockedL)) {
      t.phase = 'done';
    } else {
      keys.right = errorH > STEER_TOLERANCE;
      keys.left = errorH < -STEER_TOLERANCE;
      keys.down = errorL > STEER_TOLERANCE;
      keys.up = errorL < -STEER_TOLERANCE;
      t.heldH = keys.right || keys.left;
      t.heldL = keys.down || keys.up;
    }
  }
  t.h = h;
  t.l = l;
  if (t.passes > STEER_MAX_PASSES) {
    t.phase = 'done';
  }
  if (t.phase === 'done') {
    state.target = null;
    keys = {left: false, right: false, up: false, down: false};
  }
  Object.assign(state.controls, keys);
  state.steered = state.target !== null;
} // steerToTarget

/** A velocity of the original as a signed number. */
function signed(v) {
  return v >= 0x80 ? v-0x100 : v;
} // signed

/**
 * ★ How far an axis goes before it stops with no key held: `$8437` takes
 * the velocity one towards 0 a pass, `$84DF` moves the position by a
 * quarter of it, rounded towards zero (the slopes of the menu room are 0).
 * @param {number} v - The signed velocity.
 * @returns {number} The signed distance.
 */
function stopDistance(v) {
  var sum = 0;
  while (v !== 0) {
    v += v > 0 ? -1 : 1;
    sum += v > 0 ? v >> 2 : -((-v) >> 2);
  }
  return sum;
} // stopDistance

/**
 * ★ The interrupts of one pass (M6): as many as frames of the machine went
 * by in PASS_MS (one or two at 35 ms), each the handler `$FB08` over the
 * game's memory (BeeperPlayer.interrupt) — the requests `$F061`/`$F062` the
 * pass wrote are taken up here, as the machine takes them at the next
 * interrupt (a request overwritten before that is lost, as there). A
 * handler longer than a frame loses the interrupts it runs over.
 *
 * What goes to the model is not the edges of the interrupt but **the
 * request, with the whole effect rendered** (operator 2026-10-30, as the
 * sounds of Manic Miner are prepared whole): `sounds` carries
 * `{id: 'effect', bus, value, outs, length}` for every request taken, the
 * bus by the part of the game that asked (BobbyLogic.soundRequest), and the model
 * starts it with one message — the sound then plays beside the game and
 * neither the worker nor the drawing loop has a hand in its timing.
 */
function interrupts() {
  if (!state.beeper) {
    return;
  }
  state.frameDebt += PASS_MS;
  while (state.frameDebt >= FRAME_MS) {
    state.frameDebt -= FRAME_MS;
    if (state.lostFrames > 0) {
      state.lostFrames--;
      continue;
    }
    var made = state.beeper.interrupt();
    state.lostFrames = Math.floor(made.length/BeeperPlayer.FRAME);
    made.taken.forEach((request) => {
      var effect = renderEffect(request.value);
      state.sounds.push({id: 'effect', bus: state.logic.soundSources[request.slot] || 'game',
                         value: request.value, outs: effect.outs, length: effect.length});
    });
  }
} // interrupts

/**
 * ★ One request played whole, as the machine would play it alone: a scratch
 * handler over a memory with the effect tables (`$FBF3`-`$FC93`) and the
 * request in `$F061`, interrupt after interrupt — each a frame of the
 * machine later, plus the frames a long handler loses — until the three
 * channels are silent. Rendered once per value and kept (`state.effects`).
 * @param {number} value - An effect 1-8 or a pitch from 9 up.
 * @returns {{outs: Array, length: number}} The edges [T from the start,
 *   bit 4] and the length in T, whole frames.
 */
function renderEffect(value) {
  if (state.effects[value]) {
    return state.effects[value];
  }
  var scratch = new Uint8Array(65536);
  for (var a = 0xFBF3; a < 0xFC94; a++) {
    scratch[a] = state.logic.mem[a];
  }
  scratch[0xF061] = value;
  var player = new BeeperPlayer(scratch);
  var outs = [];
  var at = 0;
  for (var frame = 0; frame < 1000; frame++) {
    var made = player.interrupt();
    made.outs.forEach((out) => outs.push([at+out[0], out[1]]));
    at += (1+Math.floor(made.length/BeeperPlayer.FRAME))*BeeperPlayer.FRAME;
    if (scratch[0xF063] === 0 && scratch[0xF06D] === 0 && scratch[0xF077] === 0) {
      break;
    }
  }
  state.effects[value] = {outs: outs, length: at};
  return state.effects[value];
} // renderEffect

/**
 * @param {Uint8Array} bytes
 * @returns {string} Base64, as ZXVideoRAM.restore takes it.
 */
function toBase64(bytes) {
  var binary = '';
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
} // toBase64

function schedule() {
  if (!state.running || state.paused || state.headless) {
    return;
  }
  // the clock starts when it is scheduled, not when it first fires: else
  // the first interval after init or continue would be lost
  if (lastTime === false) {
    lastTime = Date.now();
  }
  timer = setTimeout(() => {
    // the message handler may have stopped the clock in the meantime
    if (timer === null) {
      return;
    }
    var now = Date.now();
    accumulator += now-lastTime;
    lastTime = now;
    // catch up rather than drift, but never run away with it after a stall
    var steps = Math.min(Math.floor(accumulator/PASS_MS), MAX_CATCH_UP);
    accumulator -= steps*PASS_MS;
    if (accumulator > MAX_CATCH_UP*PASS_MS) {
      accumulator = 0;
    }
    for (var step = 0; step < steps && state.running; step++) {
      tick();
    }
    schedule();
  }, PASS_MS);
} // schedule

function stopClock() {
  clearTimeout(timer);
  timer = null;
  lastTime = false;
} // stopClock

onmessage = function(event) {
  var message = event.data;
  switch (message.id) {

    case 'init':
      reset();
      session = typeof message.session === 'number' ? message.session : null;
      var initData = message.initData || {};
      state.headless = !!initData.headless;
      state.hiScore = initData.hiScore || 0;
      if (!initData.world || !initData.world.regions || !initData.memory || !initData.memory.regions) {
        post({id: 'error', message: 'game data missing (data/world.json, data/memory.json)'});
        return;
      }
      // ★ the memory of the menu the moment `0` starts a game ($74F3); the
      // new game ($D969 → $7D87) builds room $00 with the panel on the screen
      // itself (M5)
      state.logic = new BobbyLogic(BobbyLogic.composeMemory(initData.world, initData.memory));
      if (initData.mode === 'menu') {
        // ★ the remake's menu: room $1E with six discs and the original's
        // screen after a game over it ($71BB), silent
        state.menu = true;
        Object.keys(BobbyLogic.MENU_PATCH).forEach((address) => {
          state.logic.mem[+address] = BobbyLogic.MENU_PATCH[address];
        });
        state.logic.afterGame();
        if (initData.resume && menuBall) {
          // the menu back after SHOW TAPE LOADING: the ball where it was
          BALL_REGIONS.forEach((region) => {
            state.logic.mem.set(menuBall[region[0]], region[0]);
          });
        }
        state.screen = toBase64(state.logic.screen());
        state.running = true;
        post(frame(true));
        schedule();
        break;
      }
      state.beeper = new BeeperPlayer(state.logic.mem);
      state.seed = typeof initData.seed === 'number' ? initData.seed : null;
      if (state.seed !== null) {
        // ★ into the generator of the brothers' order before the draw ($F260)
        state.logic.mem[0xEE7F] = state.seed & 0xFF;
        state.logic.mem[0xEE80] = (state.seed >> 8) & 0xFF;
      }
      state.logic.newGame();
      if (initData.startSound) {
        // ★ the game started from the screen after a game, the ball on the
        // arrow ($7481): the request of sound 6 before $74CC → $7D87. The
        // original's interrupt takes it while the room is being built, so
        // here the first interrupt comes right away and the effect goes
        // with the first frame
        state.logic.soundRequest(0xF061, 6, 'game');
        interrupts();
      }
      state.screen = toBase64(state.logic.screen());
      state.running = true;
      post(frame(true));
      schedule();
      break;

    case 'controls':
      // a direction of the player's own takes over from a target
      state.target = null;
      // CHEAT let go after a deduction of the time: it is taken again
      if (!state.countdown && !message.cheat) {
        state.cheatBlocked = false;
      }
      Object.keys(state.controls).forEach((key) => {
        if (key in message) {
          state.controls[key] = !!message[key];
        }
      });
      break;

    case 'target':
      // the menu: the ball rolls to the point (x, y in pixels of the screen,
      // steerToTarget); without them the target is dropped and the keys let go
      if (state.menu && typeof message.x === 'number' && typeof message.y === 'number') {
        state.target = {x: message.x, y: message.y, phase: 'column', passes: 0, h: -1, l: -1, still: 0, returns: 0};
      } else if (state.target) {
        state.target = null;
        Object.assign(state.controls, {left: false, right: false, up: false, down: false});
      }
      break;

    case 'endGame':
      // EXIT GAME in the remake's pause: ★ the original's end screen of the
      // time out ($7D06 with $749D, as $7494 calls it) over the game as it
      // stands, its sound, the clock stopped and the last frame with the
      // outcome 'quit' — the model ends the game on it as on the others
      if (state.logic && !state.menu && state.running) {
        state.countdown = null;
        state.logic.endScreen(0x749D, 0x70, 'quit');
        interrupts();
        state.screen = toBase64(state.logic.screen());
        state.running = false;
        stopClock();
        state.outcome = 'quit';
        post(frame(true));
      }
      break;

    case 'pause':
      state.paused = true;
      stopClock();
      break;

    case 'continue':
      if (state.paused) {
        state.paused = false;
        lastTime = false;
        accumulator = 0;
        schedule();
      }
      break;

    case 'renderEffect':
      // one effect rendered whole for the model (the menu's sample of
      // SOUNDS): the same edges a request of it gives in the game
      if (state.logic) {
        var effect = renderEffect(message.value);
        post({id: 'effect', value: message.value, outs: effect.outs, length: effect.length});
      }
      break;

    case 'tick':
      if (state.headless && state.running) {
        tick();
      }
      break;

    case 'reset':
      reset();
      break;

  } // switch
}; // onmessage

reset();
