// classic script (importScripts): no import, no export — R-001, R-048.
// Needs WorldRenderer (worldRenderer.js) loaded before it.
// begin code

/**
 * Bobby Bearing's game logic: one pass of the original's main loop (`$751E`)
 * and the routines it calls, carried over to JavaScript **over a memory laid
 * out as the original's** — 64 KB, the room's map at `$5EEC`, the scene
 * buffer at `$CDE7`, the ball's state at `$FDE8`-`$FE69`, the screen at
 * `$4000` (sources/docs/physics.md).
 *
 * Why memory and not objects: the ball's height comes from the profiles of
 * the blocks under it (`$86A7`, tables `$CA12`, `$CAA7`, `$CAE7`), the
 * screen is the buffer with the ball drawn into it and taken out again
 * (`$92D4`, `$7FE4`, `$91F6`, `$9362`), and the code modifies itself
 * (`$944F`, `$9454`, `$9459`, `$9461`, `$804B`). The only way to have the
 * same game is to have the same memory. tools/matchphysics.mjs runs this
 * code pass by pass against recordings of the original
 * (tools/tracephysics.py) and compares the whole RAM after every pass.
 *
 * It is a port, not an emulator: every routine is written out with what it
 * does, named by its address. ★ The only inputs of a pass are the reads of
 * the keyboard and the joystick (`$FC94`, `$73FE`, `$81EC`): `pass(input)`
 * takes them as the values the ports gave, in order. The interrupt (`$FB08`)
 * only plays the sounds; the main loop reads nothing it writes.
 *
 * A change of room through an exit (`$7856`) clears the buffer, draws the
 * panel into it (`$F487`, `$F739`, `$72E0`) and builds the next room over
 * it (WorldRenderer, `$7935`), loading its entities (`$9629`).
 *
 * The entities (M4): the mechanisms and devices of the room every pass
 * (`$8DF0`), the bad Bearings after the ball (`$7BCF`), their state kept
 * over a change of room (`$92A6`), the squashed ball (`$801F`) —
 * sources/docs/physics.md §11.
 *
 * A new game (`newGame`: `$D969` → `$7D87`, M5) starts from the menu's
 * memory; the time out (`$7494`), all brothers home (`$7CE5`) and the end
 * from the pause (`$71BB`) end the pass with an outcome other than 'pass'.
 *
 * ? Not ported yet: devices of types 3 and 7 (no room has one). They throw
 * `unported`, never guess.
 *
 * A classic script (no import/export): the worker loads it with
 * importScripts(), the tools with svision/tools/classicScript.cjs.
 */
class BobbyLogic extends WorldRenderer {

  /**
   * @param {Uint8Array} memory - 65536 bytes: the machine.
   */
  constructor(memory) {
    super({regions: {}});
    if (!(memory instanceof Uint8Array) || memory.length !== 65536) {
      throw new Error('BobbyLogic needs 64 KB of memory');
    }
    this.mem = memory;
    this.input = [];
    this.outcome = 'pass';
    this.regC = 0;                      // ★ the C register as $8F6E finds it (timeDigitC)
    // the remake's counter of the ticks of the time (M7, gameWorker.js
    // score()): one up for every tick of $7404 that takes one off the
    // clock; the 1000 a brother home gives back ($7E8F) does not touch it.
    // Not in the original's memory.
    this.timeTicks = 0;
    // M7: which part of the game asked for the sound in each request slot
    // ($F061, $F062), for the bus the remake plays it on (soundRequest())
    this.soundSources = {};
  } // constructor

  /**
   * ★ A sound request into a slot (`$F061`, `$F062`) for the interrupt
   * handler (physics.md §13) — the write of the original, and beside it
   * (not in the memory) which part of the game asked: the remake plays every
   * kind of sound on a bus of its own (operator 2026-10-30), so a room change
   * does not cut off a rolling block.
   * @param {number} slot - `$F061` or `$F062`.
   * @param {number} value - An effect 1-8 or a pitch from 9 up.
   * @param {string} source - 'game' (a room change, Q CHEAT, the end — never two at once), 'ball', 'brothers', 'blocks' or 'bearings'.
   */
  soundRequest(slot, value, source) {
    this.wr(slot, value);
    this.soundSources[slot] = source;
  } // soundRequest

  // --- helpers ---------------------------------------------------------------

  rw(a) { return this.rd(a) | (this.rd(a+1) << 8); }
  ww(a, v) { this.wr(a, v & 0xFF); this.wr(a+1, (v >> 8) & 0xFF); }

  unported(address, what) {
    throw new Error('unported $'+address.toString(16).toUpperCase()+': '+what);
  } // unported

  /**
   * ★ An IN: the value the port gave the original, from the pass's input.
   * @param {number} port - The port, for the check.
   * @returns {number}
   */
  inPort(port) {
    if (typeof this.input === 'function') {
      return this.input(port) & 0xFF;      // the worker: the ports from the controls
    }
    if (!this.input.length) {
      throw new Error('input exhausted at IN $'+port.toString(16));
    }
    var next = this.input.shift();
    if (next[0] !== port) {
      throw new Error('IN $'+port.toString(16)+', the original read $'+next[0].toString(16));
    }
    return next[1];
  } // inPort

  // --- the pass ---------------------------------------------------------------

  /**
   * One pass of the main loop, `$751E` to `JP $751E` (`$7635`).
   * @param {Array|Function} input - [port, value] of every IN, in order (a
   *   recording), or a function giving the value of a port (the worker).
   * @returns {string} 'pass'.
   */
  pass(input) {
    this.input = typeof input === 'function' ? input : input.slice();
    this.outcome = 'pass';
    this.clearLists();                      // $750A
    this.regC = this.timeDigitC();
    this.entities();                        // $8DEA
    this.wr(0xFE2F, 0);
    this.wr(0xFE36, 0);
    this.loadBall(0xFE42);                  // $752E CALL $7650
    var a = this.rd(0xFE50);
    if (a !== 0) {                          // $7531
      var fast = true;                      // → $7572: $20
      if (a >= 3 && a < 0x0A) {
        this.timePenalty(a);                // $7543 CALL $7F73
        var t = this.rd(0xFE51);
        if (t < 8) {
          if (t !== 0 && (t & 1)) {
            fast = false;
          }
        } else if (t === 0x0C || t === 0x14 || t === 0x1E || t === 0x10) {
          fast = false;
        }
      }
      this.wr(0xFE2F, fast ? 0x20 : 0);     // $7574
      a = 3;
    }
    this.wr(0xFDEA, a);                     // $7579
    this.wr(0xFEB2, this.rd(0xFEB3));
    this.physics();                         // $7582 CALL $8214
    for (var i = 0; i < 4; i++) {           // ($FFDC) = ($FE42), ($FFDE) = ($FE44)
      this.wr(0xFFDC+i, this.rd(0xFE42+i));
    }
    this.storeBall(0xFE42);                 // $7598 CALL $7693
    this.fall();                            // $759B CALL $7E19
    // $759E CALL $782B; a change of room pops the return and goes on at $760D
    if (!this.exitCheck()) {
      if (this.rd(0xFE35) === 0 && this.rd(0xFE4F) === 0) {   // $75A1 → $7CE5
        if (this.rd(0xFE48) === 3) {
          this.allHome();                   // the end of the game
          return this.outcome;
        }
        // ★ not on the home cell yet: straight on to $760D, the brother's
        // pass skipped
      } else if (this.rd(0xFE63) === this.rd(0xFE4F)) {
        this.brotherPass();                 // $75B6
      }
    }
    this.enemies();                         // $760D CALL $7BCF
    this.foreground();                      // $7610 CALL $8DCC
    this.cheat();                           // $7613 CALL $81EA
    if (this.rd(0x7CD5) !== 0) {
      this.newRoomOnScreen();               // $761A CALL $7CCB
    }
    // $761D: the delay $7648 copies 1800 bytes onto themselves — no state
    this.redraw();                          // $762C CALL $7F81
    this.homecoming();                      // $762F CALL $F23F
    this.passEnd();                         // $7632 CALL $71AC
    if (this.outcome !== 'pass') {
      return this.outcome;                  // the game ended: no JP $751E
    }
    if (typeof this.input !== 'function' && this.input.length) {
      throw new Error(this.input.length+' IN left over');
    }
    return this.outcome;
  } // pass

  /** ★ `$750A`: the lists of objects `$C9A4` and `$FF78` empty. */
  clearLists() {
    this.wr(0xC9A4, 0);
    this.ww(0xC990, 0xC9A5);
    this.wr(0xFF78, 0);
    this.ww(0xFF76, 0xFF79);
  } // clearLists

  /**
   * ★ `$8DF0`: the entities of the room, every pass before the ball —
   * the flashing of the panel after a brother home (`$9992`), the
   * mechanisms of the first list (`$8F6E`: lifts and crushers) and the
   * devices of the second (`$94BD`: blocks that come and go, magnets,
   * vents, the chasing ball). sources/docs/physics.md §11.
   */
  entities() {
    this.flashing();                        // $9992
    this.mechanisms();                      // $8F6E
    this.devices();                         // $94BD
  } // entities

  /**
   * ★ The C register as `$8F6E` finds it: the last thing before a pass is
   * the time drawn (`$743E`), whose `$745B` leaves C from the glyph of the
   * top digit (`$FE66`): 8 × INC with a wrap to 1 at `$51`; after the panel
   * flashed (`$9992`) it is `$20` (`$99F8`). Stored at `$996F` by `$8F9B` /
   * `$90C6`.
   * @returns {number}
   */
  timeDigitC() {
    var c = this.rd(0xFE66);
    for (var i = 0; i < 8; i++) {
      c = (c+1) & 0xFF;
      if (c >= 0x51) {
        c = 1;
      }
    }
    return c;
  } // timeDigitC

  /**
   * ★ `$9992`: while `$6125` counts (a brother home, `$F365`: `$78`), both
   * balls are unstunned every pass and every fourth tick of the time the
   * time's capsule on the panel (`$5A60`, `$5A81`, `$5A86`, `$5AA0`,
   * `$5AC0`, `$5AE0`) takes the next of three colours (`$998C` while over
   * `$1E`, `$998F` under), the room's attribute at the end.
   */
  flashing() {
    var a = this.rd(0x6125);
    if (a === 0) {
      return;
    }
    this.wr(0xFE51, 0);
    this.wr(0xFE50, 0);
    this.wr(0xFE65, 0);
    this.wr(0xFE64, 0);
    if ((this.rd(0xFE69) & 3) !== 2) {
      return;
    }
    a = (a-1) & 0xFF;
    this.wr(0x6125, a);
    var colour;
    if (a === 0) {                          // $99EB
      colour = this.rd(0x5801);
    } else {
      var table = a >= 0x1E ? 0x998C : 0x998F;
      var i = (this.rd(0x998B)+1) & 0xFF;
      if (i >= 3) {
        i = 0;
      }
      this.wr(0x998B, i);
      colour = this.rd(table+i);
    }
    this.wr(0x5A81, colour);                // $99CC
    this.wr(0x5A86, colour);
    for (var k = 0; k < 7; k++) {           // $99F3: (HL) = A, LDIR 6
      this.wr(0x5A60+k, colour);
    }
    [0x5AA0, 0x5AC0, 0x5AE0].forEach((row) => {   // $99F0: (HL) = A, LDIR 7
      for (var j = 0; j < 8; j++) {
        this.wr(row+j, colour);
      }
    });
    this.regC = 0x20;                       // ★ BC = $0020 from $99F8 at the end
  } // flashing

  // --- the mechanisms of the first list ($C865) --------------------------------

  /**
   * ★ `$8F6E`: the `$C864` mechanisms of the room, 13 or 17 bytes each
   * (`$96C6`): type 0 a lift that rides between two heights (`$8F8A`),
   * type 1 a lift set off by a ball on a cell (`$90AF`); either puts its
   * block into the list of objects and may crush a ball under it
   * (`$907B`). `$FE91` (5 after the room is built, 0 after) sends standing
   * blocks to the list drawn every pass instead of `$FF78`.
   */
  mechanisms() {
    var n = this.rd(0xC864);
    if (n === 0) {
      return;
    }
    var hl = 0xC865;
    for (var i = 0; i < n; i++) {           // $8F76
      var type = this.rd(hl) & 7;
      if (type === 0) {
        hl = this.lift(hl);
      } else if (type === 1) {
        hl = this.switchLift(hl);
      }
      // ★ any other type: HL stays, the byte is read again ($8F82)
    }
    this.wr(0xFE91, 0);
  } // mechanisms

  /**
   * ★ `$8F8A`: a lift. Byte 1 its cell, 2 its speed (signed); going up it
   * speeds up by byte 4 to the limit 5 until the height reaches byte 3,
   * then slows by byte 7 until it turns; going down it speeds up by 7 to
   * the limit 8 until the height is under byte 6, then slows by 4. The
   * cell's height moves by half the speed.
   * @param {number} r - The record.
   * @returns {number} The next record.
   */
  lift(r) {
    var cellByte = this.rd(r+1);
    this.wr(0x91F5, cellByte & 0x3F);
    var map = (0x5EEC+2*cellByte) & 0xFFFF;
    var b = this.rd(map);
    this.wr(0x996F, this.regC);             // $8F9B LD ($996F),BC
    this.wr(0x9970, b);
    this.ww(0xFDF1, map);
    var c = this.rd(r+2);
    var a;
    if (c < 0x78) {                         // $8FC2: going up
      if (b >= this.rd(r+3)) {
        a = (c+this.rd(r+7)) & 0xFF;        // $8FDA: over the turning height, slower
      } else {
        a = (c+this.rd(r+4)) & 0xFF;        // faster, to the limit
        if (a >= this.rd(r+5)) {
          a = this.rd(r+5);
        }
      }
    } else {                                // $8FAC: going down
      if (b < this.rd(r+6)) {
        a = (c+this.rd(r+4)) & 0xFF;        // $8FD5, $8FDE: under the turning height, slower
      } else {
        a = (c+this.rd(r+7)) & 0xFF;        // faster, to the limit
        if (a < this.rd(r+8)) {
          a = this.rd(r+8);
        }
      }
    }
    c = a;                                  // $8FE0
    b = (this.sra(a)+b) & 0xFF;
    this.wr(map, b);
    this.wr(r+2, c);
    return this.mechanismObject(r+9, b);    // $8FEF
  } // lift

  /**
   * ★ `$90AF`: a lift set off. Byte 0 has the triggers in bits 3-7
   * (`$917A`), 1 the cell, 2 / 3 flag it going up / down, 4 / 5 the cells
   * that set it going up / down, 6 its speed, 7-9 the speed's change,
   * limit and the top height, 10-12 the same for the way down. The height
   * moves by an eighth of the speed; `$916B` remembers a ride in progress
   * (`$C8`) so the block arriving is drawn once more.
   * @param {number} r - The record.
   * @returns {number} The next record.
   */
  switchLift(r) {
    this.wr(0x996E, this.rd(r) & 0xF8);
    var cellByte = this.rd(r+1);
    this.wr(0x91F5, cellByte & 0x3F);
    var map = (0x5EEC+2*cellByte) & 0xFFFF;
    var b = this.rd(map);
    this.wr(0x996F, this.regC);             // $90C6 LD ($996F),BC
    this.wr(0x9970, b);
    this.ww(0xFDF1, map);
    var up;                                 // $90F4 true, $9120 false, none undefined
    if (this.rd(r+2) !== 0) {
      up = true;
    } else if (this.rd(r+3) !== 0) {
      up = false;
    } else if (this.triggered(r+4)) {
      up = true;
    } else if (this.triggered(r+5)) {
      up = false;
    }
    if (up === undefined) {                 // $90E4
      if (this.rd(0xFE91) !== 0) {
        return this.mechanismObject(r+13, b);
      }
      return this.standingMechanism(r+13, b);
    }
    var a, c, arrived;
    if (up) {                               // $90F4
      this.wr(r+2, 1);
      this.ww(0xFDF3, r+2);
      c = this.rd(r+6);
      a = (c+this.rd(r+7)) & 0xFF;
      if (a >= this.rd(r+8)) {
        a = this.rd(r+8);
      }
      c = a;
      a = (this.sra3(a)+b) & 0xFF;
      arrived = a >= this.rd(r+9);
      if (arrived) {
        a = this.rd(r+9);
        this.wr(r+2, 0);
        c = 0;
      }
    } else {                                // $9120
      this.wr(r+3, 1);
      this.ww(0xFDF3, r+3);
      c = this.rd(r+6);
      a = (c+this.rd(r+10)) & 0xFF;
      if (a < this.rd(r+11)) {
        a = this.rd(r+11);
      }
      c = a;
      a = (this.sra3(a)+b) & 0xFF;
      arrived = a < this.rd(r+12);
      if (arrived) {
        a = this.rd(r+12);
        this.wr(r+3, 0);
        c = 0;
      }
    }
    this.wr(map, a);                        // $916C
    b = a;
    this.wr(r+6, c);
    if (!arrived) {                         // $9160
      this.wr(0x916B, 0xC8);
      return this.mechanismObject(r+13, b);
    }
    if (this.rd(0x916B) !== 0) {            // $914C
      this.wr(0x916B, 0);
      return this.mechanismObject(r+13, b);
    }
    if (this.rd(0xFE91) !== 0) {
      this.wr(0x916B, this.rd(0xFE91));     // $9157: A = ($FE91)
      return this.mechanismObject(r+13, b);
    }
    return this.standingMechanism(r+13, b);
  } // switchLift

  /** Three `SRA`: a signed byte divided by eight. */
  sra3(a) { return this.sra(this.sra(this.sra(a))); }

  /**
   * ★ `$917A`: whether a ball is on cell `(hl)`, by the triggers in
   * `$996E`: bit 3 Bobby (`$FE48`), 4 the brother (`$FE5C`, when in the
   * room), 5 `$9971`, 6 the second bad Bearing (`$FEA2`), 7 the first
   * (`$FE84`).
   * @returns {boolean}
   */
  triggered(hl) {
    var c = this.rd(0x996E);
    var cell = this.rd(hl);
    if ((c & 0x08) && this.rd(0xFE48) === cell) {
      return true;
    }
    if ((c & 0x10) && this.rd(0x91F4) === 0 && this.rd(0xFE5C) === cell) {
      return true;
    }
    if ((c & 0x20) && this.rd(0x9971) === cell) {
      return true;
    }
    if ((c & 0x40) && this.rd(0xFE99) !== 0 && this.rd(0xFEA2) === cell) {
      return true;
    }
    if ((c & 0x80) && this.rd(0xFE7B) !== 0 && this.rd(0xFE84) === cell) {
      return true;
    }
    return false;
  } // triggered

