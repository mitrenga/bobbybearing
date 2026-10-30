// begin code

/**
 * Geometry of the Bobby Bearing screen, measured on the original rather than
 * off a photograph (sources/docs/screen_layout.md).
 *
 * The screen is the plain ZX Spectrum one: 256x192 pixels, attributes in 8x8
 * cells.
 *
 * ★ **The play area is the whole screen** (tools/playtrace.py, the RZX
 * recording): one attribute for the whole room — black ink on the paper of
 * the room — and the panel drawn over it, the time on row 20 (columns 2-5),
 * the brothers under it and the name of the brother in a red frame on rows
 * 21-23, columns 23-31.
 *
 * ★ The opening screen ($D9D8, ScreenComposer.composeTitle): the logo on
 * rows 3-12 in bright white ($47) and bright yellow ($46) on black, rows
 * 13-16 empty, the original's control selector on rows 17-23 in bright
 * white and bright cyan ($45).
 */
export const ScreenLayout = {

  WIDTH: 256,
  HEIGHT: 192,

  CELL: 8,
  COLS: 32,
  ROWS: 24,

  // what is behind everything until the composer has drawn: black
  ATTR_SCREEN: 0x00,

  // The remake's menu sits in a window over the lower part of the original's
  // opening screen, where the original has its control selector, so the logo
  // stays in sight. ★ The colours are the opening screen's own: bright white
  // ($47) on black for the lines, the
  // cyan of the selector box ($45) for the bar (menuModel.js). ? The window's
  // size and place are the remake's.
  MENU_WINDOW: {col: 4, row: 13, cols: 24, rows: 11},
  MENU_ITEMS: {col: 6, row: 15, pitch: 1},
  MENU_VERSION_ROW: 23,
  ATTR_WINDOW: 0x47,
  ATTR_LINE: 0x47,

  // 50.08 Hz — 69888 T states per frame on the 3.5 MHz Z80 of the 48K
  // machine (★ 48K, sources/docs/hw_notes.md): the rate of the ULA
  // interrupt, which drives the sound effects ($FB08).
  FRAME_RATE: 3500000/69888,

  // ★ The main loop ($751E) does not wait for the frame: a pass takes 1.5-2.2
  // frames, 39.24 ms on average over a whole game (disasm_notes.md §4). The
  // remake runs it at a constant pace — operator's decision 2026-10-29
  // (ZADANI chap. 2), 40 ms for a start.
  PASS_MS: 35

}; // ScreenLayout
