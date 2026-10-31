const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ZXVideoRAM } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAM.js?ver='+window.srcVersion);
// begin code

/**
 * Builds the Bobby Bearing screen — all 6912 bytes of it — out of what the
 * original drew.
 *
 * What the machine is (the video memory, the ULA's interleaved addressing,
 * turning bytes plus attributes into pixels) is svision's ZXVideoRAM
 * (R-003). What is left here is the game's own drawing.
 *
 * ★ **The opening screen is the program's, not a photograph.** It is what the
 * original's `$D9D8` makes of the packed picture at `$DA30`
 * (data/screen.json `title`, the program's own bytes): a run of zeros
 * (a 16-bit count), then a run of literal bytes (an 8-bit count and the
 * bytes), again and again, from `$4000` until the address reaches `$5B00`.
 * `unpack` is that routine. tools/matchscreen.mjs checks it against the
 * screen of the simulator right after `CALL $D9D8` ($D6BA).
 *
 * ? The ball turning in the „O“ and the control selector under the logo are
 * the menu loop's ($D6D0, `$D777`, `$D80A`, `$D7A1`), not in the picture —
 * not animated yet.
 *
 * ★ **The game screen is the worker's**: the rooms are built out of the
 * program's data by the original's room engine (app/worldRenderer.js in the
 * worker, M2). Until its first frame arrives the screen is black.
 *
 * Free of DOM dependencies, so the offline tools render with this very code
 * (R-001).
 */
export class ScreenComposer {

  /**
   * @param {Object} scene - The parsed data/screen.json.
   */
  constructor(scene) {
    if (!scene || !scene.title) {
      throw new Error('game data missing (data/screen.json)');
    }
    // the packed picture as the program holds it (base64 → bytes)
    this.title = ScreenComposer.unpack(ScreenComposer.fromBase64(scene.title.bytes));
    // before the worker's first frame: black, nothing drawn
    this.blank = new Uint8Array(6912);
    // the last screen the worker sent: a frame without one keeps it
    this.game = null;
    // ★ the ball in the „O" of the menu (menuStart), when the data has it
    this.scene = scene;
  } // constructor

  /**
   * @param {string} text - Base64.
   * @returns {Uint8Array}
   */
  static fromBase64(text) {
    var bin = (typeof atob === 'function') ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } // fromBase64

  /**
   * ★ `$D9D8`: unpacks the opening screen into 6912 bytes from `$4000`.
   * `LD C,(HL) / INC HL / LD B,(HL)` — a 16-bit count of zeros, each followed
   * by the test `$D9F9` (the screen is full when D reaches `$5B`); then
   * `INC HL / LD B,(HL)` — a count of literal bytes, copied as they are.
   * @param {Uint8Array} packed - The program's bytes from `$DA30`.
   * @returns {Uint8Array} The 6912 bytes of the screen.
   */
  static unpack(packed) {
    var screen = new Uint8Array(6912);
    var hl = 0, de = 0;
    for (;;) {
      var count = packed[hl] | (packed[hl+1] << 8);
      hl++;
      // ★ `$D9E1`: XOR A / LD (DE),A / INC DE / CALL $D9F9 / DEC BC / ... —
      // the test comes after every zero, so the loop ends in the middle
      // of a run as soon as the screen is full
      do {
        screen[de++] = 0;
        if (de >= 6912) {
          return screen;
        }
        count = (count-1) & 0xFFFF;
      } while (count);
      hl++;
      var literals = packed[hl++];
      // ★ `$D9F0`: DJNZ — a count of 0 copies 256 bytes
      do {
        screen[de++] = packed[hl++];
        literals = (literals-1) & 0xFF;
      } while (literals && de < 6912);
      if (de >= 6912) {
        return screen;
      }
    }
  } // unpack

