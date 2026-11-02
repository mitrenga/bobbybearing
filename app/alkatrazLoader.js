// begin code

/**
 * The second stage of the Alkatraz loader, the part of it the screen shows
 * while the tape plays: converted from the original's code at `$F6C9`-`$F911`
 * over its own memory (sources/docs/tape_layout.md, tools/traceloader.py),
 * so that SHOW TAPE LOADING needs no table of what to draw when — only the
 * loader's data (data/loading.json `regions`, 1.3 KB) and the 6714 bytes of
 * the picture as they come off the tape.
 *
 * ★ Three things the stage does, each a method here:
 *
 * - **where the bytes of the picture go** (`generateAddresses`, `$F983`):
 *   70 records of 4 bytes (`$FB1F`) describe runs of cells; up to eight
 *   "walkers" step through them one byte at a time, round robin, each with
 *   its own register frame (`$FACB`, the original switches them with
 *   `LD SP`), and every step appends a screen address to a list that grows
 *   from `$C23D` — the attribute of a cell first, when a walker enters it,
 *   then its bitmap lines. The list ends in static words (`$F6B1`: 0, then
 *   the 10 bytes of variables to `$F6B7`) and in **words the tape itself
 *   brings** as those variables (the program, 39 854 B to `$5B00`, 3 B to
 *   `$F6C3`, 0).
 * - **which byte goes where** (`loadByte`, `$F712`-`$F7A7`): the main loop
 *   pops the list — one address per byte of the picture, then (count,
 *   address) pairs. `DE` counts the bytes left in the current run, `IX` is
 *   the address.
 * - **the running text and the counter** (`step`, `$F7AE`-`$F911`): a state
 *   machine run **once per bit**, between the two edges, in the alternate
 *   register set (EXX) and `AF'`; its states rewrite the operand of
 *   `JP ($F7AF)`. The first state `$F7B1` waits until the bytes left in the
 *   run (`E`) are a multiple of 8 — during the picture every run is one
 *   byte long, so the text starts only after it (byte 6718). Then: a new
 *   character (`$F7FB`: the glyph from `$FDBD` + 8 × code, bit 7 of a code
 *   toggles inverse video by patching `CCF` ↔ `LD A,A` at `$F7F3`), eight
 *   lines of it shifted in a pixel at a time across columns 21-1 of row 23
 *   (`$F7DC`/`$F827`: three steps of seven `RL (HL)` each and one to move
 *   down a line), the next column of the glyph (`$F847`, the mask `A'`
 *   rotates, the text wraps at `$81`), and after each column the counter
 *   (`$F886`/`$F86E`/`$F8B4`: the three glyphs of `$F980`-`$F982` copied
 *   from `$FEE5` to columns 29-31 of row 23, four bytes a step; `$F8D7`:
 *   the count down, low three bits of each digit first, `$4F` on a wrap).
 *
 * Memory is the original's: a 64K array with the loader's regions at their
 * addresses, the screen at `$4000`, the list at `$C23D`. What the picture
 * and the states write into the screen is collected in `dirty` for the
 * entity to repaint. Register names follow the original (`b2` = B' …).
 *
 * The bytes of the tape the remake plays are not the tape's (data/tape.json
 * carries only the header): `tapeBytes` makes them — the picture and the
 * variables real, the rest from a seeded xorshift32, so a load sounds like
 * data and plays the same every time (R-009).
 */
export class AlkatrazLoader {

