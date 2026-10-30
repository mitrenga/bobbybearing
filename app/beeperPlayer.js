// classic script (importScripts): no import, no export — R-001, R-048.
// begin code

/**
 * Bobby Bearing's sound: the interrupt handler `$FB08` → `$FB8C`, carried
 * over to JavaScript **over the game's memory** with the T-states of every
 * instruction, so that the edges on the beeper (bit 4 of port `$FE`) come
 * out where the machine makes them (sources/docs/physics.md §13).
 *
 * ★ The machine has no sound chip: the handler plays two request slots
 * (`$F061`, `$F062`: an effect 1-8, or a pitch from 9 up) into up to eight
 * channels of 10 bytes from `$F063` (the handler only ever plays the first
 * three, `$FB18`), each a count of interrupts, a type and parameters, and
 * then plays the three channels right in the interrupt — `OUT ($FE)` with
 * delay loops (`$FB46`). A long effect runs over the end of the frame and
 * the next interrupt is lost; the main loop waits meanwhile.
 *
 * `interrupt()` is one interrupt: it changes the memory as the handler does
 * and returns the OUTs as [T from the first instruction of `$FB08`, bit 4]
 * and the length up to and with the `RET`. tools/matchsound.mjs checks every
 * path against the original run in a Z80 simulator (tools/tracesound.py),
 * edge for edge.
 *
 * A classic script (no import/export): the worker loads it with
 * importScripts(), the tools with svision/tools/classicScript.cjs. Times are
 * T-states of the 3.5 MHz Z80; the handler lies in uncontended memory.
 */
class BeeperPlayer {

  /**
   * @param {Uint8Array} memory - The game's 64 KB (shared with BobbyLogic).
   */
  constructor(memory) {
    this.mem = memory;
    this.t = 0;
    this.outs = [];
    // the requests this interrupt took out of the slots: [{slot, value}]
    this.taken = [];
  } // constructor

  rd(a) { return this.mem[a & 0xFFFF]; }
  wr(a, v) { if ((a & 0xFFFF) >= 0x4000) { this.mem[a & 0xFFFF] = v & 0xFF; } }

  /**
   * One interrupt: `$FB08`.
   * @returns {{outs: Array, length: number, taken: Array}} The OUTs [T,
   *   bit 4], the length in T up to and with the final RET, and the
   *   requests taken out of the slots ([{slot, value}], M7).
   */
  interrupt() {
    this.t = 0;
    this.outs = [];
    this.taken = [];
    this.t += 4+11+11+11+11+17;             // DI, PUSH AF/BC/DE/HL, CALL $FB8C
    this.player();
    this.t += 10+10+10+10+4+10;             // POP HL/DE/BC/AF, EI, RET
    return {outs: this.outs, length: this.t, taken: this.taken};
  } // interrupt

  /**
   * ★ `$FB8C`: the two request slots, then the three channels (`$FB18`).
   */
  player() {
    this.t += 10+7;                         // LD HL,$F061; LD B,$02
    for (var slot = 0xF061; slot <= 0xF062; slot++) {
      var a = this.rd(slot);
      this.t += 7+4+10;                     // LD A,(HL); AND A; JP Z,$FBC7
      if (a !== 0) {
        this.t += 11+11+10;                 // PUSH BC; PUSH HL; LD (HL),$00
        this.wr(slot, 0);
        this.taken.push({slot: slot, value: a});
        this.request(a);
        this.t += 10+10;                    // $FBC5 POP HL; POP BC
      }
      this.t += 6+(slot === 0xF061 ? 13 : 8);   // $FBC7 INC HL; DJNZ
    }
    this.t += 10;                           // JP $FB18
    this.t += 10+17;                        // LD HL,$F063; CALL $FB27
    this.channel(0xF063);
    this.t += 10+17;                        // LD HL,$F06D; CALL $FB27
    this.channel(0xF06D);
    this.t += 10;                           // LD HL,$F077
    this.channel(0xF077);
  } // player

