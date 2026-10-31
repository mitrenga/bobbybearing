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

  // What the menu shows of the opening screen: rows 1-12, the logo with the
  // ball in the „O“, one row higher than in the original (from the top of
  // the screen); the control selector under it stays out (operator
  // 2026-10-30). From column 2: the logo two cells to the left of the
  // original's place, the right two columns of the menu empty (operator
  // 2026-10-31). ★ The ball starts on line 4 (row 0): its top four lines
  // are cut off for the first two bounces.
  MENU_TITLE: {col: 2, row: 1, cols: 30, rows: 12},
  // What the menu shows of the worker's screen of the menu room (the
  // original's screen after a game, $71BB, room $1E with six discs —
  // BobbyLogic.MENU_PATCH): rows 5-16 — the tiles, the discs and the
  // ball at rest from row 5 down (8 px higher than rows 4-15, operator
  // 2026-10-30) — at MENU_ROOM_ROW under the logo. Row 0 (the picture of
  // the choice, $4042) stays out; the texts ($72E6, from line $80 = row
  // 16) are not drawn at all (MENU_PATCH).
  MENU_ROOM: {col: 0, row: 5, cols: 32, rows: 12},
  MENU_ROOM_ROW: 12,

  // The Edge logo (ScreenComposer.composeEdgeLogo): seven cells by two,
  // drawn here at the top right of the lettering — ★ BOBBY BEARING starts
  // on row 3 and BEARING ends on column 29 (pixel 239), BOBBY on column 21.
  // The menu shows these cells as an entity of their own under the
  // lettering at the left edge (operator 2026-10-31), not on the title. ? Colours the remake's
  // (operator 2026-10-30): THE bright red ($42), EDGE bright white ($47)
  EDGE_LOGO: {col: 23, row: 3, attrThe: 0x42, attrEdge: 0x47},

  // The window over the lower part of the original's opening screen, where
  // the original has its control selector (ScreenComposer.composeMenu,
  // checked by tools/matchscreen.mjs); the menu no longer uses it. ★ Bright
  // white ($47) on black, the opening screen's own colours. ? The window's
  // size and place are the remake's.
  MENU_WINDOW: {col: 4, row: 13, cols: 24, rows: 11},
  ATTR_WINDOW: 0x47,

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