  /**
   * ★ The ball in the „O" of the menu (`$D8F5`, `$D90A`): the state the
   * menu loop starts from, right after `CALL $D8F5` (tools/mkscreen.py
   * `menu`) — the buffer of 4 × 64 bytes at `$DA30` (what is left of the
   * unpacked picture, the ball XORed into it), the two frames of the ball
   * (`$CDFB`, `$CDFF`: 4 × 25 bytes), its row and speed (`$D940`, `$D93F` — `LD BC,($D93F)`: B the row, C the speed),
   * the frame in use (`$D967`) and the loop counter (`$DA0C`).
   * @returns {Object|null} The state for menuLoop, or null without the data.
   */
  menuStart() {
    var menu = this.scene.menu;
    if (!menu || !menu.buffer || !menu.sprites) {
      return null;
    }
    var sprites = {};
    Object.keys(menu.sprites).forEach((key) => { sprites[key] = ScreenComposer.fromBase64(menu.sprites[key]); });
    return {buffer: ScreenComposer.fromBase64(menu.buffer), sprites: sprites,
            pos: menu.pos, vel: menu.vel, sprite: menu.sprite, toggle: menu.toggle};
  } // menuStart

  /**
   * ★ One turn of the menu loop `$D6D0` without a key: `$DA0C` goes up and
   * on every odd turn the ball bounces (`$D90A`) and the buffer goes onto
   * the screen (`$D9B6`). The selector of the controls (`$D80A`) does not
   * move without a key and the attributes of its arrows (`$D796`) lie under
   * the menu's window, so neither is drawn here. What the turn costs the
   * machine is returned: ★ 68 280 T without the ball, 90 586 T with it,
   * 67 T more when it bounces and 37 T more again when it lands still
   * (tools/tracemenu.py — the loop runs in DI, its pace is the `LDIR` of
   * 2000 bytes at `$D6FF`, not the frame).
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   * @param {Object} state - From menuStart().
   * @returns {number} The T-states of the turn.
   */
  menuLoop(videoRAM, state) {
    state.toggle = (state.toggle+1) & 0xFF;
    if (!(state.toggle & 1)) {
      return ScreenComposer.MENU_LOOP_T[0];
    }
    var t = ScreenComposer.MENU_LOOP_T[1]+this.bounce(state);
    // ★ $D9B6: the buffer to the screen at column 6, lines 0-63 (8 rows of
    // 8 lines, 4 bytes a line — $D98E with its LDIR cut to 4 and no skip)
    for (var y = 0; y < 64; y++) {
      var at = ZXVideoRAM.lineOffset(y)+6;
      for (var i = 0; i < 4; i++) {
        videoRAM.pokeOffset(at+i, state.buffer[y*4+i]);
      }
    }
    return t;
  } // menuLoop

  /**
   * ★ `$D90A`: the ball off the buffer (XOR, `$D941`), the speed up by 2
   * and the row down by half of it (`SRA`); at row `$24` it bounces: the
   * speed turned round and the other frame of the ball (`$CDFB`) — and
   * when it lands with no speed left, a fresh bounce of 16 up with the
   * first frame (`$CDFF`). Then the ball on again.
   * @param {Object} state - From menuStart().
   * @returns {number} The T-states over the plain fall: ★ 67 for the
   *   bounce (`$D91D`-`$D92B`), 37 more for the fresh one (`$D92E`).
   */
  bounce(state) {
    this.xorBall(state);
    var extra = 0;
    var c = (state.vel+2) & 0xFF;
    // SRA A: signed halving; ADD A,B without the wrap to 8 bits, so that the
    // remake's start above the screen (pos < 0, menuModel.js) falls in —
    // the original's rows 4-$24 never wrap, so for them it is the same
    var a = (((c << 24) >> 24) >> 1)+state.pos;
    if (a < 0x24) {
      state.pos = a;
      state.vel = c;
    } else {
      extra = 67;
      a = (-c) & 0xFF;                             // NEG
      state.pos = 0x24;
      state.vel = a;
      state.sprite = 'CDFB';
      if (a === 0) {
        extra += 37;
        state.vel = 0xF0;
        state.sprite = 'CDFF';
      }
    }
    this.xorBall(state);
    return extra;
  } // bounce