  /**
   * ★ `$FB9A`-`$FBC2`: the request `a` — effects 1-8 have a table of six
   * bytes each (`$FBF3`, `$FC4D` …), 9 and over are a pitch: 2a into the
   * template `$FC85` (its byte 3, `$FC88`). The six bytes go into the first
   * free channel of eight (`$FBD9`); with none free the request is dropped.
   */
  request(a) {
    var TABLES = {1: 0xFBF3, 2: 0xFC4D, 3: 0xFC53, 4: 0xFC59, 5: 0xFC5F, 6: 0xFC65,
                  7: 0xFC6B, 8: 0xFC70};
    var table;
    if (a <= 8) {
      this.t += 17*a;                       // CP n; JP Z — a times, the last taken
      table = TABLES[a];
    } else {
      this.t += 17*8+10;                    // eight CP/JP, JP $FC75
      this.t += 4+13;                       // ADD A,A; LD ($FC88),A
      this.wr(0xFC88, (a+a) & 0xFF);
      table = 0xFC85;
    }
    this.t += 17;                           // CALL $FBD9
    var channel = this.freeChannel();
    this.t += 10;                           // JP NZ,$FBC5
    if (channel === null) {
      return;
    }
    this.t += 10+10;                        // LD DE,table; JP $FBEA
    this.t += 4+10;                         // EX DE,HL; LD BC,$0006
    for (var i = 0; i < 6; i++) {           // LDIR
      this.wr(channel+i, this.rd(table+i));
      this.t += i < 5 ? 21 : 16;
    }
    this.t += 10;                           // JP $FBC5
  } // request

  /**
   * ★ `$FBD9`: the first of eight channels from `$F063` (10 bytes apart)
   * whose count is 0 — ★ the fourth and on lie over `$F081`, the data of the
   * chasing ball; the handler plays only three.
   * @returns {number|null} The channel, or null with none free.
   */
  freeChannel() {
    this.t += 10+7+10;                      // LD HL,$F063; LD B,$08; LD DE,$000A
    var hl = 0xF063;
    for (var b = 8; b > 0; b--) {
      this.t += 7+4;                        // LD A,(HL); AND A
      if (this.rd(hl) === 0) {
        this.t += 11;                       // RET Z
        return hl;
      }
      this.t += 5+11+(b > 1 ? 13 : 8);      // RET Z not taken; ADD HL,DE; DJNZ
      hl += 10;
    }
    this.t += 7+10;                         // OR $01; RET
    return null;
  } // freeChannel

  /**
   * ★ `$FB27`: one channel — count (byte 0, down by one), type (byte 1),
   * B pulses (byte 2): type 1 a pitch sliding by byte 5 (`$FB80`), 2
   * silence (`$FB8B`), 3 a sweep whose pulse count grows with byte 3
   * (`$FB5C`), 4 a pitch down by byte 4 (`$FB77`), any other the fixed
   * pitch of byte 3; then the pulses (`$FB46`).
   * @param {number} hl - The channel.
   */
  channel(hl) {
    this.t += 7+4;                          // LD A,(HL); AND A
    var count = this.rd(hl);
    if (count === 0) {
      this.t += 11;                         // RET Z
      return;
    }
    this.t += 5+11+6+7+6+7+6;               // RET Z no; DEC (HL); INC HL; LD A,(HL); INC HL; LD B,(HL); INC HL
    this.wr(hl, count-1);
    var type = this.rd(hl+1);
    var b = this.rd(hl+2);
    var c, a;
    if (type === 1) {                       // $FB80
      this.t += 17;                         // CP $01; JP Z
      this.t += 7+6+7+6+7+6+7+4+10;         // LD E,(HL); INC; LD A,(HL); INC; ADD A,(HL); DEC; LD (HL),A; LD A,E; JP $FB79
      var e = this.rd(hl+3);
      a = (this.rd(hl+4)+this.rd(hl+5)) & 0xFF;
      this.wr(hl+4, a);
      a = (e-a) & 0xFF;                     // $FB79 SUB (HL)
      this.t += 7+6+7+4+10+6;               // SUB (HL); DEC HL; LD (HL),A; LD C,A; JP $FB45; INC HL
      this.wr(hl+3, a);
      c = a;
    } else if (type === 2) {                // $FB8B
      this.t += 17+17+10;                   // CP 1, CP 2 taken, RET
      return;
    } else if (type === 3) {                // $FB5C
      this.t += 17*3;
      this.t += 6+7+7+10;                   // DEC HL; LD A,(HL); CP $01; JP Z,$FB46
      a = this.rd(hl+2);
      if (a === 1) {
        // ? C would be the register the main loop left: no effect of the
        // game has a pulse count of 1 here (tools/tracesound.py)
        throw new Error('unported $FB60: a sweep with one pulse');
      }
      this.t += 6+7+7+7+24+4+6+7+6+7+7+4+10;   // INC; ADD A,(HL); LD (HL),A; LD B,(HL); SRL B ×3; INC B; INC; LD A,(HL); INC; ADD A,(HL); LD (HL),A; LD C,A; JP $FB46
      a = (a+this.rd(hl+3)) & 0xFF;
      this.wr(hl+3, a);
      b = ((a >> 3)+1) & 0xFF;
      a = (this.rd(hl+4)+this.rd(hl+5)) & 0xFF;
      this.wr(hl+5, a);
      c = a;
    } else if (type === 4) {                // $FB77
      this.t += 17*4;
      this.t += 7+6+7+6+7+4+10+6;           // LD A,(HL); INC; SUB (HL); DEC; LD (HL),A; LD C,A; JP $FB45; INC HL
      a = (this.rd(hl+3)-this.rd(hl+4)) & 0xFF;
      this.wr(hl+3, a);
      c = a;
    } else {                                // $FB44
      this.t += 17*4;                       // four CP/JP, none taken
      this.t += 7+6;                        // LD C,(HL); INC HL
      c = this.rd(hl+3);
    }
    this.pulses(b, c);
    this.t += 10;                           // RET
  } // channel