  /**
   * @param {Object} regions - data/loading.json `regions`: {hexAddress: base64}.
   */
  constructor(regions) {
    this.mem = new Uint8Array(0x10000);
    Object.keys(regions).forEach((key) => {
      var bytes = AlkatrazLoader.base64(regions[key]);
      this.mem.set(bytes, parseInt(key, 16));
    });
    this.dirty = [];
    // ★ ($FB1B), where the list is appended, is $C23D before the generator
    // runs ($F6CA takes SP from it); the regions are the memory after it
    this.mem[0xFB1B] = AlkatrazLoader.LIST & 0xFF;
    this.mem[0xFB1C] = AlkatrazLoader.LIST >> 8;
    // ★ the main loop before the first byte ($F702-$F70B): the two bytes of
    // the check word go to $F6C7; the list is popped from $C23D after them
    this.sp = AlkatrazLoader.LIST;
    this.ix = 0xF6C7;
    this.de = 2;
    this.phase = 0;         // 0 the check word, 1 the picture ($F78D), 2 the runs ($F79F)
    this.done = false;
    // ★ the state machine before the first bit: $F7AE is `JP $F7B1`, $F7F3
    // is `CCF`, the operand of `LD B,n` at $F8CD is 0, A' = $80 ($F6D5),
    // IY = $FC37 ($F6D1); the other alternate registers are whatever the
    // layers left and the first state overwrites them all
    this.state = 0xF7B1;
    this.toggle = 0x3F;
    this.lineB = 0;
    this.a2 = 0x80;
    this.cy2 = 0;
    this.b2 = 0; this.c2 = 0; this.d2 = 0; this.e2 = 0; this.h2 = 0; this.l2 = 0;
    this.iy = 0xFC37;
    this.generateAddresses();
  } // constructor

  // ------------------------------------------------------------- the list

  /**
   * ★ `$F983`: the list of screen addresses from the records at `$FB1F`,
   * appended at ($FB1B). Each record: address (2 B), count and mode
   * (bits 0-5, 6-7), rows × 8 and walkers − 1 (bits 0-4, 5-7). Mode 0/1:
   * columns of cells top-down / bottom-up, moving right / left; mode 2/3:
   * rows of cells leftwards / rightwards, moving up / down. The records of a
   * group (walkers) run together, a byte each in turn, until all are done.
   */
  generateAddresses() {
    var mem = this.mem;
    var ix = 0xFB1F;
    var records = mem[0xFB1D] | (mem[0xFB1E] << 8);
    while (records) {
      var walkers = ((mem[ix+3] >> 5) & 7)+1;
      var frames = [];
      for (var d = walkers; d >= 1; d--) {
        var w = {l: mem[ix], h: mem[ix+1], b: 0, c: 0, d: 0, e: 0, a: 0, mode: 0, iyl: 0};
        var byte2 = mem[ix+2];
        w.e = byte2 & 0x3F;
        w.d = (mem[ix+3] & 0x1F) << 3;
        ix += 4;
        w.mode = (byte2 >> 6) & 3;
        w.b = w.e;
        w.c = w.l;
        if (w.mode < 2) {
          w.iyl = w.d;
          w.b = w.d;
          w.c = w.l;
          w.d = w.h;
        }
        w.a = w.mode+1;
        frames[d] = w;
        records--;
      }
      var alive;
      do {
        alive = 0;
        for (d = walkers; d >= 1; d--) {
          this.walk(frames[d]);
          alive |= frames[d].a;
        }
      } while (alive);
    }
  } // generateAddresses

  /**
   * One step of a walker (`$F9EF`-`$FA3C`): one address, and the attribute
   * when it enters a cell; `a` goes to 0 when the run is over.
   * @param {Object} w - The walker's registers.
   */
  walk(w) {
    if (w.a === 0) {
      return;
    }
    if (w.mode < 2) {
      this.walkAttribute(w);
      this.append((w.h << 8) | w.l);
      this.walkVertical(w);
      w.a = 0xFF;
      w.b = (w.b-1) & 0xFF;
      if (w.b) {
        return;
      }
      w.l = w.c; w.h = w.d;
      this.walkHorizontal(w);
      w.c = w.l; w.d = w.h;
      w.b = w.iyl;
      w.e = (w.e-1) & 0xFF;
      if (w.e) {
        return;
      }
      w.a = 0;
    } else {
      this.walkAttribute(w);
      this.append((w.h << 8) | w.l);
      this.walkHorizontal(w);
      w.a = 0xFF;
      w.b = (w.b-1) & 0xFF;
      if (w.b) {
        return;
      }
      w.b = w.e;
      w.l = w.c;
      this.walkVertical(w);
      w.c = w.l;
      w.d = (w.d-1) & 0xFF;
      if (w.d) {
        return;
      }
      w.a = 0;
    }
  } // walk