  /**
   * ★ `$8FEF`: the mechanism's block into the list of objects (type 1) at
   * depth + height, line − height; a sound when its height changed on an
   * odd tick; then the crush check (`$902B`).
   * @param {number} hl - The record's depth, block, line, column.
   * @param {number} b - The height.
   * @returns {number} The next record.
   */
  mechanismObject(hl, b) {
    var c = this.rd(hl);
    var block = this.rd(hl+1);
    var e = (this.rd(hl+2)-b) & 0xFF;
    if (this.rd(0x9970) !== b && (this.rd(0xFE69) & 1)) {
      this.soundRequest(0xF061, (0xFA-b) & 0xFF, 'blocks');
    }
    var d = this.rd(hl+3);
    var list = this.rw(0xC990);
    c = (c+b) & 0xFF;
    this.wr(list, c);
    this.wr(list+1, block);
    this.wr(list+2, e);
    this.wr(list+3, d);
    this.wr(list+4, 1);
    this.ww(0xC990, list+5);
    this.wr(0xC9A4, this.rd(0xC9A4)+1);     // $902B
    this.crushCheck((c-2) & 0xFF, b);
    return hl+4;                            // $9077
  } // mechanismObject

  /**
   * ★ `$91CA`: the same block into the list of standing objects (`$FF78`,
   * type 6), then the crush check.
   */
  standingMechanism(hl, b) {
    var c = this.rd(hl);
    var block = this.rd(hl+1);
    var e = (this.rd(hl+2)-b) & 0xFF;
    var d = this.rd(hl+3);
    var list = this.rw(0xFF76);
    c = (c+b) & 0xFF;
    this.wr(list, c);
    this.wr(list+1, block);
    this.wr(list+2, e);
    this.wr(list+3, d);
    this.wr(list+4, 6);
    this.ww(0xFF76, list+5);
    this.wr(0xFF78, this.rd(0xFF78)+1);     // $902B
    this.crushCheck((c-2) & 0xFF, b);
    return hl+4;
  } // standingMechanism

  /**
   * ★ `$902C`: a ball on the mechanism's cell (`$91F5`) gets `$FE4E` /
   * `$FE62` = 5, its drawing depth (`$FEB3` / `$FEB4`, the operand of
   * `$908F`) and the crush check (`$907B`).
   * @param {number} c - The depth − 2.
   * @param {number} b - The height.
   */
  crushCheck(c, b) {
    var cell = this.rd(0x91F5);
    if ((this.rd(0xFE48) & 0x3F) === cell) {
      this.wr(0xFE4E, 5);
      this.wr(0xFEB3, 5);
      this.ww(0x9090, 0xFEB3);
      this.crush(0xFE50, this.rd(0xFE49), b, c);
    }
    if (this.rd(0x91F4) === 0 && (this.rd(0xFE5C) & 0x3F) === cell) {
      this.wr(0xFE62, 5);
      this.wr(0xFEB4, 5);
      this.ww(0x9090, 0xFEB4);
      this.crush(0xFE64, this.rd(0xFE5D), b, c);
    }
  } // crushCheck

  /**
   * ★ `$907B`: a ball under 16 below the mechanism's height is squashed:
   * its state `$FE50` / `$FE64` goes to `$11` − d (d = the gap / 2, so
   * `$0A`-`$11`, the big ball) unless it is there already, its counter to
   * `$50` when 0, the depth to draw it at `c` − 2d, a sound by d.
   * @param {number} hl - `$FE50` or `$FE64`.
   * @param {number} a - The ball's height.
   */
  crush(hl, a, b, c) {
    a = (b-a) & 0xFF;
    if ((a & 0x80) || a >= 0x10) {
      return;
    }
    var d = this.sra(a);
    a = (16-d) & 0xFF;
    this.wr(this.rw(0x9090), (c-2*d) & 0xFF);
    if (a < this.rd(hl)) {
      return;
    }
    this.wr(hl, (a+1) & 0xFF);
    var tone = ((16*d)+0x63) & 0xFF;        // $9098: SLA × 3 of 2d, + $63
    this.soundRequest(0xF061, tone, 'blocks');
    this.soundRequest(0xF062, (tone+0x28) & 0xFF, 'blocks');
    if (this.rd(hl+1) !== 0) {
      return;
    }
    this.wr(hl+1, 0x50);
  } // crush

  // --- the devices of the second list ($6127) ----------------------------------

  /**
   * ★ `$94BD`: the `$6126` devices of the room, each by the type in bits
   * 0-2 of its first byte (kept in `$996E` for the triggers): 0 a block
   * timed (`$94A0`), 1 a vent on a timer (`$F638`), 2 a block switched by
   * cells (`$9503`), 4 a magnet on the brother (`$95E2`), 5 the ball that
   * chases Bobby (`$F535`), 6 a vent (`$F5D3`). ? Types 3 and 7 are in no
   * room (tools/matchworld.mjs).
   */
  devices() {
    var n = this.rd(0x6126);
    if (n === 0) {
      return;
    }
    var hl = 0x6127;
    for (var i = 0; i < n; i++) {           // $94C5
      var a = this.rd(hl);
      hl++;
      this.wr(0x996E, a);
      switch (a & 7) {
        case 0:
          hl = this.timedBlock(hl);
          break;
        case 1:
          hl = this.vent(hl, 1);
          break;
        case 2:
          hl = this.switchedBlock(hl);
          break;
        case 4:
          hl = this.magnet(hl);
          break;
        case 5:
          this.chaser();
          hl++;
          break;
        case 6:
          hl = this.vent(hl, 0);
          break;
        default:
          this.unported(a & 7 === 7 ? 0x948F : 0x94E7, 'a device of type '+(a & 7));
      }
    }
  } // devices

  /**
   * ★ `$94A0`: a block timed — bytes 1-2 its cell of the map, 3 added to
   * 4 every pass, 5 its height, 6-9 depth, block, line, column. While the
   * sum is negative the block is away (it vanishes when the cell has a
   * height, `$9538`); while positive it is there (it appears when the cell
   * is 0, `$954C`, else it stands, `$951F`).
   * @param {number} hl - The record's second byte.
   * @returns {number} The next record.
   */
  timedBlock(hl) {
    var map = this.rw(hl);
    this.ww(0x94BB, map);
    var sum = (this.rd(hl+2)+this.rd(hl+3)) & 0xFF;
    this.wr(hl+3, sum);
    var a = this.rd(map);
    if (sum & 0x80) {                       // ★ $94AD JP M: the flags of the ADD, not of LD A,(DE)
      if (a === 0) {
        return hl+9;                        // $951A
      }
      return this.blockVanishes(hl+3, map);
    }
    if (a !== 0) {
      return this.standingBlock(hl+3);
    }
    return this.blockAppears(hl+3, map);
  } // timedBlock

  /**
   * ★ `$9503`: a block switched — bytes 1-2 its cell, 3 the cell that
   * makes it vanish, 4 the cell that makes it appear, 5 height, 6-9
   * depth, block, line, column.
   */
  switchedBlock(hl) {
    var map = this.rw(hl);
    this.ww(0x94BB, map);
    hl += 2;
    var off = this.triggered(hl);
    hl++;
    var a = this.rd(map);
    if (off) {                              // $9538
      if (a === 0) {
        return hl+6;                        // $951A
      }
      return this.blockVanishes(hl, map);
    }
    if (a !== 0) {
      return this.standingBlock(hl);
    }
    if (this.triggered(hl)) {
      return this.blockAppears(hl, map);
    }
    return hl+6;
  } // switchedBlock

  /** ★ `$9538`: the cell's height 0, the block's place redrawn (type 5). */
  blockVanishes(hl, map) {
    this.wr(map, 0);
    this.wr(0x956A, 5);
    this.blockIntoList(hl+1);
    this.wr(0x956A, 1);
    return hl+6;
  } // blockVanishes

  /** ★ `$954C`: the cell's height from the record, the block drawn (type 1). */
  blockAppears(hl, map) {
    this.wr(map, this.rd(hl+1));
    this.blockIntoList(hl+1);
    return hl+6;
  } // blockAppears

  /**
   * ★ `$954F`: the block into the list of objects with the type `($956A)`,
   * a block `$11` 16 deeper (`$95CF`), the sound 7, the block into the map.
   * @param {number} hl - The record's height.
   */
  blockIntoList(hl) {
    hl++;
    this.wr(0xC9A4, this.rd(0xC9A4)+1);
    var de = this.rw(0xC990);
    this.wr(de, this.rd(hl));
    var block = this.rd(hl+1);
    if (block === 0x11) {
      this.wr(de, (this.rd(de)+0x10) & 0xFF);
    }
    this.wr(de+1, block);
    this.wr(de+2, this.rd(hl+2));
    this.wr(de+3, this.rd(hl+3));
    this.wr(de+4, this.rd(0x956A));
    this.ww(0xC990, de+5);
    this.soundRequest(0xF061, 7, 'blocks');
    this.wr(this.rw(0x94BB)+1, block);
  } // blockIntoList

  /** ★ `$951F`: the block into the list of standing objects (type 6). */
  standingBlock(hl) {
    hl += 2;
    this.wr(0xFF78, this.rd(0xFF78)+1);
    var de = this.rw(0xFF76);
    for (var i = 0; i < 4; i++) {
      this.wr(de+i, this.rd(hl+i));
    }
    this.wr(de+4, 6);
    this.ww(0xFF76, de+5);
    return hl+4;
  } // standingBlock

  /**
   * ★ `$95E2`: a magnet on the brother — set off by a ball on cell 1, it
   * pulls his velocities (`$FE59` x, `$FE57` y) towards the place in bytes
   * 2 and 3 by 2 a pass, within −15..15 (`$9612`). Nothing without the
   * brother in the room.
   */
  magnet(hl) {
    if (this.rd(0x91F4) !== 0) {
      return hl+3;
    }
    var on = this.triggered(hl);
    hl++;
    if (!on) {
      return hl+2;
    }
    return this.magnetPull(hl);             // $95F1
  } // magnet

  /** ★ `$95F1`: the pull of both of the brother's velocities. */
  magnetPull(hl) {
    this.wr(0xFE59, this.pull(hl, this.rd(0xFE5A), this.rd(0xFE59)));
    hl++;
    this.wr(0xFE57, this.pull(hl, this.rd(0xFE5B), this.rd(0xFE57)));
    return hl+1;
  } // magnetPull

  /** ★ `$9612`: velocity `e` towards `(hl)` from `a`, by 2, clipped. */
  pull(hl, a, e) {
    var target = this.rd(hl);
    if (a === target) {
      return e;
    }
    if (a > target) {                       // $9620
      a = (e-2) & 0xFF;
      if (!(a & 0x80) || a >= 0xF1) {
        return a;
      }
      return 0xF1;
    }
    a = (e+2) & 0xFF;
    if ((a & 0x80) || a < 0x10) {
      return a;
    }
    return 0x0F;
  } // pull

  /**
   * ★ `$F535`: the ball that chases Bobby — the record `$F082` (its place
   * `$F086`, `$F087`, height `$F089`, from the room's device), steered by
   * the sign of the distance to Bobby on each axis as a direction byte,
   * its speed limit `$F081`; it rolls as a bad Bearing does (`$7A69` →
   * `$7AC3`) with `$FDEA` = 0 in the collision (`$7B57`).
   */
  chaser() {
    var l = this.rd(0xFE46), h = this.rd(0xFE47);
    var e = this.rd(0xF086), d = this.rd(0xF087);
    var b = 0;
    var a = (l-e) & 0xFF;
    if (a !== 0) {
      b = (a & 0x80) ? 2 : 4;
    }
    var dy = (h-d) & 0xFF;
    a = b;
    if (dy !== 0) {
      a = (dy & 0x80) ? (a+8) & 0xFF : (a+1) & 0xFF;
    }
    a = (~a) & 0xFF;
    this.wr(0xFE73, this.rd(0xF081));
    this.ww(0xFE3E, 0xF082);                // $7A69
    this.wr(0x7B57, 0);
    this.enemyStep(a);                      // $7AC3
    this.wr(0x7B57, 1);
  } // chaser

  /**
   * ★ `$F5D3` (type 6) and `$F638` (type 1): a vent — byte 1 its level,
   * 2-3 its place, 4-7 the cells that raise the level (to byte 5) and let
   * it down (to byte 7). A ball within 15 of it on both axes and under the
   * level is lifted (`$F64E`); with the level below the ball it is blown
   * away from the vent. Type 1 has no cells: byte 4 is added to byte 6
   * every pass, and the level goes up while the sum stays positive.
   * @param {number} hl - The record's second byte.
   * @param {number} flag - `$F5D1`: 1 for type 1, 0 for type 6.
   * @returns {number} The next record.
   */
  vent(hl, flag) {
    this.wr(0xF5D1, flag);
    var r1 = hl;
    this.wr(0xF5D2, this.rd(hl));
    hl++;
    this.ventBall(0xFE42, hl);
    if (this.rd(0xFE36) !== 0) {
      this.ventBall(0xFE56, hl);
    }
    if (this.rd(0xFE7B) !== 0) {
      this.ventBall(0xFE7E, hl);
    }
    hl += 2;                                // $F600
    if (flag !== 0) {                       // $F63D
      var sum = (this.rd(hl)+this.rd(hl+2)) & 0xFF;
      this.wr(hl+2, sum);
      this.ventLevel((sum & 0x80) ? hl+2 : hl, hl);
    } else {
      this.ventLevel(0xFE48, hl);
      if (this.rd(0xFE36) !== 0) {
        this.ventLevel(0xFE5C, hl);
      }
      if (this.rd(0xFE7B) !== 0) {
        this.ventLevel(0xFE84, hl);
      }
    }
    this.wr(r1, this.rd(0xF5D2));           // $F631
    return hl+4;
  } // vent

  /**
   * ★ `$F714`: the level `$F5D2` by the cell `(de)` of a ball: on the cell
   * `(hl)` up by one to `(hl+1)`, on `(hl+2)` down by one to `(hl+3)`.
   */
  ventLevel(de, hl) {
    var cell = this.rd(de);
    var a = this.rd(0xF5D2);
    if (cell === this.rd(hl)) {
      a = (a+1) & 0xFF;
      if (a >= this.rd(hl+1)) {
        a = this.rd(hl+1);
      }
    }
    this.wr(0xF5D2, a);
    if (cell !== this.rd(hl+2)) {
      return;
    }
    a = (a-1) & 0xFF;
    this.wr(0xF5D2, a);
    if (a >= this.rd(hl+3)) {
      return;
    }
    this.wr(0xF5D2, this.rd(hl+3));
  } // ventLevel

  /**
   * ★ `$F64E`: the vent on the ball `ix` (its record): within 15 on both
   * axes; under the level and within 8 it is lifted — its fall speed (+8)
   * down by 2 (−5 when still positive), to −4 at most; a ball not lifting
   * yet (+9 = 0) goes up 2 with +9 = 4 and the speed −2 — then blown
   * (`$F6B6`); within 15 but not 8 only pushed away (`$F701`).
   */
  ventBall(ix, hl) {
    var e = (this.rd(ix+4)-this.rd(hl)) & 0xFF;
    var a = (e & 0x80) ? (-e) & 0xFF : e;
    if (a >= 0x0F) {
      return;
    }
    var c = a;
    var d = (this.rd(ix+5)-this.rd(hl+1)) & 0xFF;
    a = (d & 0x80) ? (-d) & 0xFF : d;
    if (a >= 0x0F) {
      return;
    }
    var b = a;
    if (this.rd(0xF5D2) < this.rd(ix+7)) {
      this.ventBlow(ix, d, e);
      return;
    }
    if (b >= 8 || c >= 8) {
      this.ventPush(ix, d, e);              // $F701
      return;
    }
    a = (this.rd(ix+8)-2) & 0xFF;           // $F68B
    if (!(a & 0x80)) {
      a = (a-5) & 0xFF;                     // $F6B2
    } else if (a >= 0xFC) {
      a = 0xFC;
    }
    this.wr(ix+8, a);
    if (this.rd(ix+9) !== 0) {
      this.ventBlow(ix, d, e);
      return;
    }
    this.wr(ix+7, this.rd(ix+7)+2);
    this.wr(ix+12, 4);
    this.wr(ix+8, 0xFE);
    this.ventBlow(ix, d, e);
  } // ventBall

  /**
   * ★ `$F6B6`: a ball lifting (+9 ≠ 0) spins by its speed (+10, mod 8),
   * sounds by its height, and its velocities (+2 x, +0 y) go 2 away from
   * the vent — towards it when the distance is 0.
   */
  ventBlow(ix, d, e) {
    if (this.rd(ix+9) === 0) {
      return;
    }
    var b = this.rd(ix+10);
    var a = this.rd(ix+8);
    if (!(a & 0x80)) {
      a = (-a) & 0xFF;
    }
    a = (this.sra(a)+b+b) & 7;
    this.wr(ix+10, a);
    this.soundRequest(0xF061, (0x78-this.rd(ix+7)) & 0xFF, 'blocks');
    this.wr(ix+2, this.rd(ix+2)+((e & 0x80) ? 2 : -2));   // $F6E8
    this.wr(ix, this.rd(ix)+((d & 0x80) ? 2 : -2));       // $F6F3 / $F6E1
  } // ventBlow

  /** ★ `$F701`: a ball beside the vent pushed 2 towards it on both axes. */
  ventPush(ix, d, e) {
    this.wr(ix, this.rd(ix)+((d & 0x80) ? -2 : 2));       // $F70D
    this.wr(ix+2, this.rd(ix+2)+((e & 0x80) ? -2 : 2));   // $F6FA / $F6EC
  } // ventPush

  // --- the bad Bearings --------------------------------------------------------

  /**
   * ★ `$7BCF`: the up to three bad Bearings of the room, each a control
   * block of 10 bytes (`$FE74`, `$FE92`, `$FEB5`, worked on at `$FE6A`), a
   * ball record of 16 (`$FE7E`, `$FE9C`, `$FEBF`) and a path (`$C80A`,
   * `$C81E`, `$C832`). A slot with byte 1 of the block 0 ends the list.
   */
  enemies() {
    var slots = [[0xFE7E, 0xC80A, 0xFE74, 0xFE7B], [0xFE9C, 0xC81E, 0xFE92, 0xFE99],
                 [0xFEBF, 0xC832, 0xFEB5, 0xFEBC]];
    for (var i = 0; i < 3; i++) {
      if (this.rd(slots[i][3]) === 0) {
        return;
      }
      this.enemySlot(slots[i][0], slots[i][1], slots[i][2]);
    }
  } // enemies

  /**
   * ★ `$7C31`: the slot's control block to `$FE6A`, its record and path to
   * `$FE3E` / `$FE40`, the Bearing moved (`$7A7B`), nine bytes back.
   */
  enemySlot(record, path, control) {
    this.ww(0xFE40, path);
    this.ww(0xFE3E, record);
    for (var i = 0; i < 10; i++) {
      this.wr(0xFE6A+i, this.rd(control+i));
    }
    this.enemyThink();
    for (i = 0; i < 9; i++) {               // $7BE3 LDIR, BC = 9
      this.wr(control+i, this.rd(0xFE6A+i));
    }
  } // enemySlot

  /**
   * ★ `$7A7B`: the Bearing's mind — `$FE71` 0 none, 2 fresh (`$7A85`: the
   * path's first pair into target cell `$FE6A` and direction `$FE6D`,
   * `$FE6B` = `$FF` waiting, step `$FE6C` = 0), 1 going. The path at
   * `$FE40` is `$FE70` + 1 pairs (cell, direction): a direction 0 makes
   * the cell a count of passes to wait (`$7AE8`). Waiting (`$FE6B` =
   * `$FF`) ends when Bobby or the brother is on cell `$FE72` (`$7AF5`);
   * on reaching the target cell the next pair is taken (`$7B14`), after
   * the last the path starts over.
   */
  enemyThink() {
    var a = this.rd(0xFE71);
    if (a === 0) {
      return;
    }
    if (a !== 1) {
      this.enemyRestart();                  // $7A85
    }
    this.enemyDecide();                     // $7AA2
  } // enemyThink