  /**
   * ★ `$FB46`: `b` pulses (0 = 256) of two half-waves of `c` loops (0 = 256)
   * of `DEC C / JP NZ` (14 T): low, then high (`$10`).
   */
  pulses(b, c) {
    var loops = c === 0 ? 256 : c;
    do {
      this.t += 11+4;                       // PUSH BC; XOR A
      this.outs.push([this.t, 0]);
      this.t += 11+14*loops;                // OUT; the loop
      this.t += 7;                          // LD A,$10
      this.outs.push([this.t, 1]);
      this.t += 11+10+11+14*loops+10;       // OUT; POP BC; PUSH BC; the loop; POP BC
      b = (b-1) & 0xFF;
      this.t += b !== 0 ? 13 : 8;           // DJNZ
    } while (b !== 0);
  } // pulses

} // BeeperPlayer

/**
 * ★ T-states of a frame of the 48K: the interrupt comes every 69 888 T, and
 * a handler longer than that loses the next one (`DI` holds).
 */
BeeperPlayer.FRAME = 69888;
BeeperPlayer.CLOCK = 3500000;

/**
 * The OUTs of one or more interrupts as svision pulse data: pulse lengths in
 * samples (`fragments`) and the sequence of them (`pulses`), from the first
 * edge; a `fill` (T) at the end pads to a length.
 * @param {Array} outs - [[T, bit], …] with T from one start.
 * @param {number} sampleRate
 * @param {number} [fill] - Pad with silence to this T.
 * @returns {{fragments: Array, pulses: Uint16Array}}
 */
BeeperPlayer.pulses = function(outs, sampleRate, fill) {
  var k = sampleRate/BeeperPlayer.CLOCK;
  var level = 1;                            // bit 4 high is silence between pulses
  var last = 0;
  var lengths = [];
  for (var i = 0; i < outs.length; i++) {
    if (outs[i][1] === level) {
      continue;
    }
    level = outs[i][1];
    var at = Math.round(outs[i][0]*k);
    lengths.push(at-last);
    last = at;
  }
  if (fill !== undefined) {
    lengths.push(Math.max(0, Math.round(fill*k)-last));
    if (lengths.length % 2) {
      lengths.push(0);
    }
  }
  var fragments = [], keys = {};
  var pulses = new Uint16Array(lengths.length);
  for (var j = 0; j < lengths.length; j++) {
    var len = lengths[j];
    if (!(len in keys)) {
      keys[len] = fragments.length;
      fragments.push(len);
    }
    pulses[j] = keys[len];
  }
  return {fragments: fragments, pulses: pulses};
};

if (typeof self !== 'undefined') { self.BeeperPlayer = BeeperPlayer; }
if (typeof module !== 'undefined' && module.exports) { module.exports = BeeperPlayer; }