  /** `$FA3D`: a cell to the right (modes 0 and 3, even parity) or the left. */
  walkHorizontal(w) {
    w.l = (w.l+(AlkatrazLoader.evenParity(w.mode) ? 1 : -1)) & 0xFF;
  } // walkHorizontal

  /** `$FA58`: a pixel line down (modes 0 and 3) or up, across cell rows and thirds. */
  walkVertical(w) {
    if (AlkatrazLoader.evenParity(w.mode)) {
      w.h = (w.h+1) & 0xFF;                           // $FA47
      if (w.h & 7) {
        return;
      }
      w.l = (w.l+0x20) & 0xFF;
      if ((w.l & 0xE0) === 0) {
        return;
      }
      w.h = (w.h-8) & 0xFF;
    } else {
      w.h = (w.h-1) & 0xFF;                           // $FA5E
      if ((~w.h) & 7) {
        return;
      }
      w.l = (w.l-0x20) & 0xFF;
      if (((~w.l) & 0xE0) === 0) {
        return;
      }
      w.h = (w.h+8) & 0xFF;
    }
  } // walkVertical

  /** `$FA71`: entering a cell (line 0 going down, line 7 going up): its attribute first. */
  walkAttribute(w) {
    var a = AlkatrazLoader.evenParity(w.mode) ? w.h : (~w.h) & 0xFF;
    if (a & 7) {
      return;
    }
    this.append(((((w.h >> 3) & 3) | 0x58) << 8) | w.l);
  } // walkAttribute

  /** `$FA8B`: a word onto the list at ($FB1B). */
  append(address) {
    var mem = this.mem;
    var at = mem[0xFB1B] | (mem[0xFB1C] << 8);
    mem[at] = address & 0xFF;
    mem[at+1] = address >> 8;
    at += 2;
    mem[0xFB1B] = at & 0xFF;
    mem[0xFB1C] = at >> 8;
  } // append

  /** Parity of a byte as the Z80 flag has it: true when the count of ones is even. */
  static evenParity(value) {
    var ones = 0;
    for (var v = value & 0xFF; v; v >>= 1) {
      ones += v & 1;
    }
    return (ones & 1) === 0;
  } // evenParity

  /** The addresses of the picture, as screen offsets, for checking (tools/matchtape.mjs). */
  pictureOffsets() {
    var out = [];
    for (var at = AlkatrazLoader.LIST; ; at += 2) {
      var word = this.mem[at] | (this.mem[at+1] << 8);
      if (word === 0) {
        return out;
      }
      out.push(word-0x4000);
    }
  } // pictureOffsets

  // --------------------------------------------------------- the main loop

  /** `POP` off the list. */
  pop() {
    var word = this.mem[this.sp] | (this.mem[this.sp+1] << 8);
    this.sp += 2;
    return word;
  } // pop

  /**
   * One byte of the second turbo block, number `n` in the block, with the
   * value the loader would have decrypted (`value`; 0 when the remake has
   * none, outside the picture and the variables). ★ As in `$F712`: the state
   * machine steps eight times, once per bit, with `E` the low byte of the
   * bytes left in the run; then the byte is stored at `IX` and the next
   * address or run is popped when the run is over.
   * @param {number} n - The byte's number in the block, from 0.
   * @param {number} value - The byte, decrypted.
   */
  loadByte(n, value) {
    if (this.done) {
      return;
    }
    for (var bit = 0; bit < 8; bit++) {
      this.step(this.de & 0xFF);
    }
    this.finishByte(value);
  } // loadByte

  /**
   * The byte is in (`$F725`-`$F75D`): stored at `IX`, and the next address or
   * run popped when the run is over.
   * @param {number} value - The byte, decrypted.
   */
  finishByte(value) {
    this.store(this.ix, value);
    this.ix = (this.ix+1) & 0xFFFF;
    this.de--;
    if (this.de) {
      return;
    }
    // the run is over: the next one ($F772 after the check word, $F78D in
    // the picture, $F760 / $F79F in the runs)
    if (this.phase === 0) {
      this.phase = 1;
    }
    if (this.phase === 1) {
      var address = this.pop();
      if (address) {
        this.ix = address;
        this.de = 1;
        return;
      }
      this.phase = 2;
    }
    var count = this.pop();
    if (count === 0) {
      this.done = true;
      return;
    }
    this.de = count;
    this.ix = this.pop();
  } // finishByte