  /** ★ `$7A85`: the path from its start. */
  enemyRestart() {
    var hl = this.rw(0xFE40);
    this.wr(0xFE6C, 0);
    this.wr(0xFE6B, 0xFF);
    this.wr(0xFE6A, this.rd(hl));
    this.wr(0xFE6D, this.rd(hl+1));
    this.ww(0xFE6E, hl+2);
    this.wr(0xFE71, 1);
  } // enemyRestart

  /** ★ `$7AA2`: wait, count down, or roll towards the target cell. */
  enemyDecide() {
    var e = this.rd(0xFE6B);
    if (e === 0) {                          // $7AE8: a pause of $FE6A passes
      var a = (this.rd(0xFE6A)-1) & 0xFF;
      this.wr(0xFE6A, a);
      if (a !== 0) {
        this.enemyStep(0xFF);
        return;
      }
      this.enemyNext(0);                    // $7B14
      return;
    }
    if (e === 0xFF && this.rd(0xFE6C) === 0) {
      e = this.enemyWait(e);                // $7AF5
    }
    if (this.rd(0xFE6A) === this.rd(this.rw(0xFE3E)+6)) {   // the target cell reached
      this.enemyNext(e);
      return;
    }
    this.enemyStep(e);                      // $7AC2
  } // enemyDecide

  /**
   * ★ `$7AF5`: the Bearing waits for Bobby (`$FE48`) or the brother in the
   * room (`$FE5C`) on cell `$FE72` — 0 for no waiting — then sets off in
   * the direction `$FE6D`.
   * @returns {number} E: the direction, or `$FF` still waiting.
   */
  enemyWait(e) {
    var b = this.rd(0xFE72);
    if (b !== 0 && this.rd(0xFE48) !== b) {
      if (this.rd(0xFE36) === 0 || this.rd(0xFE5C) !== b) {
        return e;
      }
    }
    var a = this.rd(0xFE6D);
    this.wr(0xFE6B, a);
    return a;
  } // enemyWait

  /**
   * ★ `$7B14`: the next pair of the path (step `$FE6C` of `$FE70`), the
   * path over again after the last; the move this pass still uses the
   * direction `e` from before.
   */
  enemyNext(e) {
    if (this.rd(0xFE6C) === this.rd(0xFE70)) {
      this.enemyRestart();
      this.enemyDecide();
      return;
    }
    var hl = this.rw(0xFE6E);
    this.wr(0xFE6C, this.rd(0xFE6C)+1);
    this.wr(0xFE6A, this.rd(hl));
    this.wr(0xFE6B, this.rd(hl+1));
    this.ww(0xFE6E, hl+2);
    this.enemyStep(e);
  } // enemyNext

  /**
   * ★ `$7AC3`: the Bearing at `$FE3E` rolls by the ball's physics with the
   * direction `a` as its controls (`$FDF6`), `$FE2F` = `$40` and `$FDEA` =
   * 1, its velocities clipped to `$FE73` (`$7C12`), then its collisions
   * (`$7B48`).
   */
  enemyStep(a) {
    this.wr(0xFDF6, a);
    var hl = this.rw(0xFE3E);
    this.wr(0xFE2F, 0x40);
    this.loadBall(hl);
    this.wr(0xFDEA, 1);
    this.physics();                         // $7AD6 CALL $8214
    this.storeBall(hl);
    this.clipVelocities(hl+1);              // $7AE3 CALL $7C12
    this.enemyCollisions();                 // $7AE6 JR $7B48
  } // enemyStep

  /** ★ `$7C12`: the two velocity bytes at `hl`, `hl` + 2 within ±`$FE73`. */
  clipVelocities(hl) {
    var c = this.rd(0xFE73);
    for (var b = 0; b < 2; b++) {
      var a = this.rd(hl);
      if (a >= 0x78) {
        if (((-a) & 0xFF) >= c) {
          this.wr(hl, (-c) & 0xFF);
        }
      } else if (a >= c) {
        this.wr(hl, c);
      }
      hl += 2;
    }
  } // clipVelocities

  /**
   * ★ `$7B48`: the Bearing's collisions — Bobby and the brother saved at
   * `$FF00` / `$FF14` (`$7BA1`), the Bearing put in Bobby's place `$FE42`
   * with `$FDEA` from `$7B57` (1; 0 for the chasing ball), Bobby in the
   * brother's `$FE56`, the collision of the two (`$76D3`), then the
   * brother when in the room, the Bearing back to its record and the two
   * balls back (`$7BB8`).
   */
  enemyCollisions() {
    var record = this.rw(0xFE3E);
    this.copyBall(0xFE42, 0xFF00);          // $7BA1
    this.copyBall(0xFE56, 0xFF14);
    this.copyBall(record, 0xFE42);
    this.wr(0xFDEA, this.rd(0x7B57));
    this.copyBall(0xFF00, 0xFE56);
    this.collide();
    this.copyBall(0xFE56, 0xFF00);
    if (this.rd(0xFE36) !== 0) {
      this.copyBall(0xFF14, 0xFE56);
      this.collide();
      this.copyBall(0xFE56, 0xFF14);
    }
    this.copyBall(0xFE42, record);          // $7B93
    this.copyBall(0xFF00, 0xFE42);          // $7BB8
    this.copyBall(0xFF14, 0xFE56);
  } // enemyCollisions

  /** 16 bytes of a ball's record `from` → `to` (LDIR). */
  copyBall(from, to) {
    for (var i = 0; i < 16; i++) {
      this.wr(to+i, this.rd(from+i));
    }
  } // copyBall

  // --- the entities kept over a change of room ------------------------------------

  /**
   * ★ `$92A6` (from `$7935`, before the room is built): the heights the
   * mechanisms left in the map go back into their tables, so the room is
   * the same when entered again — byte 1 of each `$F104` record (pointers
   * `$EB8C`, the operand of `$92B4`) and byte 2 of the `$EA2E` records of
   * types 2 and 3 (`$98E1`, pointers `$60F4`, the operand of `$98EE`;
   * type 3 keeps the block).
   */
  keepEntities() {
    var n = this.rd(0xC864);
    var p;
    if (n !== 0) {
      p = 0xEB8C;
      this.ww(0x92B5, p);
      for (var i = 0; i < n; i++) {
        var hl = this.rw(p);
        this.wr(hl+1, this.rd((0x5EEC+2*this.rd(hl+4)) & 0xFFFF));
        p += 2;
        this.ww(0x92B5, p);
      }
    }
    n = this.rd(0x6126);                    // $98E1
    if (n === 0) {
      return;
    }
    p = 0x60F4;
    this.ww(0x98EF, p);
    for (var k = 0; k < n; k++) {
      var at = this.rw(p);
      var type = this.rd(at) & 7;
      if (type === 2 || type === 3) {
        var cell = this.rd(at+(type === 2 ? 3 : 4));
        var map = (0x5EEC+2*cell+(type === 2 ? 0 : 1)) & 0xFFFF;
        this.wr(at+2, this.rd(map));
      }
      p += 2;
      this.ww(0x98EF, p);
    }
  } // keepEntities

  // --- the big ball -----------------------------------------------------------

  /**
   * ★ `$801F` → `$F3AA`: an object of type `$0A` — a squashed ball
   * (`$FE30` from `$0A`): the column of its record moved 4 pixels left,
   * then a sprite 3 bytes wide (`$EAC1`, 96 bytes a frame — 48 drawing,
   * 48 mask — by `$FE30` − `$0A`, from 4 the one at `$F001`) 0-2 lines
   * lower, drawn by the sprite routine with its operands changed for the
   * width (`$F400`: `$80CD`, `$8146`, `$8100`, `$811E`, `$8143`, `$80E0`)
   * and put back after. `$FDEE` = `$FF` makes the mask follow the drawing.
   * @param {number} hl - The record's end (`$7FEC` + 5).
   * @param {number} e - Its line.
   * @param {number} d - Its column in pixels.
   */
  drawBigBall(hl, e, d) {
    d = (d-4) & 0xFF;
    this.wr(hl-2, d);
    this.wr(0xFE0B, d & 7);                 // $803B without the drawing ($804B = RET)
    this.wr(0xFDEB, e);
    this.wr(0xFDEC, d >> 3);
    this.ww(0xF3A6, this.rw(0xFDEB));       // $F3AA
    var l = this.rd(0xFDEE);
    this.wr(0xFDEE, 0xFF);
    var a = (l-0x0A) & 0xFF;
    var sprite;
    if (a < 4) {
      sprite = (0xEAC1+96*l) & 0xFFFF;
      a = this.sra(a);
    } else {
      sprite = 0xF001;
      a = 2;
    }
    this.wr(0xFDEB, (this.rd(0xFDEB)+a) & 0xFF);
    this.wr(0xF41D, 0x1C);
    this.spriteOperands(sprite, 0x0410, 3, 0x40, 0x10, 0x1C);   // $F400
    var after = this.blitSprite(sprite, {   // $74E4 → $80AB, with the operands set
      lines: this.rd(0x8143), widen: this.rd(0x8146), shifted: this.rd(0x8100),
      width: this.rd(0x80CE), rows: this.rd(0x80CD), step: this.rw(0x80E0)
    });
    this.wr(0xF41D, 0x1D);
    this.spriteOperands(after, 0x0310, 2, 0x30, 0x10, 0x1D);
  } // drawBigBall

  /**
   * ★ `$F400`: the operands of the sprite routine — `$F3A8` the sprite,
   * `$80CD` width and lines (`LD BC`), `$8146` bytes a line widened,
   * `$8100` and `$811E` bytes shifted, `$8143` lines, `$80E0` the step
   * between lines (`$F41D`).
   */
  spriteOperands(hl, de, a, c, b, step) {
    this.ww(0xF3A8, hl);
    this.ww(0x80CD, de);
    this.wr(0x8146, a);
    this.wr(0x8100, c);
    this.wr(0x811E, c);
    this.wr(0x8143, b);
    this.wr(0x80E0, step);
  } // spriteOperands

  /**
   * ★ `$7650`: a ball's record (16 bytes) into the working variables.
   * @param {number} hl - $FE42 Bobby, $FE56 a brother.
   */
  loadBall(hl) {
    this.wr(0xFE28, this.rd(hl));
    this.wr(0xFDFB, this.rd(hl+1));
    this.wr(0xFE29, this.rd(hl+2));
    this.wr(0xFDFA, this.rd(hl+3));
    this.wr(0xFDF3, this.rd(hl+4));
    this.wr(0xFDF4, this.rd(hl+5));
    this.wr(0xFE04, this.rd(hl+7));
    this.wr(0xFE05, this.rd(hl+8));
    this.wr(0xFE03, this.rd(hl+9));
    this.wr(0xFE0C, this.rd(hl+10));
    this.wr(0xFDF7, this.rd(hl+10));
    this.wr(0xFE0A, this.rd(hl+11));
    this.wr(0xFE2D, this.rd(hl+12));
    this.wr(0xFE30, this.rd(hl+14));
    this.wr(0xFDED, this.rd(hl+15));
  } // loadBall

  /**
   * ★ `$7693`: the working variables back into a ball's record.
   * @param {number} hl - The record.
   */
  storeBall(hl) {
    this.wr(hl, this.rd(0xFE28));
    this.wr(hl+1, this.rd(0xFDFB));
    this.wr(hl+2, this.rd(0xFE29));
    this.wr(hl+3, this.rd(0xFDFA));
    this.wr(hl+4, this.rd(0xFDF3));
    this.wr(hl+5, this.rd(0xFDF4));
    if (this.rd(0xFE30) < 0x0A) {
      this.wr(hl+6, this.rd(0xFE2C));
    }
    this.wr(hl+7, this.rd(0xFE04));
    this.wr(hl+8, this.rd(0xFE05));
    this.wr(hl+9, this.rd(0xFE03));
    this.wr(hl+10, this.rd(0xFE0C));
    this.wr(hl+11, this.rd(0xFE0A));
    this.wr(hl+12, this.rd(0xFE2D));
  } // storeBall

  // --- time --------------------------------------------------------------------

  /**
   * ★ `$7F73`: B × 8 ticks of the time.
   * @param {number} b - B (0 = 256).
   */
  timePenalty(b) {
    do {
      for (var c = 0; c < 8; c++) {
        this.timeTick();
      }
      b = (b-1) & 0xFF;
    } while (b !== 0);
  } // timePenalty

  /**
   * ★ `$71AC` → `$73F5`: the end of the pass — the time out, SPACE for the
   * pause, a tick of the time.
   */
  passEnd() {
    if (this.rd(0xFE55) !== 0) {            // $7494: the time is out
      this.endScreen(0x749D, 0x70, 'timeout');
      return;
    }
    if ((this.inPort(0x7FFE) & 1) === 0) {
      this.pause();                         // $73C0
      if (this.outcome !== 'pass') {
        return;                             // $71BB
      }
    }
    this.timeTick();
  } // passEnd

  /**
   * ★ `$73C0`: the original's pause — the border red, SPACE released, a
   * delay (`$73EC`), then SPACE again goes on with the tick of time; `1`
   * and `4` together give the game up (`$71BB`: the original's screen of
   * controls, which the remake's menu stands for — outcome 'quit'). Only
   * the reads of the ports are state; the border and the delay are not. The
   * worker never sends SPACE (its pause is the model's), so it never gets
   * here.
   */
  pause() {
    while ((this.inPort(0x7FFE) & 1) === 0) {   // $73C0: SPACE released
    }
    for (;;) {                              // $73CF
      if ((this.inPort(0x7FFE) & 1) === 0) {
        return;                             // $73E5 → $7404
      }
      if ((this.inPort(0xF7FE) & 9) === 0) {
        // ★ $73DF → $71BB: the game given up for the original's screen of
        // controls — the remake's menu (outcome 'quit', nothing more done)
        this.outcome = 'quit';
        return;
      }
    }
  } // pause

  /**
   * ★ `$7404`: the time goes down by one in the last of its four digits,
   * each a position in a strip of glyphs (`$49` … `$01`, then `$50`), and
   * `$743E` draws them.
   */
  timeTick() {
    if (this.rd(0xFE55) !== 0) {
      return;
    }
    this.timeTicks++;
    var digits = [0xFE69, 0xFE68, 0xFE67];
    var carry = true;
    for (var i = 0; i < 3 && carry; i++) {
      var v = (this.rd(digits[i])-1) & 0xFF;
      this.wr(digits[i], v);
      if (v < 0x49) {
        if (v !== 0) {
          carry = false;
        } else {
          this.wr(digits[i], 0x50);
        }
      }
    }
    if (carry) {
      var top = (this.rd(0xFE66)-1) & 0xFF;     // $7433
      this.wr(0xFE66, top);
      if (top === 0) {
        this.wr(0xFE55, 1);
      }
    }
    this.drawTime();
  } // timeTick

  /** ★ `$743E`: the four digits of the time, columns 5, 4, 3, 2. */
  drawTime() {
    this.drawDigit(this.rd(0xFE69), 5);
    this.drawDigit(this.rd(0xFE68), 4);
    this.drawDigit(this.rd(0xFE67), 3);
    this.drawDigit(this.rd(0xFE66), 2);
  } // drawTime

  /**
   * ★ `$745B`: eight lines of the strip at `$F88B + a`, inverted, into the
   * screen at row 20, column `e`; past `$51` the strip starts again.
   */
  drawDigit(a, e) {
    var de = (0xF88B+a) & 0xFFFF;
    var hl = 0x5080+e;
    var c = a;
    for (var b = 0; b < 8; b++) {
      this.wr(hl, ~this.rd(de));
      c = (c+1) & 0xFF;
      de = (de+1) & 0xFFFF;
      hl = (hl+0x100) & 0xFFFF;
      if (c >= 0x51) {
        de = 0xF88C;
        c = 1;
      }
    }
  } // drawDigit

  // --- input -------------------------------------------------------------------

  /**
   * ★ `$FC94`: the four directions into `$FDF6` (bits 0 right, 1 up, 2 down,
   * 3 left, 0 = pressed), by the controls chosen (`$FEE7`).
   * @returns {number} ($FE3A) for the caller's flags (unused).
   */
  readControls() {
    this.wr(0xFDF6, 0xFF);
    if (this.rd(0xFE03) === 1) {
      return;
    }
    var mode = this.rd(0xFEE7);
    var a;
    if (mode === 0) {                       // $FD0E KEYBOARD
      var d = 0;
      var e = ~this.inPort(0x7FFE) & 0x1F;
      a = ~this.inPort(0xFEFE) & 0x1E;
      e >>= 1;
      var c = a | e;
      if (c & 0x0A) {
        d = 8;
      }
      if (c & 0x15) {
        d++;
      }
      e = ~this.inPort(0xBFFE) & 0xFF;
      a = (~this.inPort(0xFDFE) | e) & 0x1F;
      if (a) {
        d += 4;
      }
      e = ~this.inPort(0xDFFE) & 0xFF;
      a = (~this.inPort(0xFBFE) | e) & 0x1F;
      if (a) {
        d += 2;
      }
      a = ~d & 0xFF;
    } else if (mode === 1) {                // $FCCB KEMPSTON
      var b = this.inPort(0x001F);
      var k = b & 0x04;
      k |= (b & 0x08) >> 2;
      k |= ((b & 0x02) << 2) & 0xFF;
      k |= b & 0x01;
      a = ~k & 0xFF;
    } else if (mode === 3) {                // $FCEE
      var v = ~this.inPort(0xEFFE) & 0xFF;
      var cc = v & 0x06;
      var bb = (v >> 1) & 0x0C;
      cc |= bb & 0x08;
      cc |= (bb >> 2) & 0x01;
      a = ~cc & 0xFF;
    } else {                                // $FCB0
      var dd = this.inPort(0xF7FE) | 0xEF;
      a = this.inPort(0xEFFE) >> 1;
      a = (a & dd) >> 1;
    }
    this.wr(0xFDF6, a);
  } // readControls

  /**
   * ★ `$81EA`: `Q` CHEAT — the ball stunned, put back at the room's start
   * (`$FE50` = 2), the sound 6.
   */
  cheat() {
    if (this.inPort(0xFBFE) & 1) {
      return;
    }
    this.wr(0xFE50, 2);
    this.wr(0xFE51, 2);
    this.wr(0xFE4B, 0);
    this.wr(0xFE4A, 0);
    this.soundRequest(0xF061, 6, 'game');
    if (this.rd(0xFE36) === 0) {
      return;
    }
    this.wr(0xFE64, 2);
    this.wr(0xFE65, 2);
  } // cheat

  // --- the ball -------------------------------------------------------------

