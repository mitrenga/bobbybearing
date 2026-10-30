// classic script (importScripts): no import, no export — R-001, R-048.
// begin code

/**
 * The room engine of Bobby Bearing: building a room the way the original
 * does it, routine for routine (sources/docs/world.md).
 *
 * ★ The original draws a room into a **buffer** of its own at `$CDE7`
 * (6144 bytes, 32 bytes a pixel line, top to bottom), never into the video
 * memory: `$808C` fills it with `$FF`, `$7935` reads the room's stream of
 * cells and draws every block (`$8052`, 32 × 32 pixels with a mask) at its
 * isometric place, keeps a **map** of the room at `$5EEC` (64 cells of two
 * bytes: height and block) for the physics, the blocks with bit 7 in a list
 * at `$C8C8`, and the exits with their arrows (`$809D`) at `$C84B`. Then the
 * room's single attribute fills `$5800`, and `$9387` copies the buffer to
 * the screen in twelve rings from the edge inwards.
 *
 * This port keeps the state **at the original's addresses** — a 64 K array
 * `mem` holding the regions of data/world.json — and every routine below
 * reads and writes exactly what its Z80 original does, the self-modified
 * operands (`$7F57`, `$80FD`) included.
 *
 * The room's entities (`$9629`: the bad Bearings, lifts, blocks, magnets,
 * vents …) are the game logic's (bobbyLogic.js, M4). This port only steps
 * over their bytes in the stream to the room's attribute (`skipEntities`),
 * and throws when the entity state of a previous room would have to be put
 * back (`$92A6`; BobbyLogic has both).
 *
 * Checked against the original's own building of all 245 rooms — every
 * byte of RAM it changes, and the screen after `$9387` — by
 * tools/matchworld.mjs. Free of DOM dependencies (R-001).
 */

// ★ addresses (sources/docs/world.md, sources/asm/bobbybearing.skool)
const ROOM = 0xFE4F;          // the room's number
const ROOM_TABLE = 0xEC54;    // 245 words: the room's stream or record
const BUFFER = 0xCDE7;        // the scene, 32 bytes a line, 192 lines
const MAP = 0x5EEC;           // 64 cells × (height, block)
const MAP_CLEAR = 512;        // ★ $7941: B = 0, two bytes a pass
const LIST = 0xC8C8;          // count + 6 bytes for each block with bit 7
const LIST_END = 0x7F6F;      // the next free entry of LIST
const CELL = 0x7F71;          // the cell being drawn
const LAST = 0x7F72;          // the last height read
const HEIGHT = 0x79A1;        // the height being drawn
const LIST_ADD = 0x7F57;      // ★ operand of ADD A,n at $7F56
const RECORD = 0x7922;        // ★ the record of a room $2A and over
const RUN = 0x8150;           // the repeated value of codes $FE and $FC
const EXITS = 0xC84A;         // ★ ($C84A), count ($C84B), 4 bytes an exit
const POS = 0xFDEB;           // E = pixel line, D = character column
const SPRITE = 0xFDEE;        // the block or sprite being drawn
const SHIFT = 0xFE0B;         // pixel shift of a sprite
const SHIFT_OPERAND = 0x80FD; // ★ operand of LD HL,nn at $80FC
const SPRITE_BUF = 0xFF00;    // a sprite of 16 lines × 3 bytes, mask +$40
const BLOCKS = 0x9A00;        // 256 bytes a block: drawing, mask +$80
const SPRITES = 0xBA00;       // 32 bytes a sprite
const FIXED_MASK = 0xC600;    // ★ the mask of sprites $00-$5F, $69, $6A
const ENTITY_COUNT = 0xC864;  // ★ the mechanisms of the room ($9629)
const ENTITY_COUNT_2 = 0x6126;
const ATTRIBUTES = 0x5800;

class WorldRenderer {

  /**
   * @param {Object} world - The parsed data/world.json.
   */
  constructor(world) {
    if (!world || !world.regions) {
      throw new Error('room data missing (data/world.json)');
    }
    this.world = world;
    this.mem = new Uint8Array(65536);
    this.written = null;              // a Set while tools/matchworld.mjs watches
    this.attributeAddress = 0;        // where the last room's attribute lay
    this.reset();
  } // constructor

