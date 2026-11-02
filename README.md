BOBBY BEARING (ZX Spectrum 48K, 1986) — remake
==============================================

A faithful remake of *Bobby Bearing* by Robert and Trevor Figgins,
published by The Edge in 1986 for the ZX Spectrum 48K: an isometric
action-adventure in which a steel ball rolls over curved surfaces
("Curvispace 3D") to push his four stunned brothers back home before
time runs out. The remake will run on the **svision** library
(`ZXPlatform`, `ZXLayout`) and follow the `dump*` → `trace*` → `match*`
method shared by the other ZX remakes in this workspace.

**Public project** (decided 2026-10-29): it will be deployed publicly so
that it can be shown to the original authors, and it stays public unless
they ask for it not to be. The rights are disputed (The Edge / Softek
International, now claimed by Edge Games; the authors say they kept them),
and the tape image is marked *distribution denied* in ZXDB, so no image of
the original is part of the repository.

**Status: M0–M6 done, M7 in progress (2026-10-30): the worker plays the original's
game through a port that matches it byte for byte — a new game out of the
menu's memory (the brothers' order drawn by the original's generator),
Bobby rolls, falls, gets stunned, changes rooms, meets a brother; the
rooms' lifts, crushers, blocks that come and go, magnets, vents, the
chasing ball and the bad Bearings run as the original's code does (M4);
the game ends on the original's end screen — all home, one lost, or GAME
OVER — and the whole RZX game of a human player replays against the port
(M5); the sound is the original's interrupt handler run over the game's
memory, checked edge for edge on the beeper port (M6); M7 so far: the
remake's score (brothers home, rooms seen, the game's time at the last
progress — the original keeps none) in the pause, after the game and in
the hall of fame, the sounds prepared whole on a bus a kind, the ball in
the „O" of the menu bouncing as the original's menu loop does, the menu
in the game's own font.** M2: all 245 rooms are built out of
the program's data by a port of the original's room engine. The app runs on svision: the menu sits over the original's
opening screen, unpacked out of the program as its own routine does it;
LOAD TAPE plays the four blocks of the tape and puts the loading screen
down in the Alkatraz loader's own order; the worker ticks at `PASS_MS`
a pass (40 ms at first; 35 ms decided on 2026-10-30 as the pace closest to the original).
The worker keeps the original's memory (`data/world.json`,
`data/memory.json`) and runs `app/bobbyLogic.js` over it, one pass every
`PASS_MS`. The keys are the original's KEYBOARD rows: the configured up,
down, left and right go in as `P`, `L`, `Z` and `X`.

## Running it

Like every svision project: `config/config.php` out of
`config/config.php.sample` (`$devMode = true` for development), the
database from `config/createDB.sql`, the directory served by nginx + PHP
(`config/nginx.conf`). The browser loads `app/` directly in dev mode; the
bundle is made by `svtool build` (by hand, not by the tools here).

Tools (Python 3 and the SkoolKit checkout in `svision/sources/skoolkit`):

| tool | what it does |
|---|---|
| `tools/bblib.py` | shared: TZX reading, paths, entry point, memory image without pulses, disassembly |
| `tools/tapinfo.py` | lists the tape blocks and the BASIC loader |
| `tools/mksnapshot.sh` | simulated load of the tape → `build/entry.z80` (PC `$D6B6`) |
| `tools/matchloading.py` | loading screen from the tape vs the archive `.scr` and the snapshot |
| `tools/matchimage.py` | memory image without pulses vs the simulated load; memory at entry vs the RZX start snapshot and the independent in-game snapshot |
| `tools/mkasm.py` | SkoolKit disassembly in `sources/asm/` from the control file; `--coverage` rebuilds the coverage map |
| `tools/mkscreen.py` | `data/screen.json` (the opening screen as program bytes, the menu's ball, the font) and `data/loading.json` (the loading screen in tape order and the loader's memory) |
| `tools/mktape.py` | `data/tape.json`, the tape for LOAD TAPE: timing and lengths, the header's bytes |
| `tools/traceloading.py` | frames of the screen during the simulated load |
| `tools/traceloader.py` | `build/ref/loader.json`: the loader's second stage step by step (address generator, running text and counter after every bit) |
| `tools/matchscreen.mjs` | the remake's opening screen and menu against the original's |
| `tools/matchtape.mjs` | LOAD TAPE: `app/alkatrazLoader.js` against the loader's second stage step by step, the data against the tape |
| `tools/runworker.mjs` | the worker's protocol and clock, without a browser |
| `tools/measurecadence.py` | the original's mean pass (RZX) against the worker's `PASS_MS` |
| `tools/playrzx.py` | replays the RZX recording of a whole game, saves RAM and frames, watches addresses, counts main-loop passes |
| `tools/playtrace.py` | runs the game from a snapshot with scripted keys, saves frames and RAM |
| `tools/tracecadence.py` | where interrupts catch the program, and main-loop pass times in T-states (`--cmio` for contention) |

The game starts with key `0` (zero).

The original tape image and all documentation are copyrighted and are
**not** part of the repository; `sources/` is out of git (R-059).