  /** ★ `$8214`: by `$FDEA` — 0 rolling under control, 1 without, else stunned. */
  physics() {
    var a = this.rd(0xFDEA);
    if (a === 0) {                          // $83CD
      this.readControls();                  // CALL $8DDE
      this.roll();                          // CALL $83E1
      this.damp();                          // CALL $8AE0
    } else if (a === 1) {                   // $83DC
      this.roll();
    } else {
      this.stunned();                       // $8C59
      return;
    }
    this.screenPosition();                  // $83D6 CALL $83A5
    this.ballObject();                      // JP $8224
  } // physics

  /**
   * ★ `$8C59`: a ball not rolling: `$FE30` 2 rolls without control, under 3
   * or from `$0A` stands with the sprite of `$FE30`, 3-9 is drawn lifted.
   */
  stunned() {
    this.wr(0xFDF6, 0xFF);
    this.wr(0xFE2D, 5);
    var a = this.rd(0xFE30);
    if (a === 2) {
      this.roll();                          // JP $83DC
      this.screenPosition();
      this.ballObject();
      return;
    }
    if (a >= 3 && a < 0x0A) {               // $8C96
      this.roll();
      this.screenPosition();
      this.ballObject();
      this.wr(0xFDE8, (this.rd(0xFDE8)-0x14) & 0xFF);
      var c = this.rd(0xFE0A);
      this.wr(0xFE0A, 0);
      this.wr(0xFDF7, 0);
      this.wr(0xFE2F, 0x6B);
      this.ballObject();                    // CALL $8224
      this.wr(0xFE0A, c);
      if (this.rd(0xFDED) >= 0x14) {
        return;
      }
      var hl = this.rw(0xC990);
      this.wr(hl-1, 4);
      return;
    }
    this.wr(0xFE2F, a);                     // $8C70
    this.wr(0xFDF7, 0);
    this.wr(0xFE0A, 0);
    if (this.rd(0xFDF3) & 0x80) {
      this.wr(0xFDF3, 0);
    }
    if (this.rd(0xFDF4) & 0x80) {
      this.wr(0xFDF4, 0);
    }
    this.screenPosition();                  // JP $83D6
    this.ballObject();
  } // stunned

  /**
   * ★ `$83E1`: one step of rolling — the idle counter `$FE2D`, then the
   * velocities, the cell, the heights around, the height, the walls, the
   * slopes and the frame.
   */
  roll() {
    var a;
    var still = this.rd(0xFDFA) === 0 && this.rd(0xFDFB) === 0
        && this.rd(0xFE28) === 0 && this.rd(0xFE29) === 0
        && this.rd(0xFE03) === 0 && (this.rd(0xFDF6) & 0x0F) === 0x0F;
    if (still) {
      a = this.rd(0xFE2D);
      if (a !== 0) {
        a--;
      }
    } else {
      a = 5;                                // $8423
    }
    this.wr(0xFE2D, a);                     // $840B
    this.accelerate();                      // $8427
    this.cell();                            // $82DD
    this.surroundings();                    // $8707
    this.height();                          // $8560
    this.walls();                           // $8BD1
    this.slopes();                          // $8CC5
    this.frame();                           // $85D3
  } // roll

  /**
   * ★ `$8427`: the controls into the velocities `$FDFA` (y) and `$FDFB` (x),
   * ±2 a pass up to ±16, back towards 0 without; the velocities plus the
   * slopes' `$FE28`/`$FE29`, a quarter of it, move the position `$FDF3`
   * within $00-$71 — at the edge it stops and the frame turns.
   */
  accelerate() {
    var e = this.rd(0xFDF3), d = this.rd(0xFDF4);
    if (this.rd(0xFE03) === 0) {
      var b = ~this.rd(0xFDF6) & 0xFF;
      this.wr(0xFDFB, this.steer(b & 0x09, 0x09, 0x08, this.rd(0xFDFB)));
      this.wr(0xFDFA, this.steer(b & 0x06, 0x06, 0x02, this.rd(0xFDFA)));
    }
    var hl = 0xFE0C;
    var a = this.quarter((this.rd(0xFE29)+this.rd(0xFDFA)) & 0xFF);   // $84D4
    this.wr(0xFE2B, a);
    a = (a+e) & 0xFF;
    if (a >= 0xDC) {
      a = 0;
      this.wr(0xFDFA, 0);
      this.wr(0xFE29, 0);
      this.wr(hl, this.rd(hl)+1);
    } else if (a >= 0x72) {
      this.wr(0xFDFA, 0);
      this.wr(0xFE29, 0);
      a = 0x71;
      this.wr(hl, this.rd(hl)-1);
    }
    e = a;
    a = this.quarter((this.rd(0xFE28)+this.rd(0xFDFB)) & 0xFF);        // $8513
    this.wr(0xFE2A, a);
    a = (a+d) & 0xFF;
    if (a >= 0xDC) {
      a = 0;
      this.wr(0xFDFB, 0);
      this.wr(0xFE28, 0);
      this.wr(hl, this.rd(hl)+1);
    } else if (a >= 0x72) {
      this.wr(0xFDFB, 0);
      this.wr(0xFE28, 0);
      a = 0x71;
      this.wr(hl, this.rd(hl)-1);
    }
    this.wr(0xFDF3, e);
    this.wr(0xFDF4, a);
  } // accelerate

  /**
   * ★ `$8437`/`$8485`: one axis of the controls.
   * @param {number} bits - The two bits of the axis pressed.
   * @param {number} both - Both pressed.
   * @param {number} minus - The bit that steers down.
   * @param {number} v - The velocity.
   * @returns {number} The new velocity.
   */
  steer(bits, both, minus, v) {
    if (bits === 0) {
      if (v >= 0x64) {
        return (v+1) & 0xFF;
      }
      return v === 0 ? 0 : v-1;
    }
    if (bits === both) {
      return v;
    }
    if (bits === minus) {
      v = (v-2) & 0xFF;
      if (v >= 0xEF || v < 0x78) {
        return v;
      }
      return 0xF0;
    }
    v = (v+2) & 0xFF;
    if (v < 0x11 || v >= 0x78) {
      return v;
    }
    return 0x10;
  } // steer

  /**
   * ★ `$84DF`: a quarter of a signed velocity (`$78` and up is negative),
   * rounded towards zero.
   */
  quarter(a) {
    if (a >= 0x78) {
      a = (-a) & 0xFF;
      a = this.sra(this.sra(a));
      return (-a) & 0xFF;
    }
    return this.sra(this.sra(a));
  } // quarter

  sra(a) { return (a & 0x80) | (a >> 1); }

  /**
   * ★ `$82DD`: the cell under the ball (`$FDF1`, `$FDF2`, `$FDF5`) and which
   * neighbours its position within the cell reaches (`$FDFC`-`$FE01`),
   * the cell index for the heights in `$FDF8`.
   */
  cell() {
    var l = this.rd(0xFDF3), h = this.rd(0xFDF4);
    var d = h >> 4, e = l >> 4;
    this.wr(0xFDF1, e);
    this.wr(0xFDF2, d);
    this.wr(0xFDF5, (((h & 0xF0) >> 1)+e) & 0xFF);
    for (var i = 0; i < 6; i++) {
      this.wr(0xFDFC+i, 0);
    }
    this.reach(l & 0x0F, 0xFDFC, 0x01, 0xFE00, 0xFDFE);
    this.reach(h & 0x0F, 0xFDFD, 0x08, 0xFE01, 0xFDFF);
    this.wr(0xFDF8, (this.rd(0xFDF5)+this.rd(0xFDFC)+this.rd(0xFDFD)+0xC0) & 0xFF);
  } // cell

  /** ★ `$8314`/`$8354`: one axis of `$82DD`. */
  reach(a, step, stepValue, high, low) {
    if (a >= 9) {
      this.wr(high, this.rd(high) | 1);
      this.wr(step, stepValue);
      if (a >= 0x0F) {
        return;
      }
      this.wr(high, this.rd(high) | 2);
      if (a >= 0x0B) {
        return;
      }
      this.wr(high, this.rd(high) | 4);
      return;
    }
    if (a >= 2) {
      this.wr(low, this.rd(low) | 1);
    }
    if (a >= 3) {
      this.wr(low, this.rd(low) | 2);
    }
    if (a >= 6) {
      this.wr(low, this.rd(low) | 4);
    }
  } // reach

  /**
   * ★ `$83A5`: the ball's place on the screen `$FDE8` (line), `$FDE9`
   * (column in pixels) from its position and height.
   */
  screenPosition() {
    var l = this.rd(0xFDF3), h = this.rd(0xFDF4);
    var c = this.rd(0xFE04);
    var d = (h-l) & 0xFF;
    var f = this.rd(0xFE0A);
    var a;
    if (f === 0 || f === 0x10) {
      a = ((h >> 1)+(l >> 1)) & 0xFF;       // $8CFB
    } else {
      a = ((h+l) & 0xFF) >> 1;
    }
    var e = (a-c+0x3F) & 0xFF;
    d = (0x79+d) & 0xFF;
    this.wr(0xFDE8, e);
    this.wr(0xFDE9, d);
  } // screenPosition

  /**
   * ★ `$8224`: the ball into the list of objects to draw (`$C990`, five
   * bytes: depth, sprite, line, column, type) — or into `$FF78` while it
   * stands (`$FE2D` = 0).
   */
  ballObject() {
    if (this.rd(0xFDE8) >= 0xB4) {
      return;
    }
    var hl;
    if (!(this.rd(0x8D5E) & 0x40) && this.rd(0xFE2D) === 0) {
      hl = this.objectRecord(this.rw(0xFF76));    // $8295
      this.ww(0xFF76, hl);
      this.wr(hl-1, 3);
      this.wr(0xFF78, this.rd(0xFF78)+1);
      return;
    }
    hl = this.rw(0xC990);
    if (this.rd(0xFE2F) === 0x40) {         // $823C
      var s = (this.rd(0xFE2B)+this.rd(0xFE2A)) & 0xFF;
      if (s & 0x80) {
        s = (-s) & 0xFF;
      }
      if (s !== 0 && (s >= 4 || (this.rd(0xFE69) & 1))) {
        this.soundRequest(0xF062, (0x1E-s) & 0xFF, 'bearings');
      }
    }
    hl = this.objectRecord(hl);             // $8264
    this.ww(0xC990, hl);
    if (this.rd(0x8D5E) & 0x40) {
      this.wr(hl-1, 4);
    }
    if (this.rd(0xFE30) >= 0x0A) {
      this.wr(hl-1, 0x0A);
    }
    var x = this.rd(0x85AE);
    if (x >= 6 && !(x & 0x80)) {
      this.wr(hl-1, this.rd(hl-1)+0x80);
    }
    this.wr(0xC9A4, this.rd(0xC9A4)+1);
  } // ballObject

  /**
   * ★ `$82A6`: five bytes of the ball at `hl`.
   * @returns {number} HL after them.
   */
  objectRecord(hl) {
    var e = (this.rd(0xFDF4)+this.rd(0xFDF3)) & 0xFF;
    this.wr(hl, this.rd(0xFE04)+e);
    if (this.rd(0xFE30) >= 0x0A && this.rd(0xFEB2) !== 5) {
      this.wr(hl, this.rd(0xFEB2));
    }
    hl++;
    this.wr(hl++, this.rd(0xFE2F)+this.rd(0xFE0A)+this.rd(0xFDF7));
    this.wr(hl++, this.rd(0xFDE8));
    this.wr(hl++, this.rd(0xFDE9));
    this.wr(hl++, 0);
    return hl & 0xFFFF;
  } // objectRecord

  /** ★ `$8AE0`: on a fast diagonal both velocities and slopes halve. */
  damp() {
    var a = this.rd(0xFE2A);
    if (a === 0) {
      return;
    }
    if (a >= 0x78) {
      a = (-a) & 0xFF;
    }
    if (a < 3) {
      return;
    }
    a = this.rd(0xFE2B);
    if (a === 0) {
      return;
    }
    if (a >= 0x78) {
      a = (-a) & 0xFF;
    }
    if (a < 3) {
      return;
    }
    [0xFE28, 0xFE29, 0xFDFB, 0xFDFA].forEach((at) => this.wr(at, this.sra(this.rd(at))));
  } // damp

  // --- heights ----------------------------------------------------------------

  /**
   * ★ `$8707`: the heights of the four cells around the ball (`$FDF8` and
   * -$40, -$80, -$C0) into the flags `$FE19`-`$FE27`.
   */
  surroundings() {
    this.wr(0xFE1D, 0);
    for (var i = 0; i < 0x0F; i++) {
      this.wr(0xFE19+i, 0);
    }
    for (var b = 0; b < 4; b++) {
      this.neighbours();                    // $8726
      this.wr(0xFDF8, (this.rd(0xFDF8)-0x40) & 0xFF);
    }
  } // surroundings

  /** ★ `$8726`. */
  neighbours() {
    if (this.rd(0xFE22) === 0) {
      this.under();                         // $8852
    }
    if (this.rd(0xFE1E) === 0 && this.rd(0xFDFF) !== 0) {
      this.side(0x08, 0xFE1E, 0xFF0B, 0xCA76, 0xFDFF, 0xCA36);   // $88E2
    }
    if (this.rd(0xFE1F) === 0 && this.rd(0xFE01) !== 0) {
      this.side(-0x08, 0xFE1F, 0xFF06, 0xCA7C, 0xFE01, 0xCA39);  // $8905
    }
    if (this.rd(0xFE20) === 0 && this.rd(0xFDFE) !== 0) {
      this.side(0x01, 0xFE20, 0x0C0A, 0xCA82, 0xFDFE, 0xCA3C);   // $8928
    }
    if (this.rd(0xFE21) === 0 && this.rd(0xFE00) !== 0) {
      this.side(-0x01, 0xFE21, 0x1507, 0xCA88, 0xFE00, 0xCA3F);  // $894A
    }
    if (!(this.rd(0xFE19) & 1) && this.rd(0xFE23) === 0
        && (this.rd(0xFDFE) & this.rd(0xFDFF) & 2)) {
      this.corner(0x09, 0xFE23, 0xCA90, 0xCA42);                 // $896C
    }
    if (!(this.rd(0xFE1B) & 1) && this.rd(0xFE25) === 0
        && (this.rd(0xFE01) & this.rd(0xFDFE) & 2)) {
      this.corner(-0x07, 0xFE25, 0xCA96, 0xCA44);                // $89AA
    }
    if (!(this.rd(0xFE1A) & 1) && this.rd(0xFE24) === 0
        && (this.rd(0xFE00) & this.rd(0xFE01) & 2)) {
      this.corner(-0x09, 0xFE24, 0xCA9C, 0xCA43);                // $898B
    }
    if (!(this.rd(0xFE1C) & 1) && this.rd(0xFE26) === 0
        && (this.rd(0xFDFF) & this.rd(0xFE00) & 2)) {
      this.corner(0x07, 0xFE26, 0xCAA2, 0xCA45);                 // $89C9
    }
  } // neighbours

  /**
   * ★ `$8658`: cell `a` of the map — its height `$FE0E` and block `$FE0F`,
   * the block's two profiles (`$FE12`, `$FE10`). An empty cell (`$E7`) is
   * the ball's own height with block 3 (`$8D5F`).
   * @returns {number} 0, or 1 when the cell is not there or too high.
   */
  heightCell(a) {
    var hl = (0x5EEC+2*a) & 0xFFFF;
    var h = this.rd(hl);
    var block;
    if (h === 0) {
      return 1;
    }
    if (h === 0xE7) {                       // $8D5F
      this.wr(0xFE0E, this.rd(0xFE04));
      this.wr(0x8D6E, 3);
      block = 3;
    } else {
      this.wr(0xFE0E, h);
      if (((this.rd(0xFE04)+0x0C) & 0xFF) < h) {
        return 1;
      }
      block = this.rd(hl+1);
    }
    this.wr(0xFE0F, block);                 // $8679
    var entry = (0xCAA7+2*(block & 0x3F)) & 0xFFFF;
    this.ww(0xFE12, (0xCAE7+16*this.rd(entry)) & 0xFFFF);
    this.ww(0xFE10, (0xCAE7+16*this.rd(entry+1)) & 0xFFFF);
    return 0;
  } // heightCell

  /**
   * ★ `$86A7`: the height of the block's surface at the ball's position plus
   * BC (`$FDF3`, in sixteenths of a cell), the higher or the lower of its two
   * profiles by `$CA12`, plus the cell's height, less `a`; and the highest
   * of those under 8 into `$FE27`.
   * @returns {number}
   */
  surface(a, bc) {
    this.wr(0xFE18, a);
    var hl = (this.rw(0xFDF3)+bc) & 0xFFFF;
    var c = (hl >> 8) & 0x0F;
    var l = hl & 0x0F;
    var b = this.rd(this.rw(0xFE12)+l);
    c = this.rd(this.rw(0xFE10)+c);
    var v;
    if (this.rd(0xCA12+this.rd(0xFE0F)) === 0) {
      v = c < b ? c : b;
    } else {
      v = c >= b ? c : b;
    }
    b = (this.rd(0xFE0E)+v) & 0xFF;
    var d = this.rd(0xFE18);
    if (d !== 8) {
      var e = (b-d) & 0xFF;
      if (this.rd(0xFE27) < e) {
        this.wr(0xFE27, e);
      }
    }
    return (b-d) & 0xFF;
  } // surface

  /** ★ `$8852`: the cell under the ball. */
  under() {
    if (this.heightCell(this.rd(0xFDF8)) !== 0) {
      return;
    }
    this.wr(0xFE22, 1);
    var b = this.surface(0, 0x0707);
    this.wr(0x8BD0, b);
    this.wr(0x8D5E, this.rd(0xFE0F));
    if (this.rd(0xFE04) < ((b+1) & 0xFF)) {
      this.wr(0xFE1D, 1);
    }
    this.wr(0xFE2C, this.rd(0xFDF8));
    var a = this.rd(0xFDFF);
    if (a !== 7) {
      this.ww(0x8D04, 0xFF0B);
      this.edges(0xCA7B, 0xCA38, a);
    }
    a = this.rd(0xFE01);
    if (a !== 7) {
      this.ww(0x8D04, 0xFF06);
      this.edges(0xCA81, 0xCA3B, a);
    }
    a = this.rd(0xFDFE);
    if (a !== 7) {
      this.ww(0x8D04, 0x0C0A);
      this.edges(0xCA87, 0xCA3E, a);
    }
    a = this.rd(0xFE00);
    if (a === 7) {
      return;
    }
    this.ww(0x8D04, 0x1507);
    this.edges(0xCA8D, 0xCA41, a);
  } // under

  /**
   * ★ `$87D6`: three points of an edge from the table at `hl` (descending)
   * into `bc` (descending), stopping where `e` says; for the blocks of
   * `$8D04`/`$8D05` the next one is 0.
   */
  edges(hl, bc, e) {
    var hb = this.edgePoint(hl, bc, 1);
    hl = hb[0]; bc = hb[1];
    if (e & 2) {
      return;
    }
    hb = this.edgePoint(hl, bc, 4);
    hl = hb[0]; bc = hb[1];
    if (e & 1) {
      return;
    }
    hb = this.edgePoint(hl, bc, 8);
    bc = hb[1];
    var f = this.rd(0xFE0F);
    if (this.rd(0x8D04) === f || this.rd(0x8D05) === f) {
      bc = (bc+1) & 0xFFFF;                 // $87FD
      this.wr(bc, 0);
    }
  } // edges

