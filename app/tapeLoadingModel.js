const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { AlkatrazLoader } = await import('./alkatrazLoader.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Loading from tape, the way the original does it: `LOAD ""` typed on the ZX
 * keyboard, then the four blocks of the Bobby Bearing tape in its own order,
 * each in its own timing, and the loading screen — the real one off the
 * original tape (data/loading.json, tools/matchloading.py).
 *
 * Every block is played in its timing off the tape (audioManager.tapeBlockSound,
 * data/tape.json): the pilot, the sync pulses and as many bytes as it really
 * carries. The sound says when the pilot is over and when the block is over,
 * and the loading lives off those events rather than off a timer.
 *
 * The picture is not revealed by a timer, it is **loaded**: the sound sends
 * an event after every byte of the second turbo block and the model hands
 * the byte to the conversion of the loader's second stage
 * (alkatrazLoader.js), which puts it where the Alkatraz loader would — ★
 * the loader generates the order of the screen addresses itself ($F983),
 * cell by cell in a spiral from the middle, several cells interleaved; and
 * **between the edges of every bit** its state machine ($F7AE) draws on
 * rows 22-23: the running text `FROM THE EDGE ......` and the counter down
 * to zero at the end of the block. All of it is the original's code over
 * its own memory; data/loading.json carries only the 6714 bytes of the
 * picture as they come off the tape and the 1.3 KB of the loader's memory
 * the code reads (tools/traceloader.py, tools/matchtape.mjs).
 *
 * ★ **What the screen shows is measured** (tools/traceloading.py, the
 * simulated load, frame by frame):
 *
 * - `Program:` on row 1, black on white ($38), 5.1 s in — and at once the
 *   name over it: ★ the name in the header is `AT 1,0`, ` BOBBY` and a
 *   comma, so what stays on row 1 is ` BOBBY`
 * - when the BASIC runs (15 s): the machine code clears the screen
 *   ($EBB6) — black screen, black border
 * - the first turbo block (4868 B, the loader's second stage): ★ the edge
 *   routine flips the border on every edge, `AND $07 / OR $08` ($EDE5),
 *   in the ROM's colours (pilot cyan / red, data yellow / blue)
 * - the second one: ★ the border **solid blue** ($F7D1 `LD A,$01 / OR $08`),
 *   the picture coming up in the loader's order from 56.6 s, the text and
 *   the counter after the picture (byte 6718 of the block)
 *
 * ★ The tape (sources/docs/tape_layout.md): the ROM header `BOBBY`, the BASIC
 * with the Alkatraz loader in a REM, and two **turbo blocks** (pilot
 * 2143 / 2144 T, sync 674/674 T, bits 561/1122 T) of 4868 and 46 583 bytes,
 * both played whole — the second one three minutes, the picture in its
 * first 28 seconds.
 */
export class TapeLoadingModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'TapeLoadingModel';

    this.inputLineEntity = null;
    this.commandPhase = 0;
    this.command = ['K', 'LOAD L', 'LOAD "L', 'LOAD ""L', ''];
    this.programNameEntity = null;
    this.screenEntity = null;
    this.app.stack.flashState = false;
    this.tapeBreak = false;
    // ★ the line BREAK reports while the ROM loads the BASIC: the command
    // typed directly, 0:1
    this.tapeBreakLine = '0:1';
    // whether BREAK works at all right now. ★ Once the BASIC runs, the
    // Alkatraz loader has the machine with DI and its own edge routines,
    // which do not test BREAK; ? what a key does then is not measured, so the
    // remake ignores BREAK from the BASIC on
    this.breakable = true;
    this.tapePhase = false;
    this.tape = null;
    this.loading = null;
    // the loader's second stage over its memory (alkatrazLoader.js), made
    // when the BASIC runs; the picture in tape order and the variables after
    // it come inflated from data/loading.json (initData)
    this.loader = null;
    this.picture = null;
    this.vars = null;
  } // constructor

  /**
   * The tape as a script: the blocks in the order of the tape, the pauses
   * between them and what happens on the screen in between. The blocks come
   * out of data/tape.json, the pauses too — ? those are a property of the
   * TZX container rather than of the tape, so they are an order of
   * magnitude, not measured numbers.
   * @param {Object} tape - data/tape.json.
   * @returns {Object[]} The steps.
   */
  script(tape) {
    var b = tape.blocks;
    var pause = (n) => ({id: 'pause', duration: b[n-1].pauseMs});
    var block = (n, extra) => Object.assign({id: 'block', block: n, duration: b[n-1].durationMs}, extra || {});
    return [
      {id: 'pause', duration: 1000},
      // the ROM loads the BASIC: header, then the program
      block(1, {end: {id: 'setProgramName'}}),
      pause(1),
      // ★ line 0 runs straight away (autostart 0): USR $5D4C into the loader
      block(2, {end: {id: 'runBasic'}}),
      pause(2),
      // ★ the loader's second stage, decrypted in layers after it (the pause)
      block(3, {turbo: true}),
      pause(3),
      block(4, {turbo: true, start: {id: 'secondStage'}}),
      // the code jumps to $D6B6 — the remake's menu takes over
      {id: 'pause', duration: 1000}
    ];
  } // script

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.white;
    this.desktopEntity.bkColor = ZXColor.white;

    this.inputLineEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 23*8, 32*8, 8, '© 1982 Sinclair Research Ltd', ZXColor.black, false, {align: 'left'});
    this.desktopEntity.addEntity(this.inputLineEntity);

    // ★ row 1, black on white ($38): the name in the header is AT 1,0,
    // ` BOBBY` and a comma, so `Program:` is overwritten at once and the
    // comma clears the rest up to column 16 — what stays is ` BOBBY`
    // (tools/traceloading.py, frames 255 and 256)
    this.programNameEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 1*8, 32*8, 8, ' BOBBY', ZXColor.black, false, {});
    this.programNameEntity.hide = true;
    this.desktopEntity.addEntity(this.programNameEntity);

    // the tape and the loader's data: at once from localStorage, or from
    // the server when they are missing there (R-062)
    this.loadDataFiles(['tape', 'loading'], (files) => this.initData(files));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init() when
   * they are in localStorage, later when they had to come from the server.
   * @param {Object|null} files - tape and loading, or null.
   */
  initData(files) {
    if (this.app.model !== this) {
      return;
    }
    files = files || {};
    var tape = files.tape;
    this.loading = files.loading;
    // the tape's sound is rendered later, block by block (audioManager.js)
    if (this.app.audioManager) {
      this.app.audioManager.tapeData = tape;
      this.app.audioManager.tapePicture = null;
      this.app.audioManager.tapeVars = null;
    }
    if (!tape || !this.loading) {
      this.inputLineEntity.setText('TAPE DATA MISSING (data/tape.json)');
      this.sendEvent(3000, {id: 'setMenuModel'});
      return;
    }
    this.tape = this.script(tape);
    this.unpackLoading(this.loading);

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {}});
    this.sendEvent(1000, {id: 'updateCommand'});

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  newBorderEntity() {
    // no X in the border, like the other screens: a click or a touch anywhere
    // in the border is BREAK (handleEvent), a second one goes back to the menu,
    // and Escape or GamepadExit go back straight away
    return new BorderEntity(false, false);
  } // newBorderEntity

  shutdown() {
    super.shutdown();
    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // shutdown

  /**
   * The next step of the tape.
   */
  nextStep() {
    if (this.tapeBreak) {
      return;
    }
    var step = this.tape[this.tapePhase];
    switch (step.id) {
      case 'block':
        this.breakable = !step.turbo;
        if (step.start) {
          this.sendEvent(0, step.start);
        }
        this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'tapeBlock'+step.block, options: false});
        // ★ the second stage keeps the border solid blue (secondStage)
        this.sendEvent(0, {id: 'setBorderAnimation', value: step.block == 4 ? false : 'pilotTone'});
        // the block ends itself with `tapeBlockEnd`; this only catches a bus
        // that never got to play it
        this.sendEvent(step.duration+2000, {id: 'updateTape', fallback: true});
        return;
      case 'pause':
        this.breakable = true;
        this.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
        this.sendEvent(0, {id: 'setBorderAnimation', value: false});
        if (step.event) {
          this.sendEvent(0, step.event);
        }
        this.sendEvent(step.duration, {id: 'updateTape'});
        return;
    }
  } // nextStep

  /**
   * The step is over: what it leaves behind, and the step after it.
   */
  endStep() {
    this.cancelEvent('updateTape');
    var step = this.tape[this.tapePhase];
    if (step.end) {
      this.sendEvent(0, step.end);
    }
    this.tapePhase++;
    if (this.tapePhase < this.tape.length) {
      this.nextStep();
    } else {
      this.sendEvent(0, {id: 'setMenuModel'});
    }
  } // endStep

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'updateCommand':
        this.inputLineEntity.options.align = 'left';
        this.inputLineEntity.fonts = this.app.fonts.zxFonts8x8Mono;
        this.inputLineEntity.options.animationMode = 'flashReverseColors';
        this.inputLineEntity.setText(this.command[this.commandPhase]);
        this.inputLineEntity.options.flashMask = '';
        if (this.command[this.commandPhase].length > 0) {
          this.inputLineEntity.options.flashMask = this.inputLineEntity.options.flashMask.padStart(this.command[this.commandPhase].length-1, ' ')+'#';
        }
        this.commandPhase++;
        this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'keyboardSound', options: false});
        if (this.commandPhase < this.command.length) {
          this.sendEvent(800, {id: 'updateCommand'});
        } else {
          this.inputLineEntity.hide = true;
          this.tapePhase = 0;
          this.nextStep();
        }
        return true;

      case 'updateTape':
        if (!this.tapeBreak && this.tapePhase !== false) {
          this.endStep();
        }
        return true;

      case 'tapePilotEnd':
        if (!this.tapeBreak && !(this.tapePhase !== false && this.tape[this.tapePhase].block == 4)) {
          this.sendEvent(0, {id: 'setBorderAnimation', value: 'dataTone'});
        }
        return true;

      case 'tapeByte':
        // one byte of the second block (`at` is its number in the block): ★
        // the loader's conversion steps its state machine eight times (the
        // text and the counter) and stores the byte where the loader would
        // — a byte of the picture decrypted, from data/loading.json; what
        // that wrote into the screen the entity repaints on the next frame
        if (this.screenEntity && this.loader && !this.tapeBreak) {
          var n = event.data.at;
          this.loader.loadByte(n, this.tapeByteValue(n));
          var dirty = this.loader.dirty;
          for (var i = 0; i < dirty.length; i++) {
            this.screenEntity.pokeOffset(dirty[i], this.loader.mem[0x4000+dirty[i]]);
          }
          dirty.length = 0;
        }
        return true;

      case 'tapeBlockEnd':
        var step = this.tapePhase === false ? null : this.tape[this.tapePhase];
        if (!this.tapeBreak && step && step.id == 'block' && step.block == event.data.block) {
          this.endStep();
        }
        return true;

      case 'setProgramName':
        this.programNameEntity.hide = false;
        return true;

      case 'runBasic':
        // ★ USR $5D4C: the loader clears the screen at once ($EBB6, LDIR of
        // zeros from $4000) — a black screen and a black border; no BREAK
        // from here on (the loader runs with DI and its own edge routines)
        this.breakable = false;
        if (this.programNameEntity) {
          this.programNameEntity.destroy();
          this.programNameEntity = null;
        }
        this.borderEntity.bkColor = ZXColor.black;
        this.desktopEntity.bkColor = ZXColor.black;
        this.screenEntity = new ZXVideoRAMEntity(this.desktopEntity, 0, 0);
        this.screenEntity.clear(0, 0x00);
        this.screenEntity.invalidate();
        this.desktopEntity.addEntity(this.screenEntity);
        // ★ the loader's second stage: its memory and the list of addresses
        // it generates before the block ($F983)
        this.loader = new AlkatrazLoader(this.loading.regions);
        var entities = this.desktopEntity.entities;
        entities.push(entities.splice(entities.indexOf(this.inputLineEntity), 1)[0]);
        this.inputLineEntity.setPenColor(ZXColor.white);
        this.inputLineEntity.setBkColor(ZXColor.black);
        return true;

      case 'secondStage':
        // ★ $F6DA `LD A,$09 / OUT ($FE),A` and the edge routine's `LD A,$01 /
        // OR $08` ($F7D1): blue for the whole block
        this.sendEvent(0, {id: 'setBorderAnimation', value: false});
        this.borderEntity.bkColor = ZXColor.blue;
        return true;

      case 'setMenuModel':
        this.app.setModel('MenuModel');
        return true;

      case 'keyPress':
        switch (event.key) {
          case 'Escape':
          case 'GamepadExit':
            this.app.setModel('MenuModel');
            return true;
          case ' ':
          case 'Enter':
          case 'GamepadOK':
            if (this.break()) {
              return true;
            }
            break;
          case 'Mouse1':
          case 'Mouse2':
          case 'Mouse4':
            this.app.inputEventsManager.keysMap[event.key] = this.borderEntity;
            return true;
          case 'Touch':
            this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity;
            return true;
        }
        break;

      case 'keyRelease':
        switch (event.key) {
          case 'Mouse1':
          case 'Mouse2':
          case 'Mouse4':
            if (this.app.inputEventsManager.keysMap[event.key] === this.borderEntity) {
              this.break();
            }
            return true;
          case 'Touch':
            if (this.app.inputEventsManager.touchesMap[event.identifier] === this.borderEntity) {
              this.break();
            }
            return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /**
   * Stops the load the way BREAK does on the real machine, or leaves when the
   * tape is already stopped. During a turbo block BREAK does nothing, as in
   * the original (`breakable`).
   * @returns {boolean} True when the event was consumed.
   */
  break() {
    if (this.tapeBreak) {
      this.app.setModel('MenuModel');
      return true;
    }

    if (this.tapePhase !== false) {
      if (!this.breakable) {
        return true;
      }
      this.cancelEvent('updateTape');
      this.cancelEvent('setMenuModel');
      this.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
      this.tapeBreak = true;
      // whatever the tape has put into the video memory stays there; the
      // report is printed over it
      this.inputLineEntity.setText('D BREAK - CONT repeats, '+this.tapeBreakLine);
      this.inputLineEntity.hide = false;
      this.sendEvent(0, {id: 'setBorderAnimation', value: false});
      this.sendEvent(5000, {id: 'setMenuModel'});
      return true;
    }
    return false;
  } // break

  /**
   * Inflates the picture of data/loading.json (6714 bytes in tape order,
   * zlib) and reads the variables after it; both go to the sound too.
   * Asynchronous — the second block starts some fifty seconds in, long after
   * this is done; ? a browser without DecompressionStream loads the tape
   * without the picture, the loader then stores zeros.
   * @param {Object} loading - data/loading.json.
   */
  unpackLoading(loading) {
    this.vars = AlkatrazLoader.hex(loading.vars || '');
    if (this.app.audioManager) {
      this.app.audioManager.tapeVars = this.vars;
    }
    if (!loading.picture || typeof DecompressionStream !== 'function') {
      return;
    }
    AlkatrazLoader.inflate(loading.picture).then((bytes) => {
      this.picture = bytes;
      if (this.app.audioManager) {
        this.app.audioManager.tapePicture = bytes;
      }
    }).catch((error) => console.error(error.message));
  } // unpackLoading

  /**
   * The value of byte `n` of the second block as the loader decrypts it:
   * a byte of the picture or of the variables; the remake has no other.
   * @param {number} n - The byte's number in the block.
   * @returns {number}
   */
  tapeByteValue(n) {
    var picture = this.loading.pictureBytes;
    if (this.picture && n >= picture[0] && n < picture[0]+picture[1]) {
      return this.picture[n-picture[0]];
    }
    var vars = picture[0]+picture[1];
    if (this.vars && n >= vars && n < vars+this.vars.length) {
      return this.vars[n-vars];
    }
    return 0;
  } // tapeByteValue

  loopModel(timestamp) {
    super.loopModel(timestamp);

    this.drawModel();
  } // loopModel

} // TapeLoadingModel