  /** A byte into memory; a byte of the screen is noted for the entity. */
  store(address, value) {
    this.mem[address] = value;
    if (address >= 0x4000 && address < 0x5B00) {
      this.dirty.push(address-0x4000);
    }
  } // store

  // ------------------------------------------------------ the state machine

  /**
   * One step of the state machine between the two edges of a bit
   * (`$F7AE`: `JP ($F7AF)`), with `e` the low byte of the bytes left in the
   * current run. Each state ends by handing over to `$F7BE`, the wait for
   * the second edge, which is not modelled; the `LD A,n` before it is the
   * delay of that wait and is left out.
   * @param {number} e - Register E of the main set.
   */
  step(e) {
    var mem = this.mem;
    var a, cy;
    switch (this.state) {

      case 0xF7B1:
        // waits for a run boundary that divides by eight
        if ((e & 7) !== 0) {
          return;
        }
        // falls through to $F7FB

      case 0xF7FB:
        this.setState(0xF7DC);
        this.l2 = mem[this.iy];
        a = this.a2;                               // EX AF,AF': the mask
        this.c2 = a;
        a = ((a & this.l2) >> 1) & 0x40;           // AND L / RRA / AND $40
        this.b2 = a;
        this.toggle ^= this.b2;                    // CCF <-> LD A,A at $F7F3
        this.l2 &= 0x7F;
        this.h2 = 0;
        this.setDE2((((this.h2 << 8) | this.l2) << 3)+0xFDBC);   // the glyph
        this.h2 = 0x50;
        this.a2 = 4;                               // LD A,$04 / EX AF,AF'
        this.cy2 = 0;
        this.nextLine();
        return;

      case 0xF7DC:
        this.b2 = (this.b2-1) & 0xFF;
        if (this.b2) {
          this.shift();                            // $F827
          return;
        }
        this.h2 = (this.h2+1) & 0xFF;
        if ((this.h2 & 7) === 0) {
          this.nextColumn();                       // $F847
          return;
        }
        this.a2 = 0x0E;                            // LD A,$0E / EX AF,AF'
        this.cy2 = 0;
        this.nextLine();
        return;

      case 0xF886:
        this.setState(0xF86E);
        this.e2 = 0xFD;
        this.counterDigit();                       // $F892
        return;

      case 0xF86E:
        this.b2 = (this.b2-1) & 0xFF;
        if (this.b2) {
          this.counterCopy();                      // $F8B4
          return;
        }
        this.e2 = (this.e2+1) & 0xFF;
        if (this.e2 !== 0) {
          this.counterDigit();                     // $F892
          return;
        }
        this.setState(0xF8D7);
        this.setHL2(this.hl2()+1);
        return;

      case 0xF8D7:
        this.countDown();
        return;
    }
  } // step

  /**
   * `$F7ED`: the next byte of the glyph (DE' first incremented) masked by
   * the column mask C'; the pixel goes to CY' (`SUB C / CCF`, or without the
   * CCF in inverse video), the row pointer back to column 21, B' = 4 steps
   * for this line.
   */
  nextLine() {
    this.setDE2(this.de2()+1);
    var a = this.mem[this.de2()];
    this.l2 = 0xF5;
    a &= this.c2;
    var borrow = a < this.c2;
    a = (a-this.c2) & 0xFF;
    var cy = borrow ? 1 : 0;
    if (this.toggle === 0x3F) {                    // CCF
      cy ^= 1;
    }
    this.a2 = a;                                   // EX AF,AF'
    this.cy2 = cy;
    this.b2 = 4;
  } // nextLine