  /** ★ `$8801`: B = (HL), C = (HL-1), the surface into (BC), both down. */
  edgePoint(hl, bc, a) {
    var b = this.rd(hl);
    var c = this.rd(hl-1);
    hl = (hl-2) & 0xFFFF;
    this.wr(bc, this.surface(a, (b << 8) | c));
    return [hl, (bc-1) & 0xFFFF];
  } // edgePoint

  /**
   * ★ `$88E2` & co.: the cell beside, `delta` from `$FDF8`.
   */
  side(delta, flag, blocks, hl, reach, bc) {
    if (this.heightCell((this.rd(0xFDF8)+delta) & 0xFF) !== 0) {
      return;
    }
    this.wr(flag, 1);
    this.ww(0x8D04, blocks);
    var e = this.rd(reach);
    // ★ $8811
    var hb = this.sidePoint(hl, bc, 8);
    hl = hb[0]; bc = hb[1];
    var f = this.rd(0xFE0F);
    if (this.rd(0x8D04) === f || this.rd(0x8D05) === f) {
      this.wr((bc-1) & 0xFFFF, 0);          // $882B
    }
    if (!(e & 2)) {
      return;
    }
    hb = this.sidePoint(hl, bc, 4);
    hl = hb[0]; bc = hb[1];
    if (!(e & 4)) {
      return;
    }
    this.sidePoint(hl, bc, 1);
  } // side

  /** ★ `$8842`: C = (HL), B = (HL+1), the surface into (BC), both up. */
  sidePoint(hl, bc, a) {
    var c = this.rd(hl);
    var b = this.rd(hl+1);
    hl = (hl+2) & 0xFFFF;
    this.wr(bc, this.surface(a, (b << 8) | c));
    return [hl, (bc+1) & 0xFFFF];
  } // sidePoint

  /** ★ `$896C` & co.: the cell on a diagonal. */
  corner(delta, flag, table, out) {
    if (this.heightCell((this.rd(0xFDF8)+delta) & 0xFF) !== 0) {
      return;
    }
    this.wr(flag, 1);
    this.wr(out, this.surface(8, this.rw(table)));
  } // corner

  /**
   * ★ `$8560`: the ball's new height `$FE04` from the highest surface around
   * `$FE27`: up a step of at most `$FE05` + 1 at once; falling, `$FE05`
   * grows; a landing after a long fall stuns it (`$FE30` 3, 4, 5 or 2).
   */
  height() {
    var b = this.rd(0xFE04);
    this.wr(0xFDEA, b);
    this.wr(0x85AE, this.rd(0xFE05));
    var a = this.rd(0xFE27);
    if (a < b) {                            // $85C4: falling
      var c = (this.rd(0xFE05)+1) & 0xFF;
      this.wr(0xFE05, c);
      b = (b-c) & 0xFF;
      a = this.rd(0xFE27);
    }
    if (a < b) {                            // $85AF
      if (0xC8 >= b) {
        this.wr(0xFE04, b);
        this.wr(0xFE03, 1);
        return;
      }
    }
    this.wr(0xFE04, a);                     // $8578
    a = this.rd(0xFE05);
    if (a & 0x80) {
      return;
    }
    b = a;
    if (this.rd(0xFE03) !== 0) {            // $8553
      this.sound((this.rd(0xFE05)-3) & 0xFF);
    }
    this.wr(0xFE05, 4);
    this.wr(0xFE03, 0);
    this.wr(0xFE30, 0);
    if (b < 7) {
      return;
    }
    this.wr(0xFE30, 3);
    if (b < 8) {
      return;
    }
    this.wr(0xFE30, 4);
    if (b < 9) {
      return;
    }
    this.wr(0xFE30, 5);
    if (b < 0x0A) {
      return;
    }
    this.wr(0xFE30, 2);
  } // height

  /**
   * ★ `$8D6F`: the sound of a bump by its strength; a hard one stuns
   * (`$8B74`: `$FE30` = 3).
   */
  sound(a) {
    if (a === 0xFF || a < 2) {
      return;
    }
    var s;
    if (a >= 0xFD || a < 4) {
      s = 7;                                // $8B6F
    } else if (a < 6 || a >= 0xFB) {
      s = 8;                                // $8D89
    } else {
      this.wr(0xFE30, 3);                   // $8B74
      s = 9;
    }
    this.soundRequest(0xF061, s, 'ball');
  } // sound

  // --- walls and slopes -------------------------------------------------------

  /**
   * ★ `$8BD1`: the edges `$CA36`-`$CA41` against the old and the new height
   * — which of the four sides are walls (`$FE19`-`$FE1C`), and the corners.
   */
  walls() {
    var hl = 0xCA36;
    [0xFE19, 0xFE1A, 0xFE1B, 0xFE1C].forEach((at) => {
      var d = 0;                            // $8C3B
      if (((this.rd(0xFDEA)-1) & 0xFF) < this.rd(hl)) {
        d |= 1;
      }
      var a = (this.rd(0xFE04)-1) & 0xFF;
      if (a < this.rd(hl+1)) {
        d |= 2;
      }
      if (a < this.rd(hl+2)) {
        d |= 4;
      }
      hl += 3;
      this.wr(at, d);
    });
    var dd = (this.rd(0xFE04)-1) & 0xFF;
    var corners = [[0xFE23, 0xFE19, 0xFE1B], [0xFE24, 0xFE1C, 0xFE1A],
                   [0xFE25, 0xFE1B, 0xFE1A], [0xFE26, 0xFE1C, 0xFE19]];
    for (var i = 0; i < 4; i++) {
      if (this.rd(corners[i][0]) !== 0) {
        if (dd >= this.rd(hl)) {
          return;
        }
        this.wr(corners[i][1], 1);
        this.wr(corners[i][2], 1);
        return;
      }
      hl++;
    }
  } // walls

  /**
   * ★ `$8CC5`: the walls into `$FE16` (x) and `$FE17` (y), and by them the
   * slopes or the bounce of each axis.
   */
  slopes() {
    this.wr(0xFE16, this.pack(this.rd(0xFE1A), this.rd(0xFE19)));
    this.wr(0xFE17, this.pack(this.rd(0xFE1C), this.rd(0xFE1B)));
    if ((this.rd(0xFE17) | this.rd(0xFE16)) === 0) {
      this.flatBlock();                     // $8D26
    }
    var a = this.rd(0xFE17) & 0x21;
    if (a !== 0x21) {
      this.axisY(a);                        // $8B41
    }
    a = this.rd(0xFE16) & 0x21;
    if (a === 0x21) {
      return;
    }
    this.axisX(a);                          // $8B13
  } // slopes

  /** ★ `$8AA0`: A | the three low bits of B reversed, × 8. */
  pack(a, b) {
    var r = ((b & 1) << 2) | (b & 2) | ((b >> 2) & 1);
    return ((r << 3) | a) & 0xFF;
  } // pack

  /** ★ `$8D26`: on blocks 7, $16, $19, $1C, $1E the walls of `$8D5E`. */
  flatBlock() {
    var bc;
    switch (this.rd(0x8D5E)) {
      case 0x07: case 0x16: bc = 0x0404; break;
      case 0x19: bc = 0x0808; break;
      case 0x1C: bc = 0x0408; break;
      case 0x1E: bc = 0x0804; break;
      default: return;
    }
    this.wr(0xFE17, this.rd(0xFE17) | (bc & 0xFF));
    this.wr(0xFE16, this.rd(0xFE16) | (bc >> 8));
  } // flatBlock

  /**
   * ★ `$8B41`: the y axis — a wall (`a` = 1 or $20) bounces the ball back,
   * else the slope `$FE29` follows the surface (`$8A15`).
   */
  axisY(a) {
    if (a === 0) {
      this.slope(0xFE17, 0xFE29);           // $8A15
      return;
    }
    var v = this.bounce(a, this.rd(0xFE2B), 0xFDF3);
    if (v >= 0x78) {
      v = (v+1) & 0xFF;
    }
    this.wr(0xFDFA, v);
    this.wr(0xFDF3, this.quarter(v)+this.rd(0xFDF3));   // $8D11
    this.wr(0xFE29, 0);
    if (this.rd(0x8D6E) === 0) {
      return;
    }
    this.wr(0xFDFA, 0);
  } // axisY

  /** ★ `$8B13`: the x axis, as `$8B41`. */
  axisX(a) {
    if (a === 0) {
      this.slope(0xFE16, 0xFE28);           // $89E8
      return;
    }
    var v = this.bounce(a, this.rd(0xFE2A), 0xFDF4);
    if (v >= 0x78) {
      v = (v+1) & 0xFF;
    }
    this.wr(0xFDFB, v);
    this.wr(0xFDF4, this.quarter(v)+this.rd(0xFDF4));
    this.wr(0xFE28, 0);
    if (this.rd(0x8D6E) === 0) {
      return;
    }
    this.wr(0xFDFB, 0);
  } // axisX

  /**
   * ★ `$8B7E`: a bounce off a wall: the bump's sound, a step up onto it
   * when it is low, the position back by one, the velocity reversed
   * (`E` rotated two left first) and the frame turned.
   * @returns {number} A.
   */
  bounce(flag, e, hl) {
    var v = e;
    var c = (e >> 7) & 1;                   // RL E, RL E with CY = 0
    e = ((e << 1) & 0xFF);
    var c2 = (e >> 7) & 1;
    e = ((e << 1) & 0xFF) | c;
    void c2;
    this.sound(v);
    var a = this.rd(0xFDEA);
    if (a < this.rd(0xFE04)) {
      var l = this.rd(0x8BD0);
      if (a >= l) {
        this.wr(0xFE04, a);
      } else {
        this.wr(0xFE04, a);
        if (((l-a) & 0xFF) < 6) {
          this.wr(0xFE04, l);
        }
      }
    }
    this.wr(0xFE2D, 5);
    var b;
    if (flag === 0x20) {
      if (e >= 0x78) {
        return e;
      }
      this.wr(hl, this.rd(hl)-1);
      b = 0xFF;
    } else {
      if (e !== 0 && e < 0x78) {
        return e;
      }
      this.wr(hl, this.rd(hl)+1);
      b = 1;
    }
    e = (-e) & 0xFF;                        // $8BC2
    this.wr(0xFE0C, (this.rd(0xFE0C)+b) & 7);
    return e;
  } // bounce

  /**
   * ★ `$89E8`/`$8A15`: the slope of an axis from its walls' pattern
   * (`$8AB0`, table `$CA58`), limited by `$CA49`; back towards 0 without.
   */
  slope(walls, at) {
    var b = this.rd(walls);
    if (b !== 0) {
      var r = this.gradient(b);             // $8AB0: [A, B]
      if (r[0] !== 0) {
        var l = this.rd(0xCA49+r[1]);       // $8A42
        var a = this.limit(this.rd(at), l, r[0]);
        a = this.blocked(a, walls);         // $8D8F
        this.wr(at, a);
        return;
      }
    }
    this.wr(at, this.decay(this.rd(at)));
  } // slope

  /** ★ `$8A95`: one step towards 0. */
  decay(a) {
    if (a >= 0x78) {
      return (a+1) & 0xFF;
    }
    return a === 0 ? 0 : a-1;
  } // decay

  /**
   * ★ `$8AB0`: the lowest wall bit below 5 and the highest of bits 0-5
   * give an index into `$CA58`.
   * @returns {Array} [A, B].
   */
  gradient(a) {
    var c = 0, v = a;                       // $8AC9
    for (var n = 5; n > 0; n--) {
      if (v & 1) {
        break;
      }
      v >>= 1;
      c++;
    }
    var b = 0;                              // $8AD4
    v = (a << 2) & 0xFF;
    for (var k = 6; k > 0; k--) {
      if (v & 0x80) {
        b = k;
        break;
      }
      v = (v << 1) & 0xFF;
    }
    var x = this.sra((b-c) & 0xFF);
    x = (x+((c << 1) & 0xFF)) & 0xFF;
    return [this.rd(0xCA58+x), x];
  } // gradient

  /** ★ `$8A4C`: velocity `a` plus `e` within the limit `l` of `$CA49`. */
  limit(a, l, e) {
    if (a < 0x78) {
      if (a >= 0x0D) {
        return 0x0C;
      }
      l = (l+1) & 0xFF;
      if (a >= l) {
        return this.decay(a);
      }
      a = (a+e) & 0xFF;
      if (l & 0x80) {
        return a;
      }
      if (a < l) {
        return a;
      }
      return (l-1) & 0xFF;
    }
    if (a < 0xF4) {                         // $8A67
      return 0xF4;
    }
    if (a < l) {
      return this.decay(a);
    }
    a = (a+e) & 0xFF;
    if (!(l & 0x80)) {
      return a;
    }
    if (a >= l) {
      return a;
    }
    return l;
  } // limit

  /** ★ `$8D8F`: a pull of ±4 against a wall of `(hl)` is cancelled. */
  blocked(a, hl) {
    if (a === 4) {
      return (this.rd(hl) & 8) ? 0 : a;
    }
    if (a === 0xFC) {
      return (this.rd(hl) & 4) ? 0 : a;
    }
    return a;
  } // blocked

  /**
   * ★ `$85D3`: the frame of the ball's roll `$FDF7` (0-7) and its set
   * `$FE0A` (0, 8, $10, $18) from the direction of the movement.
   */
  frame() {
    var h = this.rd(0xFE2A), l = this.rd(0xFE2B);
    var d;
    if (l === 0) {
      if (h === 0) {
        return;
      }
      d = 0;
    } else if (h === 0) {
      d = 0x10;
    } else if ((h & 0x80) === (l & 0x80)) {
      d = 0x08;
    } else {
      d = 0x18;
    }
    this.wr(0xFE0A, d);
    var add;
    if (d === 0) {
      add = this.rd(0xFE2A);
    } else if (d === 0x10) {
      add = this.rd(0xFE2B);
    } else if (d === 0x18) {
      add = (this.rd(0xFE2A)-this.rd(0xFE2B)) & 0xFF;
    } else {
      add = (this.rd(0xFE2A)+this.rd(0xFE2B)) & 0xFF;
    }
    var a = (this.rd(0xFE0C)+add) & 7;
    this.wr(0xFDF7, a);
    this.wr(0xFE0C, a);
  } // frame

  // --- falls and exits --------------------------------------------------------

  /**
   * ★ `$7E19`: the ball stunned (`$FE50`, counter `$FE51`); when it ends
   * after a fall it is put back where it came into the room and the time
   * pays 200 × 8.
   */
  fall() {
    var b = this.stunCounter(0xFE50);       // $7E1C CALL $7DCC
    if (b < 0) {
      return;
    }
    this.wr(0xFE48, 0);                     // $7E1F
    if (b >= 8 || b < 3) {
      this.ww(0xFE46, this.rw(0xFE52));     // $7E2D
      this.wr(0xFE49, this.rd(0xFE54));
      this.ww(0xFE42, 0);
      this.ww(0xFE44, 0);
      this.timePenalty(0xC8);
    }
    var at = this.rw(0xC990);               // $7E49
    this.wr(at-1, 4);
  } // fall

  /**
   * ★ `$7DCC` with `$7E50`: the stun of the ball at `hl` (state, counter):
   * a stun that begins (`$FE30`) is set up with a counter of `$28`, a
   * running one counts down. When it is over, the state is cleared and
   * returned; otherwise −1 (`$7DDF`: the caller returns at once).
   * @param {number} hl - `$FE50` (Bobby) or `$FE64` (the brother).
   * @returns {number} The state that just ended, or −1.
   */
  stunCounter(hl) {
    if (this.rd(hl) !== 0) {                // $7E68
      this.wr(hl+1, this.rd(hl+1)-1);
    } else {
      var s = this.rd(0xFE30);
      if (s === 0) {
        return -1;
      }
      this.wr(hl, s);
      this.wr(hl+1, 0x28);
      this.ww(0xFE16, 0);
    }
    var b = this.rd(hl);                    // $7DCF
    if (b === 0 || this.rd(hl+1) !== 0) {
      return -1;
    }
    this.wr(hl, 0);
    return b;
  } // stunCounter

  /**
   * ★ `$782B`: an exit under the ball changes the room (`$7856`).
   * @returns {boolean} Whether it did — the pass then goes on at `$760D`.
   */
  exitCheck() {
    var n = this.rd(0xC84B);
    if (n === 0) {
      return false;
    }
    var de = this.rw(0xFE46);
    var d = (de >> 8) & 0x0F, e = de & 0x0F;
    var c = this.rd(0xFE48);
    var hl = 0xC84C;
    for (var i = 0; i < n; i++) {
      if (this.rd(hl) === c) {
        if (this.exitTaken(hl+1, d, e)) {
          this.changeRoom(hl+1);
          return true;
        }
      }
      hl += 4;
    }
    return false;
  } // exitCheck

  /**
   * ★ `$788B`: whether the exit at `hl` (its direction) is taken now.
   * @returns {boolean}
   */
  exitTaken(hl, d, e) {
    if (this.rd(0xFE2D) === 0) {
      return false;
    }
    var b = this.rd(hl) & 3;
    var c = this.rd(0xFE2A);
    var a = this.rd(0xFE2B);
    if (a !== 0) {
      if (a >= 0x78) {
        if (c !== 0) { return false; }
        if (b !== 3) { return false; }
        return e < 5;
      }
      if (c !== 0) { return false; }
      if (b !== 2) { return false; }
      return e < 5;
    }
    if (c === 0) {
      return false;
    }
    if (c >= 0x78) {
      if (b !== 1) { return false; }
      return d < 5;
    }
    if (b !== 0) { return false; }
    return d < 5;
  } // exitTaken

  /**
   * ★ `$7856`: through the exit at `hl` (its second byte) into the next room.
   * The buffer is cleared with the panel and the balls drawn into it, the
   * room built over them, and `$7CD5` makes the main loop copy it onto the
   * screen (`$761A`).
   * @param {number} hl - The exit's second byte (`$C84C` + 4n + 1).
   */
  changeRoom(hl) {
    this.soundRequest(0xF061, 5, 'game');                     // a sound request (M6)
    this.wr(0x7CD5, 5);
    this.clearLists();                      // $785F-$786D
    this.clearBuffer();                     // $7870 CALL $808C
    this.panelIntoBuffer();                 // $7873 CALL $F24E = $F487
    this.sortObjects();                     // $7876 CALL $7F8D
    this.drawObjects();                     // $7879 CALL $7FE4
    this.enterRoom(hl);                     // $787D CALL $78DD
    this.brotherHere();                     // $7880 CALL $F23C = $F323
    this.panelAttributes();                 // $7885 CALL $F24B = $F41F
  } // changeRoom