  /**
   * ★ `$D941`: the frame of the ball XORed into the buffer at its row. The
   * lines above the buffer (the remake's start, pos < 0) are left out.
   */
  xorBall(state) {
    var sprite = state.sprites[state.sprite];
    for (var row = Math.max(0, -state.pos); row < 25; row++) {
      for (var i = 0; i < 4; i++) {
        state.buffer[(state.pos+row)*4+i] ^= sprite[row*4+i];
      }
    }
  } // xorBall

  /**
   * The original's opening screen, as `$D9D8` leaves it.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  composeTitle(videoRAM) {
    videoRAM.restore(this.title);
    return videoRAM;
  } // composeTitle

  /**
   * The Edge logo at the top right of the opening screen's BOBBY BEARING
   * (ScreenLayout.EDGE_LOGO), for the remake's menu. ★ The glyphs are the
   * original's: the text of the screen of controls (`$72E6`, `$7375`) draws
   * the logo with the game's font (`$F70C`) as two rows of seven characters,
   * `(+-/;=Z` over `*,.:<>F`, THE in the first column. ? The place and the
   * colours are the remake's (operator 2026-10-30): the top edge on the top
   * of the lettering (row 3), the right edge on the end of BEARING
   * (column 29), THE in bright red, EDGE in bright white, on black.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  composeEdgeLogo(videoRAM) {
    var font = this.scene.font;
    if (!font || !font.bytes) {
      return videoRAM;
    }
    var glyphs = ScreenComposer.fromBase64(font.bytes);
    var at = ScreenLayout.EDGE_LOGO;
    ScreenComposer.EDGE_LOGO_TEXT.forEach((text, row) => {
      for (var i = 0; i < text.length; i++) {
        var glyph = (text.charCodeAt(i)-font.first)*8;
        for (var line = 0; line < 8; line++) {
          videoRAM.pokeOffset(ZXVideoRAM.lineOffset((at.row+row)*8+line)+at.col+i, glyphs[glyph+line]);
        }
        videoRAM.pokeOffset(ZXVideoRAM.ATTRIBUTES_OFFSET+(at.row+row)*ZXVideoRAM.COLS+at.col+i, i === 0 ? at.attrThe : at.attrEdge);
      }
    });
    return videoRAM;
  } // composeEdgeLogo

  /**
   * The whole game screen: the 6912 bytes of the game's video memory the
   * worker sent last; before the first one, a black screen.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   * @param {Object} [state] - The 'frame' message of the worker.
   */
  composeInto(videoRAM, state) {
    if (state && state.screen) {
      this.game = state.screen;
    }
    videoRAM.restore(this.game || this.blank);
    return videoRAM;
  } // composeInto

  /**
   * The original's opening screen with a window over its lower part
   * (ScreenLayout.MENU_WINDOW), where the remake's menu used to sit; only
   * tools/matchscreen.mjs checks it now.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  composeMenu(videoRAM) {
    this.composeTitle(videoRAM);
    var w = ScreenLayout.MENU_WINDOW;
    videoRAM.clearArea(w, ScreenLayout.ATTR_WINDOW);
    return videoRAM;
  } // composeMenu

  /**
   * The screen the hall of fame and the about page sit on: the opening screen.
   * @param {ZXVideoRAM} videoRAM - The video memory to draw into.
   */
  clearScreen(videoRAM) {
    this.composeTitle(videoRAM);
  } // clearScreen

} // ScreenComposer

/** ★ The Edge logo in the game's font: the two rows of `$7375` after `a` (`$7311`). */
ScreenComposer.EDGE_LOGO_TEXT = ['(+-/;=Z', '*,.:<>F'];

/** ★ T-states of a turn of the menu loop without and with the ball (tools/tracemenu.py). */
ScreenComposer.MENU_LOOP_T = [68280, 90586];