  /**
   * `$F827`: seven cells of the line rotated left through the carry, from
   * HL' down (columns 21-15, 14-8, 7-1 in the three steps of a line), the
   * pixel coming in from CY'; `LD A,(HL)` of the cell after them and the
   * carry out go back to AF'.
   */
  shift() {
    var mem = this.mem;
    var cy = this.cy2;
    for (var i = 0; i < 7; i++) {
      var at = (this.h2 << 8) | this.l2;
      var v = mem[at];
      var out = v >> 7;
      this.store(at, ((v << 1) | cy) & 0xFF);
      cy = out;
      this.l2 = (this.l2-1) & 0xFF;
    }
    this.a2 = mem[(this.h2 << 8) | this.l2];
    this.cy2 = cy;
  } // shift

  /**
   * `$F847`: the column of the glyph is on the screen: the mask rotates
   * right (`RRCA`) into A'; when its bit 0 was set the glyph is done — the
   * next character (IY), or from the start of the text at `$81`. Then the
   * counter (`$F886`).
   */
  nextColumn() {
    this.setState(0xF886);
    var a = this.c2;
    var cy = a & 1;
    a = ((a >> 1) | (cy << 7)) & 0xFF;
    this.a2 = a;                                   // EX AF,AF'
    this.cy2 = cy;
    if (!cy) {
      return;                                      // $F867
    }
    this.iy = (this.iy+1) & 0xFFFF;
    if (this.mem[this.iy] !== 0x81) {
      return;
    }
    this.b2 = (this.b2-1) & 0xFF;
    this.iy = 0xFC37;
  } // nextColumn

  /**
   * `$F892`: the digit E' − $FD of the counter: its glyph at `$FEE5` +
   * ($F980 + digit), C' = bytes to the end of the glyph table (`$50` − offset,
   * the table wraps), B' = 3 steps, DE' = its cell in row 23.
   */
  counterDigit() {
    var mem = this.mem;
    this.d2 = 0x0A;
    var a = (this.e2-0xFD) & 0xFF;
    this.c2 = a;
    this.b2 = 0;
    this.setHL2(0xF980+((this.b2 << 8) | this.c2));
    a = mem[this.hl2()];
    this.setHL2(a+0xFEE5);                         // LD BC,$FEE5 / LD L,A / LD H,0 / ADD HL,BC
    this.c2 = a;
    a = (0x50-a) & 0xFF;
    this.c2 = a;
    this.b2 = 3;
    this.d2 = 0x50;
  } // counterDigit

  /**
   * `$F8B4`: four bytes of the glyph to the screen, a line down each
   * (`INC D`), the glyph table wrapping at its end; B' is kept in the operand
   * of `LD B,n` at `$F8CD` meanwhile.
   */
  counterCopy() {
    var mem = this.mem;
    this.lineB = this.b2;
    this.b2 = 4;
    do {
      this.store((this.d2 << 8) | this.e2, mem[this.hl2()]);
      this.d2 = (this.d2+1) & 0xFF;
      this.setHL2(this.hl2()+1);
      this.c2 = (this.c2-1) & 0xFF;
      if (this.c2 === 0) {
        this.setHL2(0xFEE5);
      }
      this.b2 = (this.b2-1) & 0xFF;
    } while (this.b2);
    this.b2 = this.lineB;
  } // counterCopy

  /**
   * `$F8D7`: the count down: the low three bits of the two low digits
   * (`DEC (HL)` unless they are zero), then the third digit; a digit past
   * zero (sign set) becomes `$4F` and the next one down counts. Back to
   * `$F7B1` for the next column of text.
   */
  countDown() {
    var mem = this.mem;
    this.setHL2(0xF980);
    for (var b = 2; b >= 1; b--) {
      var a = mem[this.hl2()];
      if ((a & 7) === 0) {
        this.e2 = 0x20;
        this.d2 = 0x40;
      } else {
        mem[this.hl2()] = (a-1) & 0xFF;
      }
      this.setHL2(this.hl2()+1);
    }
    this.b2 = 3;
    this.e2 = (this.e2+1) & 0xFF;
    mem[this.hl2()] = (mem[this.hl2()]-1) & 0xFF;
    if ((mem[this.hl2()] & 0x80) === 0) {
      this.setState(0xF7B1);
      return;
    }
    mem[this.hl2()] = 0x4F;
    this.e2 = (this.e2+1) & 0xFF;
    this.setHL2(this.hl2()-1);
    mem[this.hl2()] = (mem[this.hl2()]-1) & 0xFF;
    if ((mem[this.hl2()] & 0x80) === 0) {
      this.setState(0xF7B1);
      return;
    }
    mem[this.hl2()] = 0x4F;
    this.setHL2(this.hl2()-1);
    mem[this.hl2()] = (mem[this.hl2()]-1) & 0xFF;
    this.h2 = 0;
    this.l2 = 0xE0;
    this.setState(0xF7B1);
  } // countDown