  /**
   * ★ `$78DD`: the room behind the exit and where the ball comes in, then
   * `JP $7935` — the room is built.
   * @param {number} hl - The exit's second byte.
   */
  enterRoom(hl) {
    var a = this.rd(hl);                    // $7914
    var b = (a & 0xE0) >> 1;
    a = ((a & 0x1C) << 2) & 0xFF;
    this.wr(0xFE46, a);
    this.wr(0xFE52, a);
    this.wr(0xC9A4, 0);
    this.wr(0xFE48, 0);
    for (var i = 0; i < 4; i++) {           // ($FE42) = ($FFDC), ($FE44) = ($FFDE)
      this.wr(0xFE42+i, this.rd(0xFFDC+i));
    }
    this.wr(0xFE47, b);
    this.wr(0xFE53, b);
    this.wr(0xFE4F, this.rd(hl+1));
    a = this.rd(hl+2);
    this.wr(0xFE49, a);
    this.wr(0xFE54, a);
    this.buildRoom();                       // $7911 JP $7935
  } // enterRoom

  /**
   * ★ `$9629`: the room's entities from its stream (`$7CC6`, instead of
   * WorldRenderer's `skipEntities`) — up to three bad Bearings (`$EBB4`),
   * the mechanisms of the first list (`$F104`, records from `$C865`,
   * pointers from `$EB8C`, count `$C864`) and of the second (`$EA2E`,
   * records from `$6127`, pointers from `$60F4`, count `$6126`). What they
   * then do: `entities` (`$8DF0`) and `enemies` (`$7BCF`).
   * @param {number} hl - The stream after the exits.
   * @returns {number} The room's attribute.
   */
  roomEntities(hl) {
    this.wr(0xFE7B, 0);
    this.wr(0xFE99, 0);
    this.wr(0xFEBC, 0);
    this.wr(0xFE8A, 5);
    this.wr(0xFEA8, 5);
    this.wr(0xFECB, 5);
    var slots = [[0xFE7A, 0xFE82, 0xC80A], [0xFE98, 0xFEA0, 0xC81E],
                 [0xFEBB, 0xFEC3, 0xC832]];
    for (var i = 0; i < 3; i++) {           // $963E, $965A, $9676
      var a = this.rd(hl);
      hl = (hl+1) & 0xFFFF;
      if (a === 0) {
        break;
      }
      this.badBearing(a, slots[i]);
    }
    this.wr(0x91F4, this.rd(0xFE63) === this.rd(0xFE4F) ? 0 : 0xFF);   // $9692 CALL $8F5B
    this.ww(0x96DF, 0xEB8C);                // ★ operand of LD ($0000),HL at $96DE
    this.wr(0xC864, 0);
    this.ww(0x9746, 0xC865);
    for (;;) {                              // $96A6
      a = this.rd(hl);
      hl = (hl+1) & 0xFFFF;
      if (a === 0) {
        break;
      }
      this.mechanism(a);                    // $96C6
    }
    this.ww(0x97C2, 0x60F4);                // ★ operand of LD ($0000),HL at $97C1
    this.ww(0xC990, 0xC9A5);
    this.wr(0x6126, 0);
    var de = 0x6127;
    for (;;) {                              // $96BF
      a = this.rd(hl);
      hl = (hl+1) & 0xFFFF;
      if (a === 0) {
        return hl;
      }
      de = this.device(a, de);              // $9781
      this.wr(0x6126, this.rd(0x6126)+1);   // $9807
    }
  } // roomEntities

  /**
   * ★ A bad Bearing `n` of the table `$EBB4` into its slot (`$9748`,
   * `$975A`, `$976B`, `$9775`).
   * @param {number} n - From 1.
   * @param {Array} slot - The three places it goes to.
   */
  badBearing(n, slot) {
    var hl = 0xEBB4;                        // $9748
    for (var k = (n-1) & 0xFF; k > 0; k--) {
      var a = this.rd(hl);
      hl = (hl+6+(((a+1) << 1) & 0xFF)) & 0xFFFF;
    }
    var de = slot[0];                       // $975A
    a = this.rd(hl);
    this.wr(de, a);
    this.wr(0xFDEB, a);
    this.wr(de+1, 2);
    this.wr(de+2, this.rd(hl+1));
    this.wr(de+3, this.rd(hl+2));
    hl += 3;
    de = slot[1];                           // $976B
    this.wr(de, this.rd(hl));
    this.wr(de+1, this.rd(hl+1));
    this.wr(de+3, this.rd(hl+2));
    hl += 3;
    var count = ((this.rd(0xFDEB)+1) << 1) & 0xFF;     // $9775
    if (count === 0) {
      this.unported(0x977E, 'LDIR of 65536 bytes');
    }
    for (var i = 0; i < count; i++) {
      this.wr(slot[2]+i, this.rd(hl+i));
    }
  } // badBearing

  /**
   * ★ `$96C6`: mechanism `n` of the first list (`$F104`, 16 or 18 bytes
   * by its byte 3): its height and block into the map, its record at
   * `($9746)` with its place on the screen (`$81B4`).
   * @param {number} n - From 1.
   */
  mechanism(n) {
    var hl = 0xF104;
    for (var k = (n-1) & 0xFF; k > 0; k--) {
      hl = (hl+3+(this.rd(hl+3) === 0 ? 0x0D : 0x0F)) & 0xFFFF;
    }
    var at = this.rw(0x96DF);
    this.ww(at, hl);
    this.ww(0x96DF, at+2);
    var de = this.rw(0x9746);
    var cell = (0x5EEC+2*this.rd(hl+4)) & 0xFFFF;
    this.wr(cell, this.rd(hl+1));
    this.wr(cell+1, this.rd(hl+2));
    this.wr(0x9743, this.rd(hl+2));
    var place = this.project(0, this.rd(hl+4), 0x9742);  // $9711 CALL $74CF
    this.wr(0x9744, place & 0xFF);
    this.wr(0x9745, place >> 8);
    hl += 3;
    if (this.rd(hl) !== 0) {                // $971B
      this.wr(de++, this.rd(hl++));
      this.wr(de++, this.rd(hl++));
      this.wr(de++, 0);
      this.wr(de++, 0);
    }
    for (var i = 0; i < 9; i++) {           // $9729
      this.wr(de++, this.rd(hl++));
    }
    for (i = 0; i < 4; i++) {
      this.wr(de++, this.rd(0x9742+i));
    }
    this.ww(0x9746, de);
    this.wr(0xC864, this.rd(0xC864)+1);
  } // mechanism

  /**
   * ★ `$9781`: device `n` of the second list (`$EA2E`, the length by the
   * type in bits 0-2) — its record at `de` by type (`$980F` 0 and 2,
   * `$98AA` 1 and 6, `$98D8` 4, `$9972` 5; 3 and 7 are in no room).
   * @param {number} n - From 1.
   * @param {number} de - Where its record goes.
   * @returns {number} Where the next record goes.
   */
  device(n, de) {
    var LENGTH = [7, 8, 7, 9, 4, 5, 8, 4];
    var hl = 0xEA2E;
    for (var k = (n-1) & 0xFF; k > 0; k--) {
      hl = (hl+LENGTH[this.rd(hl) & 7]) & 0xFFFF;
    }
    var at = this.rw(0x97C2);               // $97C1
    this.ww(at, hl);
    this.ww(0x97C2, at+2);
    var a = this.rd(hl);
    this.wr(de, a);
    var type = a & 7;
    hl++;
    var i;
    switch (type) {
      case 1: case 6:                       // $98AA
        de++;
        for (i = 0; i < 7; i++) {
          this.wr(de++, this.rd(hl++));
        }
        return de;
      case 4:                               // $98D8
        de++;
        for (i = 0; i < 3; i++) {
          this.wr(de++, this.rd(hl++));
        }
        return de;
      case 5:                               // $9972: the record stays at de
        this.wr(de, 5);
        this.wr(0xF086, this.rd(hl));
        this.wr(0xF087, this.rd(hl+1));
        this.wr(0xF089, this.rd(hl+2));
        this.wr(0xF081, this.rd(hl+3));
        return de;
      case 3: case 7:                       // $98B3, $97FC
        // ? no room of the 245 has one (tools/matchworld.mjs could not check it)
        this.unported(type === 3 ? 0x98B3 : 0x97FC, 'a device of type '+type);
    }
    // $9871: ($996C), ($996D) = B, C
    var first = this.rd(hl);
    var b = this.rd(hl+1);
    var c = this.rd(hl+2);
    this.wr(0x996C, first);
    this.wr(0x996D, b);
    hl += 3;
    de = this.deviceCell(c, de, b);         // $980F: types 0 and 2
    this.wr(de++, this.rd(hl++));
    this.wr(de++, this.rd(hl++));
    this.wr(de++, first);
    var place = this.project(first, c, de);
    de++;
    var block = this.rd(hl);
    this.wr(de, block);
    this.wr(this.rw(0x987F)+1, block);
    hl++;
    de++;
    this.wr(de++, place & 0xFF);            // $9833
    this.wr(de++, place >> 8);
    this.wr(0x996B, block);
    if (this.rd(0x996D) !== 0) {            // a block into the list of objects
      var list = this.rw(0xC990);
      this.wr(list, this.rd(0xFDEA));
      this.wr(list+1, this.rd(0x996B));
      this.wr(list+2, place & 0xFF);
      this.wr(list+3, place >> 8);
      this.wr(list+4, 1);
      this.ww(0xC990, list+5);
      this.wr(0xC9A4, this.rd(0xC9A4)+1);
    }
    return de;
  } // device

  /**
   * ★ `$9881`: the device's cell of the map into its record (`de` + 1, + 2)
   * and `b` into the cell's height (its block for type 3, not ported).
   * @returns {number} `de` + 3.
   */
  deviceCell(a, de, b) {
    this.wr(0x996C, a);
    var cell = (0x5EEC+2*a) & 0xFFFF;
    this.ww(0x987F, cell);
    this.wr(de+1, cell & 0xFF);
    this.wr(de+2, cell >> 8);
    this.wr(cell, b);
    this.wr(0x996B, b);
    return de+3;
  } // deviceCell

  /**
   * ★ `$81B4`: the place on the screen and the depth of cell `c` at height
   * `b` — `$79A9` and `$7F28` of the room's build, each run up to a `RET`
   * put in for the call (`$79D4`, `$7F58`, both put back). The depth goes
   * to `dest` and `$FDEA`.
   * @returns {number} D (column) << 8 | E (pixel line).
   */
  project(b, c, dest) {
    this.wr(0x7F71, c);                     // $79A9
    this.wr(0x79A1, b);
    if (b === 0xE7) {
      this.unported(0x79B6, 'an empty cell projected');
    }
    var x = c & 7, y = (c >> 3) & 7;
    var e = ((((y+x) << 3) & 0xFF)-b+0x36) & 0xFF;
    var d = ((7-x+y) << 1) & 0xFF;
    c &= 0x3F;                              // $7F28
    var depth = (((((c >> 3)+(c & 7)) << 4) & 0xFF)+this.rd(0x79A1)-7) & 0xFF;
    this.wr(0x7F57, this.rd(0xFDEE) === 0x11 ? 0x10 : 0);
    depth = (depth+this.rd(0x7F57)) & 0xFF;
    this.wr(dest, depth);
    this.wr(0xFDEA, depth);
    return (d << 8) | e;
  } // project

  /** ★ `$F323`: `$EE5E` = the room when a brother's place is in it. */
  brotherHere() {
    this.wr(0xEE5E, 0);
    var b = this.rd(0xEE48);
    if (b === 0) {
      return;
    }
    var hl = 0xEE49;
    var room = this.rd(0xFE4F);
    do {
      hl++;
      if (this.rd(hl) === room) {
        this.wr(0xEE5E, room);
        return;
      }
      hl += 2;
      b = (b-1) & 0xFF;
    } while (b !== 0);
  } // brotherHere

  // --- the panel -----------------------------------------------------------------

  /**
   * ★ `$F41F`: the panel's attributes — the colour of the room's bottom
   * left (`$5A82`) decides the frame's ink (`$F472`) — then `$F480`.
   */
  panelAttributes() {
    var a = this.rd(0x5A82);
    var b = 0x50;
    var ink = 0x72;
    if (a < 0x70 && a >= 0x58) {
      ink = 0x69;
      b = 0x58;
    }
    for (var i = 0; i < 4; i++) {           // $F436
      this.wr(0x5A82+i, ink);
    }
    this.wr(0x5A85, 0x47);
    this.wr(0xFE4E, 5);
    this.wr(0xFE62, 5);
    this.wr(0xFE91, 5);
    this.wr(0xF472, b);                     // ★ operand of LD (HL),n at $F471
    this.nameAttributes();                  // $F463
    var hl = 0x5AB7;
    for (var k = 0; k < 2; k++) {           // $F471 twice
      for (i = 0; i < 9; i++) {
        this.wr(hl+i, this.rd(0xF472));
      }
      hl += 9-1+0x38;
    }
    if (this.rd(0xFDEA) === 0x64) {         // $F480
      this.panelIntoBuffer();
    } else {
      this.panelBalls();                    // $F4A6
    }
  } // panelAttributes

  /** ★ `$F463`: seven attributes `$78` from `$5AD8`. */
  nameAttributes() {
    for (var i = 0; i < 7; i++) {
      this.wr(0x5AD8+i, 0x78);
    }
  } // nameAttributes

  /**
   * ★ `$F487`: the panel into the buffer — the place for the name
   * (`$F582`), the box `ABCD` (`$F739`), then the balls (`$F4A6`).
   */
  panelIntoBuffer() {
    this.panelBlank(0xE0E5);
    this.ww(0xF737, 0xF7BE);
    this.ww(0xF782, 0x0098);                // ★ operand of LD DE,nn at $F781
    this.wr(0xF776, 0);                     // ★ operand of LD A,n at $F775
    this.nameBox();
    this.ww(0xF782, 0x16A8);
    this.panelBalls();                      // $F4A6 (PUSH HL / CALL $F4AF / POP HL)
    return 0x16A8;                          // ★ HL on return: the operand of $F4A0
  } // panelIntoBuffer

  /**
   * ★ `$F4AF`: the five brothers' balls into the list of objects — the
   * ones not home yet in their colour (`$F522`), the ones home `$69`, the
   * ones lost `$6A` (`$FEEF`) — then `$F57C`.
   */
  panelBalls() {
    for (var b = 5; b >= 1; b--) {
      var table = 0xF522+3*b;
      var hl = this.rw(0xC990);
      this.wr(0xF521, 5);
      if (((5-this.rd(0xFE35)) & 0xFF) < b) {
        this.wr(0xF521, 0);
      } else if (this.rd(0xFEEF+b) === 0xFF) {
        this.wr(0xF521, 0xFF);
      }
      this.wr(hl, 5-b);
      var f = this.rd(0xF521);
      this.wr(hl+1, f === 5 ? this.rd(table+1) : f === 0 ? 0x69 : 0x6A);
      this.wr(hl+2, this.rd(table+2)+this.rd(0xF509));    // ★ ADD A,n: 0, $E2 on the end screen
      this.wr(hl+3, this.rd(table+3)+this.rd(0xF50F));    // ★ ADD A,n: 6, $71 on the end screen
      this.wr(hl+4, 0);
      this.ww(0xC990, hl+5);
      this.wr(0xC9A4, this.rd(0xC9A4)+1);
    }
    this.nameAttributes();                  // $F57C CALL $F463
    this.panelBlank(0xE2FE);
  } // panelBalls

  /**
   * ★ `$F582`: 24 lines × 9 bytes of the buffer blank from `hl`; with a
   * brother on the way (`$FE35`) his name (`$FA00`), two objects of type 4
   * (`$F5C7`) and the box (`$F739`).
   * @param {number} hl - In the buffer.
   */
  panelBlank(hl) {
    for (var y = 0; y < 0x18; y++) {
      for (var x = 0; x < 9; x++) {
        this.wr(hl++, 0xFF);
      }
      hl += 0x17;
    }
    var l = this.rd(0xFE35);
    if (l === 0) {
      return;
    }
    this.wr(0xF776, l);
    var name = (0xFA00+8*((l-1) & 0xFF)) & 0xFFFF;
    this.ww(0xF737, name);
    this.text(name, 0x17B0);                // $F5AC CALL $71B8
    var de = this.rw(0xC990);
    for (var i = 0; i < 10; i++) {
      this.wr(de+i, this.rd(0xF5C7+i));
    }
    this.ww(0xC990, de+10);
    this.wr(0xC9A4, this.rd(0xC9A4)+2);
    this.nameBox();                         // $F5C4 JP $F739
  } // panelBlank

  /**
   * ★ `$F739`: a box under the text at `($F737)` — `$21`, `$22`…, `$23` in
   * `$F096`, drawn three lines high (`$F7A7` adds 3 between them, `%`
   * becomes a space) at `($F782)`; the attributes of its ends `($F472)`.
   */
  nameBox() {
    for (var i = 0; i < 10; i++) {
      this.wr(0xF096+i, 0x3F);
    }
    var de = 0xF096;
    var hl = this.rw(0xF737);
    var bc = 0x5AD7;
    while (this.rd(hl) === 0x20) {          // $F74E
      this.wr(de++, 0x20);
      hl++;
      bc++;
    }
    this.wr(de, 0x21);                      // $F759
    this.wr(bc++, this.rd(0xF472));
    for (;;) {                              // $F761
      de++;
      hl++;
      this.wr(de, 0x22);
      if (this.rd(hl) === 0x3F) {
        break;
      }
      bc++;
    }
    this.wr(de, 0x22);                      // $F770
    de++;
    bc++;
    this.wr(de, 0x23);
    if (this.rd(0xF776) !== 0) {
      this.wr(bc, this.rd(0xF472));
    }
    var at = this.rw(0xF782);               // $F77E
    this.text(0xF096, at);
    this.boxLine(0xF096);
    this.text(0xF096, (at+0x10) & 0xFFFF);
    this.boxLine(0xF096);
    this.text(0xF096, (at+0x08) & 0xFFFF);
  } // nameBox

  /** ★ `$F7A7`: the next line of the box: +3, `%` → space, to `?`. */
  boxLine(hl) {
    for (;;) {
      var a = this.rd(hl);
      if (a === 0x3F) {
        return;
      }
      if (a === 0x25) {
        this.wr(hl, 0x20);
      } else if (a !== 0x20) {
        this.wr(hl, a+3);
      }
      hl++;
    }
  } // boxLine

  /**
   * ★ `$72E0`: text at `hl` to `?` into the buffer at `de` (E = pixel line,
   * D = column), each character XOR-ed in (`$7315`).
   * @param {number} hl - The text.
   * @param {number} de - The place, kept in `$735A`.
   */
  text(hl, de) {
    this.ww(0x735A, de);
    for (;;) {
      var a = this.rd(hl);
      if (a === 0x3F) {
        return;
      }
      this.character(a);
      hl = (hl+1) & 0xFFFF;
    }
  } // text

  /**
   * ★ `$7315`: one character of the font `$F70C` (8 bytes each) at
   * `($735A)`, the column moving on; `u` a line up, `a`, `` ` `` and `n`
   * a line down at column `$0C`, `$14`, 0.
   */
  character(a) {
    var pos = this.rw(0x735A);
    var l = pos & 0xFF, h = pos >> 8;
    if (a === 0x75) {
      this.ww(0x735A, (l-8) & 0xFF);
      return;
    }
    var column = {0x61: 0x0C, 0x60: 0x14, 0x6E: 0x00}[a];
    if (column !== undefined) {
      this.ww(0x735A, (column << 8) | ((l+8) & 0xFF));
      return;
    }
    var glyph = 0xF70C+8*a;
    h = (h+1) & 0xFF;
    this.ww(0x735A, (h << 8) | l);
    var at = (0xCDE7+32*l+h) & 0xFFFF;
    for (var i = 0; i < 8; i++) {
      this.wr(at, this.rd(glyph+i) ^ this.rd(at));
      at = (at+0x20) & 0xFFFF;
    }
  } // character