  /** Puts the room data back into `mem` and clears the rest. */
  reset() {
    this.mem.fill(0);
    Object.keys(this.world.regions).forEach((name) => {
      var region = this.world.regions[name];
      this.mem.set(WorldRenderer.decode(region.bytes), region.address);
    });
  } // reset

  /**
   * The bytes of a data region (base64, as tools/dumpworld.py writes them).
   * @param {string} data - Base64.
   * @returns {Uint8Array}
   */
  static decode(data) {
    var binary = atob(data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } // decode

  // --- memory: 64 K, the video memory at $4000 as on the machine -----------

  rd(address) {
    return this.mem[address & 0xFFFF];
  } // rd

  wr(address, value) {
    address &= 0xFFFF;
    if (address < 0x4000) {
      return;                         // ROM
    }
    this.mem[address] = value & 0xFF;
    if (this.written) {
      this.written.add(address);
    }
  } // wr

  word(address) {
    return this.rd(address) | (this.rd(address+1) << 8);
  } // word

  setWord(address, value) {
    this.wr(address, value & 0xFF);
    this.wr(address+1, (value >> 8) & 0xFF);
  } // setWord

  /** The video memory, 6912 bytes ($4000-$5AFF). */
  screen() {
    return this.mem.subarray(0x4000, 0x5B00);
  } // screen

  /** The scene buffer, 6144 bytes ($CDE7). */
  buffer() {
    return this.mem.subarray(BUFFER, BUFFER+6144);
  } // buffer

  // --- entering a room ------------------------------------------------------

  /**
   * Room `n` the way the original enters it at the start of a game
   * (`$7DB4`-`$7DBD`): the buffer, the room, the screen.
   * @param {number} n - The room ($00-$F4).
   */
  enter(n) {
    this.wr(ROOM, n);
    this.clearBuffer();
    this.buildRoom();
    this.copyToScreen();
  } // enter

  /** ★ `$808C`: the buffer, 96 × 64 bytes of `$FF`. */
  clearBuffer() {
    for (var i = 0; i < 0x60*0x40; i++) {
      this.wr(BUFFER+i, 0xFF);
    }
  } // clearBuffer

  /**
   * ★ `$7935`: builds the room `($FE4F)` from its stream into the buffer,
   * the map, the list of blocks with bit 7 and the exits, and fills the
   * attributes with the room's colour.
   */
  buildRoom() {
    this.keepEntities();              // $7935 CALL $8DD5 = $92A6, $98E1
    this.wr(LIST, 0);
    this.setWord(LIST_END, LIST+1);
    for (var i = 0; i < MAP_CLEAR; i++) {
      this.wr(MAP+i, 0);
    }
    // $794B: the table; a room $2A and over is a record whose first byte is
    // the room it shares the stream with
    var l = this.rd(ROOM);
    var de;
    for (;;) {
      de = this.word(ROOM_TABLE+2*l);
      if (l < 0x2A) {
        break;
      }
      this.setWord(RECORD, de);       // $7924
      l = this.rd(de);
    }
    de = this.mapFill(de);            // $795E CALL $F254 = $F569
    var c = 0;
    var hl = MAP;
    for (;;) {                        // $7966
      var a = this.rd(de);
      if (a < 0xF0) {
        this.wr(hl, a);
        this.wr(LAST, a);
        hl = (hl+1) & 0xFFFF;
        de = (de+1) & 0xFFFF;
        if (a !== 0 && a !== 0xE7) {
          this.wr(hl, this.rd(de) & 0x7F);
          this.drawCell(this.rd(de), a, c);   // $797D CALL $79A2
        }
        hl = (hl+1) & 0xFFFF;
        de = (de+1) & 0xFFFF;
        c = (c+1) & 0xFF;
        continue;
      }
      if (a === 0xFF) {
        this.exits(de);               // $7C4B
        return;
      }
      de = (de+1) & 0xFFFF;
      var count, value;
      if (a === 0xFB) {               // $7CB6: go to cell n
        c = this.rd(de);
        hl = (MAP+2*c) & 0xFFFF;
        de = (de+1) & 0xFFFF;
      } else if (a === 0xFE) {        // $8151: height, block, count
        var b = this.rd(de);
        de = (de+1) & 0xFFFF;
        this.wr(RUN, this.rd(de));
        de = (de+1) & 0xFFFF;
        count = this.rd(de);
        de = (de+1) & 0xFFFF;
        do {
          this.drawCell(this.rd(RUN), b, c);
          hl = this.mapCell(hl);
          c = (c+1) & 0xFF;
          count = (count-1) & 0xFF;
        } while (count !== 0);
      } else if (a === 0xFD) {        // $816D: height, count, blocks
        var height = this.rd(de);
        de = (de+1) & 0xFFFF;
        count = this.rd(de);
        de = (de+1) & 0xFFFF;
        do {
          value = this.rd(de);
          de = (de+1) & 0xFFFF;
          this.drawCell(value, height, c);
          hl = this.mapCell(hl);
          c = (c+1) & 0xFF;
          count = (count-1) & 0xFF;
        } while (count !== 0);
      } else if (a === 0xFC) {        // $8183: block, count, heights
        this.wr(RUN, this.rd(de));
        de = (de+1) & 0xFFFF;
        count = this.rd(de);
        de = (de+1) & 0xFFFF;
        do {
          value = this.rd(de);
          de = (de+1) & 0xFFFF;
          this.drawCell(this.rd(RUN), value, c);
          hl = this.mapCell(hl);
          c = (c+1) & 0xFF;
          count = (count-1) & 0xFF;
        } while (count !== 0);
      }
      // ★ $F0-$FA: the code is passed over
    }
  } // buildRoom

  /**
   * ★ `$92A6`, `$98E1`: the heights the entities of the previous room left
   * in the map go back into their tables. The game logic (bobbyLogic.js)
   * has it; here no room has entities before.
   */
  keepEntities() {
    if (this.rd(ENTITY_COUNT) !== 0 || this.rd(ENTITY_COUNT_2) !== 0) {
      throw new Error('entities of the previous room ($92A6) need BobbyLogic');
    }
  } // keepEntities

  /**
   * ★ `$F569`: passes the stream's first byte and marks every cell of the
   * map empty (`$E7`).
   * @param {number} de - The stream.
   * @returns {number} The stream after the byte.
   */
  mapFill(de) {
    for (var i = 0; i < 0x40; i++) {
      this.wr(MAP+2*i, 0xE7);
    }
    return (de+1) & 0xFFFF;
  } // mapFill

  /**
   * ★ `$819F`: the cell just drawn into the map.
   * @param {number} hl - The map.
   * @returns {number} The next cell of the map.
   */
  mapCell(hl) {
    this.wr(hl, this.rd(HEIGHT));
    this.wr(hl+1, this.rd(SPRITE));
    return (hl+2) & 0xFFFF;
  } // mapCell

  /**
   * ★ `$79A3`: block `a` at height `b` in cell `c` — x = c & 7,
   * y = (c >> 3) & 7: line E = 8(x + y) - b + $36, column D = 2(7 - x + y).
   * A height of `$E7` is an empty cell, nothing is drawn.
   * @param {number} a - The block, bit 7 = into the list at $C8C8.
   * @param {number} b - The height.
   * @param {number} c - The cell.
   */
  drawCell(a, b, c) {
    this.wr(SPRITE, a);
    this.wr(CELL, c);
    var x = c & 7;
    this.wr(HEIGHT, b);
    if (b === 0xE7) {
      return;
    }
    var y = (c >> 3) & 7;
    var e = ((((y+x) << 3) & 0xFF)-b+0x36) & 0xFF;
    var d = ((7-x+y) << 1) & 0xFF;
    this.wr(POS, e);
    this.wr(POS+1, d);
    if (a & 0x80) {
      this.listBlock(a, e, d);        // $79DE CALL NZ,$7F13
    }
    this.drawBlock();                 // $79E1 CALL $8052
  } // drawCell

  /**
   * ★ `$7F13`: a block with bit 7 into the list at `$C8C8`, six bytes:
   * E, D × 8, a depth, the block, E, D.
   * @param {number} b - The block.
   * @param {number} e - Its line.
   * @param {number} d - Its column.
   */
  listBlock(b, e, d) {
    var a = b & 0x7F;
    this.wr(SPRITE, a);
    var hl = this.word(LIST_END);
    this.wr(hl+3, a);
    this.wr(hl+4, e);
    this.wr(hl+5, d);
    var cell = this.rd(CELL) & 0x3F;
    var depth = ((((cell >> 3)+(cell & 7)) << 4) & 0xFF);
    depth = (this.rd(HEIGHT)+depth-7) & 0xFF;
    this.wr(LIST_ADD, 0);
    if (this.rd(SPRITE) === 0x11) {
      this.wr(LIST_ADD, 0x10);
    }
    this.wr(hl+2, depth+this.rd(LIST_ADD));
    this.wr(hl+1, d << 3);
    this.wr(hl, e);
    this.setWord(LIST_END, hl+6);
    this.wr(LIST, this.rd(LIST)+1);
  } // listBlock

  /**
   * ★ `$8052`: block `($FDEE) & $1F` into the buffer at line `($FDEB)`,
   * column `($FDEC)`: 32 lines × 4 bytes, buffer = buffer & ~mask | drawing.
   */
  drawBlock() {
    var de = BLOCKS+((this.rd(SPRITE) & 0x1F) << 8);
    var hl = (BUFFER+(this.rd(POS) << 5)+this.rd(POS+1)) & 0xFFFF;
    for (var line = 0; line < 0x20; line++) {
      for (var i = 0; i < 4; i++) {
        var mask = this.rd(de | 0x80);
        var drawing = this.rd(de);
        this.wr(hl, (~mask & this.rd(hl)) | drawing);
        hl = (hl+1) & 0xFFFF;
        de = (de+1) & 0xFFFF;
      }
      hl = (hl+0x1C) & 0xFFFF;
    }
  } // drawBlock

  /**
   * ★ `$7C4B`: the exits after the `$FF` of the stream (for a room `$2A`-
   * `$5A` in its record): count, then six bytes each — four into `$C84C`
   * (the last but one is the room it leads to), the arrow `$61 + 2(b & 3)`
   * of the second byte at the last two (column × 8 + shift, line).
   * A room `$5B` and over takes the exits' rooms from its record.
   * @param {number} de - The `$FF` of the stream.
   */
  exits(de) {
    var hl = de;
    var room = this.rd(ROOM);
    var out = EXITS+2;
    if (room >= 0x2A && room < 0x5B) {
      hl = this.word(RECORD);
    }
    hl = (hl+1) & 0xFFFF;
    var count = this.rd(hl);
    this.wr(EXITS+1, count);
    hl = (hl+1) & 0xFFFF;
    if (count !== 0) {
      do {
        this.wr(out++, this.rd(hl));
        hl = (hl+1) & 0xFFFF;
        var a = this.rd(hl);
        for (var i = 0; i < 3; i++) {
          this.wr(out++, this.rd(hl));
          hl = (hl+1) & 0xFFFF;
        }
        this.wr(SPRITE, ((a & 3) << 1)+0x61);
        var d = this.rd(hl);
        var e = this.rd(hl+1);
        hl = (hl+2) & 0xFFFF;
        this.wr(SHIFT, d & 7);
        this.wr(POS, e);
        this.wr(POS+1, d >> 3);
        this.drawSprite();
        count = (count-1) & 0xFF;
      } while (count !== 0);
      if (room >= 0x5B) {             // $7CA0
        hl = this.word(RECORD);
        var n = this.rd(EXITS+1);
        out = EXITS+4;
        do {
          hl = (hl+1) & 0xFFFF;
          this.wr(out, this.rd(hl));
          out += 4;
          n = (n-1) & 0xFF;
        } while (n !== 0);
        hl = (hl+1) & 0xFFFF;
      }
    }
    hl = this.roomEntities(hl);       // $7CC6 CALL $8DE7 = $9629 (M4)
    this.attributeAddress = hl;
    this.fillAttributes(this.rd(hl)); // $7CD6
  } // exits

  /**
   * The room's entities in the stream (`$9629`): here only passed over;
   * the game logic (bobbyLogic.js) loads them.
   * @param {number} hl - The stream after the exits.
   * @returns {number} The room's attribute.
   */
  roomEntities(hl) {
    return this.skipEntities(hl);
  } // roomEntities

  /**
   * ? M4: `$9629` reads the room's entities from the stream — up to three
   * bad Bearings (a byte each, 0 ends), then two lists of mechanisms ending
   * with 0 — and sets their state up. Here only the bytes are passed.
   * @param {number} hl - The stream.
   * @returns {number} The room's attribute.
   */
  skipEntities(hl) {
    for (var slot = 0; slot < 3; slot++) {      // $963E, $965A, $9676
      var a = this.rd(hl);
      hl = (hl+1) & 0xFFFF;
      if (a === 0) {
        break;
      }
    }
    for (var list = 0; list < 2; list++) {      // $96A6, $96BF
      while (this.rd(hl) !== 0) {
        hl = (hl+1) & 0xFFFF;
      }
      hl = (hl+1) & 0xFFFF;
    }
    return hl;
  } // skipEntities

  /**
   * ★ `$7CD6`: one attribute for the whole screen.
   * @param {number} a - The attribute.
   */
  fillAttributes(a) {
    for (var i = 0; i < 0x300; i++) {
      this.wr(ATTRIBUTES+i, a);
    }
  } // fillAttributes

  /**
   * ★ `$809D`: sprite `($FDEE)` (32 bytes at `$BA00`, 16 lines × 2 bytes)
   * through `$FF00` — widened to three bytes, shifted `($FE0B)` pixels
   * right — into the buffer at line `($FDEB)`, column `($FDEC)`.
   */
  drawSprite() {
    this.blitSprite((SPRITES+(this.rd(SPRITE) << 5)) & 0xFFFF);
  } // drawSprite

  /**
   * ★ `$80AB`: the sprite at `hl` through `$FF00` into the buffer. The
   * sizes are the operands of the routine (`$80CD`, `$8146`, `$8100`,
   * `$811E`, `$8143`, `$80E0`); the game changes them for the squashed
   * ball (`$F400`) — the defaults are the values they have otherwise.
   * The mask of sprites `$00`-`$5F`, `$69` and `$6A` is `$C600`, of the
   * others the bytes after the drawing.
   * @param {number} hl - The sprite.
   * @param {Object} [p] - {lines, widen, shifted, width, rows, step}.
   * @returns {number} HL after the last line drawn.
   */
  blitSprite(hl, p) {
    p = p || {lines: 0x10, widen: 2, shifted: 0x30, width: 3, rows: 0x10, step: 0x1D};
    hl = this.widen(hl, SPRITE_BUF, p.lines, p.widen);     // $8126
    var a = this.rd(SPRITE);
    if (a === 0x69 || a === 0x6A || a < 0x60) {
      hl = FIXED_MASK;
    }
    this.widen(hl, SPRITE_BUF+0x40, p.lines, p.widen);
    var shift = this.rd(SHIFT);
    if (shift !== 0) {                // $80E9
      if (shift >= 4) {
        this.nibbleShift(SPRITE_BUF, p.shifted);   // $810C
        this.nibbleShift(SPRITE_BUF+0x40, p.shifted);
        shift -= 4;
      }
      if (shift !== 0) {
        this.bitShift(SPRITE_BUF, shift, p.shifted);
        this.bitShift(SPRITE_BUF+0x40, shift, p.shifted);
      }
    }
    hl = (BUFFER+(this.rd(POS) << 5)+this.rd(POS+1)) & 0xFFFF;
    var de = SPRITE_BUF;
    for (var line = 0; line < p.rows; line++) {
      for (var i = 0; i < p.width; i++) {
        var mask = this.rd(de | 0x40);
        var drawing = this.rd(de);
        this.wr(hl, (~mask & this.rd(hl)) | drawing);
        hl = (hl+1) & 0xFFFF;
        de = (de+1) & 0xFFFF;
      }
      hl = (hl+p.step) & 0xFFFF;
    }
    return hl;
  } // blitSprite

  /**
   * ★ `$8141`: `lines` lines of `count` bytes into lines of `count` + 1
   * (the last 0).
   * @param {number} hl - From.
   * @param {number} de - To.
   * @returns {number} HL after.
   */
  widen(hl, de, lines, count) {
    lines = lines === undefined ? 0x10 : lines;
    count = count === undefined ? 2 : count;
    for (var line = 0; line < lines; line++) {
      for (var i = 0; i < count; i++) {
        this.wr(de++, this.rd(hl));
        hl = (hl+1) & 0xFFFF;
      }
      this.wr(de++, 0);
    }
    return hl;
  } // widen

  /**
   * ★ `$811D`: four pixels to the right with RRD over `n` bytes (48), the
   * low nibble of each byte going on into the next.
   * @param {number} hl - $FF00 or $FF40.
   */
  nibbleShift(hl, n) {
    n = n === undefined ? 0x30 : n;
    var a = 0;
    for (var i = 0; i < n; i++) {
      var v = this.rd(hl+i);
      this.wr(hl+i, ((a & 0x0F) << 4) | (v >> 4));
      a = v & 0x0F;
    }
  } // nibbleShift

  /**
   * ★ `$80F8`: `n` pixels to the right, RR over `bytes` bytes (48) per
   * pixel, the carry going on into the next byte (the operand of `$80FC`
   * is HL).
   * @param {number} hl - $FF00 or $FF40.
   * @param {number} n - Pixels, 1-3.
   */
  bitShift(hl, n, bytes) {
    bytes = bytes === undefined ? 0x30 : bytes;
    this.setWord(SHIFT_OPERAND, hl);
    for (; n > 0; n--) {
      var carry = 0;
      for (var i = 0; i < bytes; i++) {
        var v = this.rd(hl+i);
        this.wr(hl+i, (carry << 7) | (v >> 1));
        carry = v & 1;
      }
    }
  } // bitShift

  // --- the buffer onto the screen -------------------------------------------

  /**
   * ★ `$9387`: the buffer onto the screen in twelve rings, each top edge,
   * left edge, bottom edge, right edge, from the border inwards.
   */
  copyToScreen() {
    var d = 0, e = 0, b = 0x17, c = 0x1F;
    for (var ring = 0; ring < 12; ring++) {
      this.copyRow(d, e, c);                          // $93D1
      this.copyColumn(d, e, b);                       // $93EC
      this.copyRow((d+b) & 0xFF, e, c);               // $93E4
      this.copyColumn(d, (e+c) & 0xFF, (b+1) & 0xFF); // $93FE
      d++;
      e++;
      b -= 2;
      c -= 2;
    }
  } // copyToScreen

  /**
   * ★ `$93D3`: `n` character cells to the right from row `d`, column `e`.
   */
  copyRow(d, e, n) {
    do {
      this.copyCell(d, e);
      e = (e+1) & 0xFF;
      n = (n-1) & 0xFF;
    } while (n !== 0);
  } // copyRow

  /**
   * ★ `$93EE`: `n` character cells down from row `d`, column `e`.
   */
  copyColumn(d, e, n) {
    do {
      this.copyCell(d, e);
      d = (d+1) & 0xFF;
      n = (n-1) & 0xFF;
    } while (n !== 0);
  } // copyColumn

  /**
   * ★ `$93A8` + `$93BD`: one character cell, eight lines from the buffer
   * (`$CDE7 + 256d + e`, 32 bytes a line) to the screen.
   */
  copyCell(d, e) {
    var hl = (((d & 0xF8)+0x40) << 8) | ((((d & 7) << 5)+e) & 0xFF);
    var de = (BUFFER+(d << 8)+e) & 0xFFFF;
    for (var line = 0; line < 8; line++) {
      this.wr(hl, this.rd(de));
      hl = (hl+0x100) & 0xFFFF;
      de = (de+0x20) & 0xFFFF;
    }
  } // copyCell

} // WorldRenderer

if (typeof self !== 'undefined') { self.WorldRenderer = WorldRenderer; }
if (typeof module !== 'undefined' && module.exports) { module.exports = WorldRenderer; }