  /** `LD HL,state / LD ($F7AF),HL`: the next state, through HL' as the original does. */
  setState(state) {
    this.state = state;
    this.setHL2(state);
  } // setState

  hl2() { return (this.h2 << 8) | this.l2; }
  de2() { return (this.d2 << 8) | this.e2; }
  setHL2(v) { v &= 0xFFFF; this.h2 = v >> 8; this.l2 = v & 0xFF; }
  setDE2(v) { v &= 0xFFFF; this.d2 = v >> 8; this.e2 = v & 0xFF; }

  /** The registers and variables the reference records after a step (tools/matchtape.mjs). */
  snapshot() {
    var mem = this.mem;
    return [this.state, this.a2, this.cy2, (this.b2 << 8) | this.c2, this.de2(), this.hl2(), this.iy,
            this.toggle, this.lineB, [mem[0xF980], mem[0xF981], mem[0xF982]]];
  } // snapshot

  // ------------------------------------------------------------- the bytes

  /**
   * The bytes a block of the tape plays as (audioManager.tapeBlockSound):
   * the header as it is, the picture and the variables of the second turbo
   * block as the loader decrypts them, everything else from a seeded
   * xorshift32 — the sound of data, repeatable, not the program itself.
   * @param {Object} block - A block of data/tape.json.
   * @param {Uint8Array|null} picture - The 6714 bytes of the picture in tape order.
   * @param {Uint8Array|null} vars - The 10 bytes of variables after it.
   * @returns {Uint8Array} `block.length` bytes.
   */
  static tapeBytes(block, picture, vars) {
    var bytes = new Uint8Array(block.length);
    if (block.bytes) {
      bytes.set(AlkatrazLoader.hex(block.bytes).subarray(0, block.length));
      return bytes;
    }
    var seed = (AlkatrazLoader.SEED+block.block) >>> 0;
    for (var i = 0; i < bytes.length; i++) {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      bytes[i] = seed & 0xFF;
    }
    if (block.pictureBytes && picture) {
      bytes.set(picture.subarray(0, block.pictureBytes[1]), block.pictureBytes[0]);
      if (vars) {
        bytes.set(vars, block.pictureBytes[0]+block.pictureBytes[1]);
      }
    }
    return bytes;
  } // tapeBytes

  /**
   * Bytes out of base64, without the DOM (tools run this in Node).
   * @param {string} text
   * @returns {Uint8Array}
   */
  static base64(text) {
    var bin = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } // base64

  /**
   * Bytes out of a hexadecimal string.
   * @param {string} text
   * @returns {Uint8Array}
   */
  static hex(text) {
    var out = new Uint8Array(text.length >> 1);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(text.substring(i*2, i*2+2), 16);
    }
    return out;
  } // hex

  /**
   * A zlib stream in base64 inflated — data/loading.json `picture`; the
   * browser's DecompressionStream, so it is asynchronous.
   * @param {string} text
   * @returns {Promise<Uint8Array>}
   */
  static inflate(text) {
    var packed = AlkatrazLoader.base64(text);
    var stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
  } // inflate

} // AlkatrazLoader

/** ★ where the list of addresses starts ($FB1B before the generator runs) */
AlkatrazLoader.LIST = 0xC23D;
/** the seed of the bytes that only sound (tapeBytes) */
AlkatrazLoader.SEED = 0x1986;

export default AlkatrazLoader;