  /** ★ `$7CCB`: the new room onto the screen (`$9387`), a tick of time. */
  newRoomOnScreen() {
    this.wr(0x7CD5, 0);
    this.copyToScreen();
    this.timeTick();
  } // newRoomOnScreen

  /**
   * ★ `$F33F`: a brother's place (`$EE49`, 3 bytes: state, room, cell) in
   * this room, with Bobby on its cell and the state 0: the state and
   * `$6125` go to `$78` (the panel flashes, `$9992`), the sound 4.
   */
  homecoming() {
    if (this.rd(0xEE5E) === 0) {
      return;
    }
    var hl = 0xEE48;
    var b = this.rd(hl);
    hl++;
    do {
      hl++;
      var room = this.rd(hl);
      hl++;
      if (room === this.rd(0xFE4F) && this.rd(hl) === this.rd(0xFE48)) {
        if (this.rd(hl-2) === 0) {          // $F365: found here — the panel flashes
          this.wr(hl-2, 0x78);
          this.wr(0x6125, 0x78);
          this.soundRequest(0xF061, 4, 'brothers');
          return;
        }
      }
      hl++;                                 // $F357
      b = (b-1) & 0xFF;
    } while (b !== 0);
  } // homecoming

  // --- the brother in the room ---------------------------------------------------

  /**
   * ★ `$75B6`-`$760A`: the brother whose room this is (`$FE63`) rolls by the
   * same physics as Bobby, without controls (`$FDEA` = 1; 3 when stunned),
   * from his record `$FE56`; then the sparkle when he was just found, the
   * end of his stun, his way home, his exits and the collision with Bobby.
   * ? No recording of the original reaches a brother's room without
   * entities on the way (M4): checked only by recordings with the brother
   * put into room `$00` (tools/tracephysics.py, `patch`).
   */
  brotherPass() {
    this.wr(0xFE2F, 0x20);
    this.loadBall(0xFE56);                  // $75BE CALL $7650
    this.wr(0xFDEA, this.rd(0xFE64) !== 0 ? 3 : 1);
    this.wr(0xFE36, 0xFF);
    this.wr(0xFDF6, 0xFF);
    this.wr(0xFEB2, this.rd(0xFEB4));
    this.physics();                         // $75E0 CALL $8214
    for (var i = 0; i < 4; i++) {           // ($FFDC) = ($FE56), ($FFDE) = ($FE58)
      this.wr(0xFFDC+i, this.rd(0xFE56+i));
    }
    this.storeBall(0xFE56);                 // $75F6 CALL $7693
    var a = this.rd(0xFE37);
    if (a < 0x19) {
      this.sparkle(a);                      // $75FE CALL C,$7EA1
    }
    this.brotherStun();                     // $7601 CALL $7DE1
    this.brotherHome();                     // $7604 CALL $7E6B
    this.brotherExits();                    // $7607 CALL $79E8
    this.wr(0xFDEA, 0);                     // $760A CALL $7B35
    this.collide();                         // $76D3
  } // brotherPass

  /**
   * ★ `$7EA1`: the sparkle over a brother just found — sprite `$6D` over
   * the ball, `$FE37` counting the frames (hidden, type 4, from `$19`).
   */
  sparkle(a) {
    a = (a+1) & 0xFF;
    this.wr(0xFE37, a);
    var b = ((a & 3) << 1) & 0xFF;
    var hl = this.rw(0xC990);
    this.wr(hl, 0xC8);
    this.wr(hl+1, 0x6D);
    this.wr(hl+2, (this.rd(0xFDE8)+b-0x18) & 0xFF);
    this.wr(hl+3, this.rd(0xFDE9));
    this.wr(hl+4, this.rd(0xFE37) < 0x19 ? 0 : 4);
    this.ww(0xC990, hl+5);
    this.wr(0xC9A4, this.rd(0xC9A4)+1);
  } // sparkle

  /**
   * ★ `$7DE1`: the end of the brother's stun (`$FE64`, `$FE65`): after a
   * light one he is only hidden (`$F2E3`); after a heavy one (below 3 or
   * `$0A` and over) he is lost — his ball on the panel `$FF` (`$FEF0`),
   * one brother fewer (`$FE35`), the panel redrawn, the next brother
   * (`$F29D`) or none (`$FE63` = 0).
   */
  brotherStun() {
    var b = this.stunCounter(0xFE64);       // $7DE4 CALL $7DCC
    if (b < 0) {
      return;
    }
    this.wr(0xFE5C, 0);
    if (b < 0x0A && b >= 3) {
      this.hideBrother();                   // $7DF2 JP $F236 = $F2E3
      return;
    }
    this.wr((0xFEF0+((5-this.rd(0xFE35)) & 0xFF)) & 0xFFFF, 0xFF);   // $7DF5
    this.wr(0xFE35, this.rd(0xFE35)-1);
    this.hideBrother();                     // $7E08 CALL $F236
    this.panelIntoBuffer();                 // $7E0B CALL $F24E
    if (this.rd(0xFE35) !== 0) {
      this.nextBrother();                   // $7E12 JP $F233 = $F29D
      return;
    }
    this.wr(0xFE63, 0);
  } // brotherStun

  /**
   * ★ `$F2E3`: the brother's object hidden (type 4): the last one in the
   * list of moving objects, or the last standing one (`$FF78`) moved over
   * into the list.
   */
  hideBrother() {
    if (this.rd(0xFE62) !== 0) {
      this.wr(this.rw(0xC990)-1, 4);
      return;
    }
    var hl = (this.rw(0xFF76)-1) & 0xFFFF;  // $F2F0
    this.wr(hl, 4);
    hl = (hl-4) & 0xFFFF;
    this.ww(0xFF76, hl);
    var de = this.rw(0xC990);
    for (var i = 0; i < 5; i++) {
      this.wr(de+i, this.rd(hl+i));
    }
    this.ww(0xC990, de+5);
    this.wr(0xC9A4, this.rd(0xC9A4)+1);
    this.wr(0xFF78, this.rd(0xFF78)-1);
  } // hideBrother

  /**
   * ★ `$F29D`: the next brother to find — the one of `$FEF0` at `5 − $FE35`
   * (the order the start of the game drew, `$F260`), four bytes of `$EE5F`:
   * his place (`$FE31`-`$FE34`, `$FE5A`, `$FE5B`, `$FE5D`) and room
   * (`$FE63`); his velocities, `$FE5C` and `$FE37` cleared.
   */
  nextBrother() {
    var n = this.rd((0xFEF0+((5-this.rd(0xFE35)) & 0xFF)) & 0xFFFF);
    var hl = (0xEE5F+4*n) & 0xFFFF;
    var a = this.rd(hl);
    this.wr(0xFE31, a);
    this.wr(0xFE5A, a);
    a = this.rd(hl+1);
    this.wr(0xFE32, a);
    this.wr(0xFE5B, a);
    a = this.rd(hl+2);
    this.wr(0xFE33, a);
    this.wr(0xFE5D, a);
    a = this.rd(hl+3);
    this.wr(0xFE34, a);
    this.wr(0xFE63, a);
    this.ww(0xFE56, 0);
    this.ww(0xFE58, 0);
    this.wr(0xFE5C, 0);
    this.wr(0xFE37, 0);
  } // nextBrother

  /**
   * ★ `$7E6B`: the brother brought home (room 0 is home: `$FE63` = 0) and
   * put down (`$FE5C` = 3): hidden, one brother fewer, the sound 1, the
   * panel redrawn, 8 more of time (to `$49`), the next brother.
   *
   * ★ A slip of the original: `$7E99 CP (HL)` means to test `$FE35` (HL
   * from `$7E79`), but `CALL $F24E` in between brings HL back as `$16A8`
   * (`$F4A0`, kept over `$F4AF` by `$F4A9 PUSH HL` / `$F4AD POP HL`) — an
   * address in the ROM, whose byte is `$ED` (data/memory.json `rom`, the
   * one byte of ROM the game reads). So even the last brother home loads
   * "the next" (`$F233`) and `$7E9D` is never reached — physics.md §10,
   * recording `lasthome`.
   */
  brotherHome() {
    if (this.rd(0xFE63) !== 0 || this.rd(0xFE5C) !== 3) {
      return;
    }
    this.wr(this.rw(0xC990)-1, 4);          // $7E76 CALL $7E49
    this.wr(0xFE35, this.rd(0xFE35)-1);
    this.soundRequest(0xF061, 1, 'brothers');
    this.wr(0xFE62, 5);
    var hl = this.panelIntoBuffer();        // $7E87 CALL $F24E
    var a = (this.rd(0xFE66)+8) & 0xFF;
    if (a >= 0x4A) {
      a = 0x49;
    }
    this.wr(0xFE66, a);
    if (this.rd(hl) !== 0) {                // $7E99 CP (HL)
      this.nextBrother();                   // $7E9A JP $F233
      return;
    }
    this.wr(0xFE63, 0);
  } // brotherHome

  /**
   * ★ `$79E8`: an exit under the brother (`$FE5A`, `$FE5C`): he goes into
   * the next room (`$FE63`) with his place from the exit (`$7914`), his
   * velocities as saved at `$FFDC`, a nudge of his place by his velocity,
   * and his object hidden; the sound 5.
   */
  brotherExits() {
    var n = this.rd(0xC84B);
    if (n === 0) {
      return;
    }
    var de = this.rw(0xFE5A);
    var d = (de >> 8) & 0x0F, e = de & 0x0F;
    var c = this.rd(0xFE5C);
    var hl = 0xC84C;
    for (var i = 0; i < n; i++) {
      if (this.rd(hl) === c && this.exitTaken(hl+1, d, e)) {
        hl++;                               // $7A12
        var a = this.rd(hl);
        var b = (a & 0xE0) >> 1;
        this.wr(0xFE5A, ((a & 0x1C) << 2) & 0xFF);
        this.soundRequest(0xF061, 5, 'game');
        this.wr(0xFE5B, b);
        this.ww(0xFE56, this.rw(0xFFDC));
        this.wr(0xFE63, this.rd(hl+1));
        this.wr(0xFE5D, this.rd(hl+2));
        this.ww(0xFE58, this.rw(0xFFDE));
        a = this.rd(0xFE2A);                // $7A39: a nudge by the velocity
        var at = 0xFE5B;
        if (a === 0) {
          a = this.rd(0xFE2B);
          at = 0xFE5A;
        }
        if (a !== 0) {
          var nudge = (((a & 0x80) ? (a >> 4) | 0xF0 : a >> 4) ^ 8) & 0xFF;   // SRA × 4, XOR 8
          this.wr(at, this.rd(at)+nudge);
        }
        this.wr(this.rw(0xC990)-1, 4);      // $7A66 JP $7E49
        return;
      }
      hl += 4;
    }
  } // brotherExits

  /**
   * ★ `$76D3`: Bobby and the brother within 11 of each other on both axes
   * and 15 in height: a push — the balls exchange velocities on the axis
   * they meet on (`$7744`, `$77A1`), the impact sounds and may stun
   * (`$F371`), the brother is set a ball's width away; one over the other
   * (8 and more apart in height, or either in the air) they only swap
   * their lifts (`$7801`). The table `$C993` gives the push by distance.
   */
  collide() {
    var l = this.rd(0xFE46), h = this.rd(0xFE47);
    var e = this.rd(0xFE5A), d = this.rd(0xFE5B);
    var a = (h-d) & 0xFF;
    if (a & 0x80) {
      a = (-a) & 0xFF;
    }
    h = a;
    if (a >= 0x0B) {
      return;
    }
    a = (e-l) & 0xFF;
    if (a & 0x80) {
      a = (-a) & 0xFF;
    }
    l = a;
    if (a >= 0x0B) {
      return;
    }
    a = Math.min(this.rd(0xC993+l), this.rd(0xC993+h));   // $76F0
    this.wr(0x782A, a);
    var b = this.rd(0xFE49), c = this.rd(0xFE5D);
    a = (c-b) & 0xFF;
    if (a & 0x80) {
      a = (-a) & 0xFF;
    }
    if (a >= 0x0F) {
      return;
    }
    this.wr(0xFE4E, 5);
    this.wr(0xFE62, 5);
    if (a >= 8 || this.rd(0xFE4A) >= 5 || this.rd(0xFE5E) >= 5) {
      this.swapLifts(b, c);                 // $7801, $77FD
      return;
    }
    if (l < 8) {
      this.push(0xFE42, 0xFE56, 0xFE16, 0xFE47, 0xFE5B, 0);    // $7744
    }
    if (h < 8) {
      this.push(0xFE44, 0xFE58, 0xFE17, 0xFE46, 0xFE5A, 0x10); // $77A1
    }
  } // collide

  /**
   * ★ `$7801`: the balls' lifts (`$FE4A`, `$FE5E`) swapped, `$FE4B` and
   * `$FE5F` cleared, the lower one's height raised by the push (`$782A`).
   */
  swapLifts(b, c) {
    this.wr(0xFE4B, 0);
    this.wr(0xFE5F, 0);
    var lift = this.rd(0xFE4A);
    this.wr(0xFE4A, this.rd(0xFE5E));
    this.wr(0xFE5E, lift);
    var a = this.rd(0x782A);
    if (b < c) {
      this.wr(0xFE5D, a+b);
    } else {
      this.wr(0xFE49, a+c);
    }
  } // swapLifts

  /**
   * ★ `$7744` (y) and `$77A1` (x): the push on one axis. Bobby stunned
   * (`$FDEA` = 1) gives his velocity to the brother (`$7B3C`); else both
   * standing do nothing, a wall on that side (`$FE16`/`$FE17` & `$21`)
   * stops them with the brother a ball away (`$7EF4`/`$7ED5`), otherwise
   * the velocities are exchanged and Bobby's spin turns (`$7EFF`). Then
   * the impact (`$F371`) and the brother set 11 from Bobby, Bobby kept
   * within `$0B`..`$66`.
   * @param {number} mine - Bobby's velocity word; `his` the brother's.
   * @param {number} wall - `$FE16` or `$FE17`.
   * @param {number} pos - Bobby's place on the axis; `hisPos` the brother's.
   * @param {number} axis - `$FE61`: 0 for y, `$10` for x.
   */
  push(mine, his, wall, pos, hisPos, axis) {
    var hl = this.rw(mine), de = this.rw(his);
    if (this.rd(0xFDEA) === 1) {            // $7B3C, $7B42
      this.ww(his, hl);
    } else {
      if ((hl | de) === 0) {
        return;
      }
      if (this.rd(wall) & 0x21) {           // $7EF4, $7ED5
        var side = (this.rd(wall) & 0x21) === 1 ? 0x0B : -0x0B;
        this.wr(pos, this.rd(hisPos)+side);
        this.ww(0xFE44, 0);
        this.ww(0xFE42, 0);
        return;
      }
      this.ww(mine, de);
      this.ww(his, hl);
      this.wr(0xFE60, (this.rd(0xFE60)+((hl >> 8) < 0x78 ? 1 : -1)) & 7);   // $7EFF
      this.wr(0xFE61, axis);
    }
    this.impact(hl, de);                    // $7772, $77CD CALL $F242
    var b = this.rd(pos);
    if (this.rd(hisPos) < b) {              // $7792
      this.wr(hisPos, b-0x0B);
      if (b < 0x0B) {
        this.wr(pos, 0x0B);
      }
    } else {
      this.wr(hisPos, b+0x0B);
      if (b >= 0x67) {
        this.wr(pos, 0x66);
      }
    }
  } // push

  /**
   * ★ `$F371`: the impact of the two balls by the difference of their
   * velocities (the two bytes of each added): from 5 a sound (`$5A` −
   * strength), from `$11` the brother stunned (3, `$28`), from `$19` Bobby
   * too — unless he is stunned already (`$FDEA` = 1), then only the brother.
   */
  impact(hl, de) {
    var a = ((hl >> 8)+(hl & 0xFF)-((de >> 8)+(de & 0xFF))) & 0xFF;
    if (a & 0x80) {
      a = (-a) & 0xFF;
    }
    if (a < 5) {
      return;
    }
    this.soundRequest(0xF061, (0x5A-a) & 0xFF, 'ball');
    if (a < 0x11) {
      return;
    }
    if (this.rd(0xFDEA) !== 1) {
      if (a < 0x19) {
        return;
      }
      this.wr(0xFE50, 3);                   // $F397 CALL $F3A0
      this.wr(0xFE51, 0x28);
    }
    this.wr(0xFE64, 3);                     // $F39D
    this.wr(0xFE65, 0x28);
  } // impact

  // --- the start and the end of a game (M5) ----------------------------------------

  /**
   * ★ `$D969` (the menu's `0`) → `$74CC` → `$74F3` → `$7D87`: a new game.
   * `$FDEA` = `$64` says "a new game" to `$74F3` and to the panel (`$F480`),
   * the four digits of the time are `$49` (9999). Then the start: Bobby's
   * record (velocities `$100C`, place `$30`/0, height `$11`), room 0, five
   * brothers to find, the brothers' places cleared (`$F313`), the buffer
   * cleared, the entities' tables put back to their starting heights
   * (`$9283`, `$9923`), the room built and copied onto the screen, the panel
   * (`$F41F` → whole, `$F487`), the objects drawn, the brothers' order drawn
   * by the generator (`$F260`) and the first brother loaded (`$F29D`).
   * sources/docs/physics.md §12.
   */
  newGame() {
    this.wr(0xFDEA, 0x64);                  // $D969
    for (var i = 0; i < 4; i++) {
      this.wr(0xFE66+i, 0x49);
    }
    this.startGame();                       // $74CC → $74F3
  } // newGame

  /** ★ `$74F3` with `$FDEA` = `$64`: `$750A`, `$7D87`, then the main loop. */
  startGame() {
    this.clearLists();                      // $74F3 CALL $750A
    this.ww(0xFE44, 0);                     // $7D87
    this.ww(0xFE42, 0x100C);
    this.ww(0xFE46, 0x0030);
    this.ww(0xFE52, 0x0030);
    this.wr(0xFE49, 0x11);
    this.wr(0xFE54, 0x11);
    this.wr(0xFE4F, 0);
    this.wr(0xFE35, 5);
    this.clearPlaces();                     // $7DB1 CALL $F239 = $F313
    this.clearBuffer();                     // $7DB4 CALL $808C
    this.resetTables();                     // $7DB7 CALL $8DD2 = $9283
    this.buildRoom();                       // $7DBA CALL $7935
    this.copyToScreen();                    // $7DBD CALL $8DE4 = $9387
    this.panelAttributes();                 // $7DC0 CALL $F24B = $F41F
    this.sortObjects();                     // $7DC3 CALL $7F8D
    this.drawObjects();                     // $7DC6 CALL $7FE4
    this.brotherOrder();                    // $7DC9 JP $F230 = $F260
    this.nextBrother();                     // $F29D
  } // startGame

  /** ★ `$F313`: the state byte of every brother's place (`$EE49`, 3 B) 0. */
  clearPlaces() {
    var n = this.rd(0xEE48);
    var hl = 0xEE49;
    for (var i = 0; i < n; i++) {
      this.wr(hl, 0);
      hl += 3;
    }
  } // clearPlaces

  /**
   * ★ `$9283`: the `$71AB` records of the mechanisms (`$F104`, 16 or 18 B
   * by byte 3) get their starting height (byte 0) as the current one (byte
   * 1); `$9923`: the `$EA2D` devices (`$EA2E`) of types 2 and 3 get byte 1
   * as byte 2. The heights the last game left (`$92A6`) are gone.
   */
  resetTables() {
    var n = this.rd(0x71AB);
    var hl = 0xF104;
    for (var i = 0; i < n; i++) {
      this.wr(hl+1, this.rd(hl));
      hl += this.rd(hl+3) === 0 ? 16 : 18;
    }
    n = this.rd(0xEA2D);                    // $9923
    hl = 0xEA2E;
    var LENGTH = [7, 8, 7, 9, 4, 5, 8, 4];
    for (var k = 0; k < n; k++) {
      var type = this.rd(hl) & 7;
      if (type === 2 || type === 3) {
        this.wr(hl+2, this.rd(hl+1));
      }
      hl += LENGTH[type];
    }
  } // resetTables

  /**
   * ★ `$F260`: the order the brothers are looked for — five draws of the
   * generator over `$EE7F` (H = 1 when 0; L ^= H, rotated right; H += L;
   * the draw is L & 7) into `$FEF0`-`$FEF4` (from `$FF`), a draw already
   * there is drawn again; the operand of `LD B,n` at `$F290` (`$F291`)
   * counts how many places are compared. ★ The only randomness of the game:
   * `$EE7F` is what the last game left there.
   */
  brotherOrder() {
    for (var i = 0; i < 5; i++) {
      this.wr(0xFEF0+i, 0xFF);
    }
    this.wr(0xF291, 0);
    for (var round = 0; round < 5; round++) {
      this.wr(0xF291, this.rd(0xF291)+1);
      var a;
      for (;;) {                            // $F279
        var l = this.rd(0xEE7F), h = this.rd(0xEE80);
        if (h === 0) {
          h = 1;
        }
        a = l ^ h;
        a = ((a >> 1) | ((a & 1) << 7)) & 0xFF;   // RRCA
        l = a;
        h = (a+h) & 0xFF;
        a = l & 7;
        this.wr(0xEE7F, l);
        this.wr(0xEE80, h);
        var b = this.rd(0xF291);
        var again = false;
        for (var k = 0; k < b; k++) {       // $F292
          if (this.rd(0xFEF0+k) === a) {
            again = true;
            break;
          }
        }
        if (!again) {
          break;
        }
      }
      this.wr(0xFEF0+b-1, a);               // $F298
    }
  } // brotherOrder

  /**
   * ★ `$7CE5`: all five brothers found and Bobby on the home cell 3 — the
   * end: `AND THEY ALL LIVED HAPPILY EVER MORE` on paper `$50`, or with a
   * brother lost (`$FF` in `$FEF0`-`$FEF4`) `WELL AT LEAST NOW YOU CAN HAVE
   * DOUBLE HELPINGS` on `$78` (`$7D54`).
   */
  allHome() {
    for (var i = 0; i < 5; i++) {
      if (this.rd(0xFEF0+i) === 0xFF) {
        this.endScreen(0xF7DB, 0x78, 'lost');
        return;
      }
    }
    this.endScreen(0x7D5C, 0x50, 'won');
  } // allHome

  /**
   * ★ `$7D06`: the screen the game ends on — the buffer blank, the text at
   * line `$64`, column `$0B` (`$72E0`), the attributes `$5800`-`$5A76` the
   * paper, the brothers' balls through `$F7C3` (`$F4A6` with the operands
   * `$F509` = `$E2` and `$F50F` = `$71`, put back to 0 and 6), the objects
   * drawn, 401 bytes from `$5A76` zero (over the end of the attributes into
   * `$5B00`-`$5BA6`), the sound 6 and the buffer onto the screen (`$7D3D`). Then the
   * original waits (`$1770` × 256 loops, ≈ 7 s) and shows its screen of
   * controls (`$71AF` → `$71BB`) — in the remake the model's turn (the
   * worker's `outcome`).
   * @param {number} hl - The text.
   * @param {number} a - The attribute.
   * @param {string} outcome - 'won', 'lost' or 'timeout'.
   */
  endScreen(hl, a, outcome) {
    for (var i = 0; i < 0x1800; i++) {
      this.wr(0xCDE7+i, 0xFF);
    }
    this.text(hl, 0x0B64);                  // $7D19 CALL $71B8 = $72E0
    for (i = 0; i < 0x277; i++) {           // $7D1D: (HL) = A, LDIR $0276
      this.wr(0x5800+i, a);
    }
    this.wr(0xF509, 0xE2);                  // $F7C3
    this.wr(0xF50F, 0x71);
    this.panelBalls();                      // $F4A6
    this.wr(0xF509, 0);
    this.wr(0xF50F, 6);
    this.sortObjects();                     // $7D2E CALL $7F8D
    this.drawObjects();                     // $7D31 CALL $7FE4
    for (i = 0; i < 0x191; i++) {           // $7D36: (HL) = 0 at $5A76 (HL after the LDIR), LDIR $0190
      this.wr(0x5A76+i, 0);
    }
    this.soundRequest(0xF061, 6, 'game');                     // $7D3D
    this.copyToScreen();                    // $7D42 CALL $8DE4 = $9387
    this.outcome = outcome;
  } // endScreen

  // --- drawing -----------------------------------------------------------------

  /**
   * ★ `$8DF9`: blocks of the room in front of a moving object (`$C8C8`, bit 7)
   * go into the list again, to be drawn over it (type 2).
   */
  foreground() {
    var count = this.rd(0xC9A4);
    if (count === 0) {
      return;
    }
    this.wr(0x8EBB, count);
    var n = this.rd(0xFF78);
    if (n !== 0) {
      var hl = 0xFF79;
      for (var i = 0; i < n; i++) {
        var e = this.rd(hl+2);
        var d = this.rd(hl+3);
        var type = this.rd(hl+4);
        this.wr(0x8EBC, type);
        if (type === 1 || type === 6) {     // $8E30
          d = (d << 3) & 0xFF;
        }
        if (this.overlaps(e, d)) {          // $8E5A → $8E37
          var de = this.rw(0xC990);
          for (var k = 0; k < 4; k++) {
            this.wr(de++, this.rd(hl+k));
          }
          this.wr(de++, this.rd(0x8EBC));
          this.ww(0xC990, de);
          this.wr(0xC9A4, this.rd(0xC9A4)+1);
        }
        hl += 5;
      }
    }
    var blocks = this.rd(0xC8C8);           // $8EBD
    var at = 0xC8C9;
    for (var j = 0; j < blocks; j++) {
      var be = this.rd(at), bd = this.rd(at+1);
      if (this.overlaps(be, bd)) {          // $8EFA → $8ED9
        var to = this.rw(0xC990);
        for (var m = 0; m < 4; m++) {
          this.wr(to++, this.rd(at+2+m));
        }
        this.wr(to++, 2);
        this.ww(0xC990, to);
        this.wr(0xC9A4, this.rd(0xC9A4)+1);
      }
      at += 6;
    }
  } // foreground

  /**
   * ★ `$8EFA` (and `$8E5A`): whether something at line `e`, column `d` × 8
   * overlaps one of the first `($8EBB)` objects of the list.
   */
  overlaps(e, d) {
    var hl = 0xC9A5;
    var count = this.rd(0x8EBB);
    for (var i = 0; i < count; i++) {
      var c = ((this.rd(hl+2) & 0xF8)-8) & 0xFF;
      var b = this.rd(hl+3);
      var type = this.rd(hl+4);
      hl += 5;
      if (type === 2) {
        continue;
      }
      var w;
      if (type === 0 || type === 4 || type >= 0x80) {   // $8F4F
        b = ((b & 0xF8)-8) & 0xFF;
        w = 0x2828;
      } else if (type === 0x0A) {           // $8EF4
        b = (b-8) & 0xFF;
        w = 0x2038;
      } else {
        b = (b << 3) & 0xFF;
        w = 0x2038;
      }
      var x = (c-e) & 0xFF;
      if (x & 0x80) {
        x = (-x) & 0xFF;
      }
      if (x >= (w & 0xFF)) {
        continue;
      }
      var y = (b-d) & 0xFF;
      if (y & 0x80) {
        y = (-y) & 0xFF;
      }
      if (y < (w >> 8)) {
        return true;
      }
    }
    return false;
  } // overlaps

  /**
   * ★ `$7F81`: the objects sorted by depth (`$7F8D`), the buffer under them
   * saved (`$92D4`), drawn (`$7FE4`), their rectangles onto the screen and
   * the buffer put back (`$91F6`, `$9362`).
   */
  redraw() {
    this.sortObjects();
    this.saveUnder();
    this.drawObjects();
    this.showObjects();
  } // redraw

  /** ★ `$7F8D`: bubble sort of the list by its first byte. */
  sortObjects() {
    var n = this.rd(0xC9A4);
    if (n >= 2) {
      var swapped;
      do {
        this.wr(0x8051, 0);
        swapped = false;
        var hl = 0xC9A5, de = 0xC9AA;
        for (var i = 0; i < n-1; i++) {
          if (this.rd(de) < this.rd(hl)) {
            for (var k = 0; k < 5; k++) {   // through $C99E
              this.wr(0xC99E+k, this.rd(hl+k));
            }
            for (k = 0; k < 5; k++) {
              this.wr(hl+k, this.rd(de+k));
            }
            for (k = 0; k < 5; k++) {
              this.wr(de+k, this.rd(0xC99E+k));
            }
            this.wr(0x8051, 1);
            swapped = true;
          }
          hl += 5;
          de += 5;
        }
      } while (swapped);
    }
    this.ww(0xC990, 0xC9A5);
  } // sortObjects

  /**
   * ★ `$92D4`: the buffer under each object into the list at `$5B0A`
   * (address, width, lines, bytes), the count in `$5B09`.
   */
  saveUnder() {
    var de = 0x5B0A;
    this.wr(0x5B09, 0);
    var n = this.rd(0xC9A4);
    var hl = 0xC9A5;
    for (var i = 0; i < n; i++) {
      var b = this.rd(hl+2);
      var c = this.rd(hl+3);
      var a = this.rd(hl+4) & 0x7F;
      hl += 5;
      if (a === 4 || a === 2) {
        continue;
      }
      if (a === 0x0A) {
        c = ((c-4) & 0xFF) >> 3;
      }
      var at = b << 5;
      var w, lines;
      if (a === 0 || a === 3 || a === 4) {  // $9347
        at = (at+0xCDE7+(c >> 3)) & 0xFFFF;
        lines = 0x10;
        w = (c & 7) === 0 ? 2 : 3;          // a sprite shifted takes 3 bytes
      } else {
        at = (at+0xCDE7+c) & 0xFFFF;
        lines = 0x20;
        w = 4;
      }
      this.wr(de++, at & 0xFF);             // $9327
      this.wr(de++, at >> 8);
      this.wr(de++, w);
      this.wr(de++, lines);
      for (var y = 0; y < lines; y++) {
        for (var x = 0; x < w; x++) {
          this.wr(de++, this.rd(at++));
        }
        at = (at+0x20-w) & 0xFFFF;
      }
      this.wr(0x5B09, this.rd(0x5B09)+1);
    }
  } // saveUnder

  /**
   * ★ `$7FE4`: the objects into the buffer — balls as sprites (`$809D`),
   * blocks as blocks (`$8052`).
   */
  drawObjects() {
    var n = this.rd(0xC9A4);
    var hl = 0xC9A5;
    for (var i = 0; i < n; i++) {
      var a = this.rd(hl+1);
      var e = this.rd(hl+2);
      var d = this.rd(hl+3);
      var type = this.rd(hl+4) & 0x3F;
      this.wr(0xFDEE, a);
      hl += 5;
      if (type === 4 || type === 5) {
        continue;
      }
      if (type === 0x0A) {                  // $801F: a squashed ball
        this.drawBigBall(hl, e, d);
        continue;
      }
      if (type === 0 || type === 3) {       // $803B
        this.wr(0xFE0B, d & 7);
        this.wr(0xFDEB, e);
        this.wr(0xFDEC, d >> 3);
        if (this.rd(0x804B) === 0xCD) {
          this.drawSprite();
        }
        continue;
      }
      this.wr(0xFDEB, e);
      this.wr(0xFDEC, d);
      this.drawBlock();
    }
  } // drawObjects

  /**
   * ★ `$91F6`: the rectangle of each object from the buffer onto the screen
   * (`$9407`), then the buffer put back (`$9362`).
   */
  showObjects() {
    var n = this.rd(0xC9A4);
    if (n !== 0) {
      var hl = 0xC9A5;
      for (var i = 0; i < n; i++) {
        var e = this.rd(hl+2);
        var d = this.rd(hl+3);
        var type = this.rd(hl+4);
        hl += 5;
        if (type === 2 || type === 3 || type === 6) {
          continue;
        }
        var t = type & 0x7F;
        var b;
        if (t === 0 || t === 4) {           // $9244
          b = 5;
          if (type & 0x80) {
            e = (e-8) & 0xFF;
          }
          d = (d-8) & 0xFF;
          var a = d;
          if ((d & 7) === 0) {
            b--;
          }
          if (a >= 0xF0) {
            b -= 2;
            a = (a+8) & 0xFF;
          } else if (a >= 0xE1) {
            b--;
            if (a >= 0xE9) {
              b--;
            }
          }
          d = a >> 3;
          this.wr(0x944F, 5);
        } else {
          if (t === 0x0A) {
            d >>= 3;
          }
          b = 4;
          this.wr(0x944F, 7);
        }
        this.copyRectangle(e, d, b);        // $9407
      }
      this.wr(0xC9A4, 0);
    } else {
      return;
    }
    this.restoreUnder();                    // $9362
  } // showObjects

  /**
   * ★ `$9407`: `($944F)` character rows of `b` bytes from the buffer onto the
   * screen, from line `e` / 8 − 1, column `d` (the operands of `$9454`,
   * `$9459`, `$9461` are set from `b`, as the original does).
   */
  copyRectangle(e, d, b) {
    e >>= 3;
    this.wr(0x9461, (0x20-b) & 0xFF);
    this.wr(0x9459, (-b) & 0xFF);
    this.wr(0x9454, b);
    e = (e-1) & 0xFF;
    var a = e;
    if (a >= 0x78) {
      e = 0;
      this.wr(0x944F, this.rd(0x944F)-1);
      a = 0;
    } else if (a >= 0x13) {
      this.wr(0x944F, (0x18-e) & 0xFF);
    }
    var sh = ((a & 0xF8)+0x40) & 0xFF;
    var sl = ((((a & 7) << 5) & 0xFF)+d) & 0xFF;
    var src = (0xCDE7+((e << 8) | d)) & 0xFFFF;
    var dh = sh, dl = sl;
    var rows = this.rd(0x944F);
    do {
      for (var c = 0; c < 8; c++) {
        var dst = (dh << 8) | dl;
        var count = this.rw(0x9454) || 0x10000;
        for (var x = 0; x < count; x++) {    // LDIR, BC = ($9454)
          this.wr(dst, this.rd(src));
          src = (src+1) & 0xFFFF;
          dst = (dst+1) & 0xFFFF;
        }
        dh = dst >> 8;
        dl = dst & 0xFF;
        var sum = dl+this.rd(0x9459);       // LD A,n / ADD A,E
        dl = sum & 0xFF;
        dh = (dh+(sum > 0xFF ? 1 : 0)) & 0xFF;
        src = (src+this.rw(0x9461)) & 0xFFFF;
      }
      dh = (dh-8) & 0xFF;
      dl = (dl+0x20) & 0xFF;
      if ((dl & 0xE0) === 0) {
        dl &= 0x1F;
        dh = (dh+8) & 0xFF;
      }
      rows = (rows-1) & 0xFF;
    } while (rows !== 0);
  } // copyRectangle

  /** ★ `$9362`: the buffer under the objects back from `$5B0A`. */
  restoreUnder() {
    var n = this.rd(0x5B09);
    var hl = 0x5B0A;
    for (var i = 0; i < n; i++) {
      var de = this.rw(hl);
      var c = this.rd(hl+2);
      var b = this.rd(hl+3);
      hl += 4;
      do {
        for (var x = 0; x < c; x++) {
          this.wr((de+x) & 0xFFFF, this.rd(hl++));
        }
        de = (de+0x20) & 0xFFFF;
        b = (b-1) & 0xFF;
      } while (b !== 0);
    }
  } // restoreUnder

} // BobbyLogic

/**
 * The game's memory at the start of a game: the room data (data/world.json)
 * and the rest of what the game reads (data/memory.json, tools/mkmemory.mjs)
 * over zeros. ? No ROM: nothing the port reaches reads it (only the
 * entities of room $99, which no exit leads to).
 * @param {Object} world - The parsed data/world.json.
 * @param {Object} memory - The parsed data/memory.json.
 * @returns {Uint8Array} 64 KB.
 */
BobbyLogic.composeMemory = function(world, memory) {
  var out = new Uint8Array(65536);
  [world, memory].forEach((data) => {
    Object.keys(data.regions).forEach((name) => {
      var region = data.regions[name];
      out.set(WorldRenderer.decode(region.bytes), region.address);
    });
  });
  return out;
};

/**
 * ★ The keys the controls stand for in the original's KEYBOARD (`$FD0E`,
 * `$FEE7` = 0 at the start): a key of the top row is up (`P`), of the
 * middle row down (`L`), of the bottom row left or right every other one
 * (`Z`, `X`); `Q` is CHEAT and a key of the top row too. [half-row, bit].
 */
BobbyLogic.KEYS = {
  up: [0xDF, 0x01], down: [0xBF, 0x02], left: [0xFE, 0x02], right: [0xFE, 0x04],
  cheat: [0xFB, 0x01]
};

/**
 * ★ What `IN` gives on a port with these controls held: a keyboard port
 * (`$xxFE`) has bit 6 (EAR) 0 and the bits of the keys held in the half-rows
 * chosen 0 — as the recordings have it (`$BF` with nothing held); any other
 * port `$FF`.
 * @param {number} port
 * @param {Object} controls - {up, down, left, right, cheat}.
 * @returns {number}
 */
BobbyLogic.keyboardPort = function(port, controls) {
  if ((port & 0xFF) !== 0xFE) {
    return 0xFF;
  }
  var value = 0xBF;
  var rows = port >> 8;
  Object.keys(BobbyLogic.KEYS).forEach((name) => {
    var key = BobbyLogic.KEYS[name];
    if (controls[name] && (~rows & ~key[0] & 0xFF)) {
      value &= ~key[1];
    }
  });
  return value;
};

if (typeof self !== 'undefined') { self.BobbyLogic = BobbyLogic; }
if (typeof module !== 'undefined' && module.exports) { module.exports = BobbyLogic; }
