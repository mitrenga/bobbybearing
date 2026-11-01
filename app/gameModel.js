const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen.
 *
 * The whole 256x192 picture is one {@link GameAreaEntity}, panel and all,
 * because that is how the machine holds it. ScreenComposer builds those 6912
 * bytes, and from M1 on tools/matchscreen.mjs checks the result against the
 * original's own video memory byte for byte.
 *
 * The worker (gameWorker.js, WORKER-PROTOCOL.md) keeps the state and ticks;
 * this model routes the controls into it and draws what comes back.
 *
 * ★ **The picture is drawn on the worker's message** (R-037): a `frame`
 * message composes the screen and draws it, and `loopModel` draws only when
 * no message has come since its last pass, so the picture keeps step with
 * the world and still keeps going while the worker stands (the pause panel).
 * How well that works is measured, not looked at: `drawn/messages/ticks FPS`
 * in the border in dev mode (R-045), healthy at 60/50/50.
 *
 * ? **M1: the worker ticks, the game is not there yet.** It runs the
 * remake's clock — one pass of the main loop every 40 ms, the constant pace
 * the operator chose (ZADANI chap. 2) — takes the controls and sends the
 * screen of the first room, built out of the program's data (M2,
 * app/worldRenderer.js). The port of the
 * original's main loop is M3, checked against the RZX recording of a whole
 * game (tools/playrzx.py).
 */
export class GameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'GameModel';

    this.gameOver = false;
    // EXIT GAME asked the worker for the end screen (endGame)
    this.ending = false;
    // the outcome of the game
    this.outcome = 'pass';
    // the end screen for GameOverModel: none unless the game ends on one
    app.endScreen = null;
    this.dataMissingShown = false;
    // ★ the original's four directions (the Kempston bits of $FDF6) and its
    // `Q` CHEAT (hw_notes.md)
    this.controlsState = {left: false, right: false, up: false, down: false,
                          cheat: false};
    this.worker = null;
    this.render = null;
    this.gameAreaEntity = null;
    this.inputEntity = null;
    // R-045: drawn / worker messages / world ticks a second
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
    this.fpsEnabled = false;
    // R-037: true until a worker message has drawn the picture
    this.needDraw = true;
    // a touch that is shorter than one tick of the worker has to be held
    this.heldTaps = {};
  } // constructor

  /**
   * The game's own border: no X in it (Escape and the pause panel do that),
   * but on a touchscreen the two halves of the screen are the controls, so
   * the border carries them and their icons (jetpac/app/gameModel.js).
   * Without it the model gets the plain AbstractEntity of AbstractModel and
   * the touch halves are not there at all.
   * @returns {BorderEntity}
   */
  newBorderEntity() {
    return new BorderEntity(false, this.app.controls.touchscreen.supported);
  } // newBorderEntity

  init() {
    super.init();

    // ★ black: `OUT ($FE),A` with A = 0 on entry ($D6C4); red only in the
    // original's pause ($73C0)
    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // a bus a kind of sound (audioManager.js BUSES), so that none cuts
    // off another
    AudioManager.BUSES.forEach((bus) => {
      this.sendEvent(0, {id: 'openAudioBus', bus: bus, options: {muted: this.app.muted.sounds}});
    });

    // the screen and the worker need their data files: at once from
    // localStorage, or from the server when they are missing there (R-062)
    this.loadDataFiles(['screen', 'world', 'memory'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files: the screen and the start of
   * the worker. Runs inside init() when the files are in localStorage, later
   * when they had to come from the server.
   * @param {Object|null} files - screen, world and memory, or null.
   * @param {Error} [error] - Why the files are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
      files = {};
    }
    if (!this.initScreen(files.screen)) {
      this.showDataMissing();
      return;
    }

    if (typeof this.app.devModeName === 'string') {
      // the FPS goes into the border (borderEntity.setFps, R-045 point 5);
      // the held controls go into the border as well, top right, for the
      // same reason: nothing is written over a picture that is compared with
      // the original byte for byte
      this.fpsEnabled = true;
      this.inputEntity = new TextEntity(this.borderEntity, this.app.fonts.fonts3x3, 0, 1, 10*8, 4, '', ZXColor.brightCyan, false, {align: 'right'});
      this.borderEntity.addEntity(this.inputEntity);
    }

    this.showTouchIcons();

    this.worker = this.app.worker;
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    this.app.startWorkerSession({
      headless: false,
      hiScore: this.app.hiScore,
      // ★ the rooms out of the program's data (tools/dumpworld.py,
      // sources/docs/world.md)
      world: files.world,
      // ★ the rest of the original's memory at the start of a game
      // (tools/mkmemory.mjs): the port of the main loop runs over it
      memory: files.memory,
      // ★ the one randomness of the original is the state of the
      // generator of the brothers' order ($EE7F/$EE80), what the last
      // game left in memory: the first game gets the clock (outside the
      // simulation), every next one the state the last game ended with
      // (operator 2026-10-30, WORKER-PROTOCOL.md)
      seed: typeof this.app.generatorSeed === 'number' ? this.app.generatorSeed : (Date.now() & 0xFFFF),
      // ★ the menu is the original's screen after a game and the game
      // starts from its arrow ($7481), which asks for sound 6
      startSound: true
    });
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
    // the sound of the end screen ($7D3D, effect 6) plays on under the
    // score (GameOverModel stops the buses when it goes)
    if (!this.gameOver) {
      this.sendEvent(0, {id: 'stopAllAudioBuses'});
    }
  } // shutdown

  /** The message over a black screen when the game data is missing. */
  showDataMissing() {
    if (this.dataMissingShown) {
      return;
    }
    this.dataMissingShown = true;
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'BOBBY BEARING', ZXColor.brightWhite, false, {align: 'center'}));
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
      'GAME DATA MISSING (data/screen.json, world.json, memory.json). RUN tools/mkscreen.py, tools/dumpworld.py AND tools/mkmemory.mjs.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
  } // showDataMissing

  /**
   * ? The game reached a place of the original not ported yet (M3-M5): the
   * last screen stays and a line at the bottom of the border says where
   * (`NOT PORTED YET: $8F6E`).
   * @param {string} message - From the worker, e.g. 'unported $8F6E: …'.
   */
  showStopped(message) {
    if (this.stoppedEntity) {
      return;
    }
    console.warn('game stopped: '+message);
    // into the bottom of the border, not over the picture (R-045)
    this.stoppedEntity = new TextEntity(this.borderEntity, this.app.fonts.fonts5x5, 0, this.borderEntity.height-7,
      this.borderEntity.width, 7, 'NOT PORTED YET: '+message.toUpperCase().split(':')[0].replace('UNPORTED ', ''),
      ZXColor.brightRed, false, {align: 'center', margin: 1});
    this.borderEntity.addEntity(this.stoppedEntity);
  } // showStopped

  /**
   * Builds the renderer and adds the screen.
   * @param {Object} scene - data/screen.json.
   * @returns {boolean} True when the screen was created.
   */
  initScreen(scene) {
    try {
      this.render = new ScreenComposer(scene);
    } catch (error) {
      console.error(error.message);
      return false;
    }
    this.gameAreaEntity = new GameAreaEntity(this.desktopEntity, 0, 0, this.render);
    this.desktopEntity.addEntity(this.gameAreaEntity);
    return true;
  } // initScreen

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one control and sends the whole state over when it changed. The
   * whole state goes rather than the change, so that the worker never has to
   * guess what is still held.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState) || this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.sendWorkerMessage(Object.assign({id: 'controls'}, this.controlsState));
  } // setControl

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'endGame':
        // EXIT GAME in the pause: the worker draws the original's end screen
        // of the time out over the game (its GAME OVER and the brothers'
        // balls) and its frame ends the game as the original's end does —
        // the score over it, stored too (R-049, operator 2026-10-31); ★ the
        // original's own way out of its pause (`1`+`4`) has no end screen
        this.ending = true;
        this.sendWorkerMessage({id: 'endGame'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          // ★ The original pauses on `SPACE` ($73FC, a red border). The
          // remake pauses on Escape (the gamepad's EXIT) and a tab that loses
          // focus, as all the remakes do — no key of SETTINGS (operator
          // 2026-10-31); ? that the remake's pause shows a panel is the
          // remake's until M5 reads the original's.
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            this.setControl(event.action, true);
            return true;
          case this.app.controls.keyboard.sounds:
            this.app.muted.sounds = !this.app.muted.sounds;
            AudioManager.BUSES.forEach((bus) => {
              this.sendEvent(0, {id: 'muteAudioBus', bus: bus, muted: this.app.muted.sounds});
            });
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause menu */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver || this.ending) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.sendEvent(0, {id: 'pauseAllAudioBuses'});
    // EXIT GAME ends the game the way the original's end does: the end
    // screen with the score, stored in the hall of fame (R-049, endGame);
    // the panel shows the score too
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 52, 34, 153, 73, 'PAUSE GAME', false));
  } // pauseGame

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        if (data.menu) {
          // a frame of the menu is not the game's (gameApp.js workerSession)
          break;
        }
        this.fps.workerFrames++;
        // R-045: the third number is read off the counter the message
        // carries, not counted here
        if (this.fps.lastFrame !== false && data.frame > this.fps.lastFrame) {
          this.fps.ticks += data.frame-this.fps.lastFrame;
        }
        this.fps.lastFrame = data.frame;
        if (data.score) {
          // M7: the remake's three numbers, read off the original's memory
          // by the worker (gameWorker.js score())
          this.app.score = data.score;
        }
        if (typeof data.generator === 'number') {
          // the seed of the next game: the generator as this one leaves it
          this.app.generatorSeed = data.generator;
        }
        if (GameModel.END_OUTCOMES.indexOf(data.outcome) >= 0 && !this.gameOver) {
          // ★ the game ended on the original's end screen ($7D06): the
          // remake's score goes over it (GameOverModel, operator 2026-10-31)
          this.gameOver = true;
          this.outcome = data.outcome;
          this.app.endScreen = data.screen || null;
        }
        if (this.inputEntity && data.controls) {
          var held = Object.keys(data.controls).filter((key) => data.controls[key]);
          this.inputEntity.setText(held.length ? held.join(' ').toUpperCase() : '-');
        }
        if (data.sounds && data.sounds.length && this.app.audioManager) {
          this.app.audioManager.playFrame(data);
        }
        // R-037: the message draws, and the loop knows it does not have to
        if (this.gameAreaEntity) {
          this.gameAreaEntity.setFrame(data);
          this.drawModel();
          this.needDraw = false;
        }
        break;

      case 'stopped':
        this.showStopped(data.message);
        break;
      case 'error':
        // the worker has no game to run (data/world.json missing): say so
        // rather than stay black
        console.error(data.message);
        this.showDataMissing();
        break;
    }
  } // handleWorkerMessage

  /**
   * Maps a key or gamepad event onto a control action.
   *
   * The keyboard keys are **only** the configured ones (`app.controls.keyboard`
   * — the arrows, Q and M by default, remapped from SETTINGS); nothing is
   * accepted beside them, so a remapped key never keeps a hidden second
   * meaning. The gamepad keys are the fixed names the library gives its
   * buttons. The mouse is not a game control here. ★ The original's own
   * keyboard is rows of keys (hw_notes.md); whoever wants them sets them in
   * SETTINGS. CHEAT has a gamepad button of its own (GamepadCheat), set in
   * SETTINGS too.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    switch (key) {
      case kb.left: case 'GamepadLeft': return 'left';
      case kb.right: case 'GamepadRight': return 'right';
      case kb.up: case 'GamepadUp': return 'up';
      case kb.down: case 'GamepadDown': return 'down';
      case kb.cheat: case 'GamepadCheat': return 'cheat';
    }
    return false;
  } // controlAction

  /**
   * What this half of the screen does (controlsOptions.touchscreen.halves):
   * ★ both halves are a stick, the original has no fire.
   * @param {string} side - 'left' or 'right'.
   * @returns {Object} {icon, zones}
   */
  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    return ts.halves[ts.types[this.app.controls.touchscreen.type][side].half];
  } // touchHalf

  /**
   * Icons into the border: what each half of the screen does. The border draws
   * them only where there is room for them outside the play area.
   */
  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity.setGameControlIcons) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  /**
   * The zone of the layout under the finger. `rect` is a fraction of the half,
   * so it is worked out from where on that half the finger is, not from pixels.
   * @param {Object} event - The touch event (x, y).
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen (borderEntity).
   * @returns {Object|false} The zone, or false.
   */
  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  /**
   * A new touch on a half of the screen. There can be several at once: each
   * keeps its own record in `touchesGameControls` and the control state is
   * their sum, so moving and firing go together.
   * @param {Object} event - The touch event.
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen.
   */
  touchStart(event, side, entity) {
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    // A button holds its action from the moment the finger lands; the stick
    // does nothing until the finger moves, so a tap on it sends nothing.
    if (zone !== false && zone.type == 'button') {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  /**
   * The finger came up. A short tap has to be **held**: the game reads its
   * controls once per pass of the main loop (40 ms), so a shorter tap might
   * never be seen.
   * @param {Object} event - The touch event.
   */
  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  /**
   * Releases an action, but only when no other finger is still holding it —
   * two fingers on the same action must not cancel each other.
   * @param {string} action - The control action.
   */
  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * The finger moved. The stick is **absolute**: the direction is where the
   * finger has moved to from where it landed, with a dead zone of
   * `joystickStep` in the middle. ★ The original reads its four direction
   * bits at once ($FDF6, hw_notes.md), so the stick sends a diagonal as two
   * of them: an axis counts when it is at least half the stronger one.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var dx = event.x-control.origin.x, dy = event.y-control.origin.y;
    var next = [];
    var strong = Math.max(Math.abs(dx), Math.abs(dy));
    if (strong > step) {
      if (Math.abs(dx)*2 >= strong) {
        next.push(dx < 0 ? control.actions.left : control.actions.right);
      }
      if (Math.abs(dy)*2 >= strong) {
        next.push(dy < 0 ? control.actions.up : control.actions.down);
      }
    }
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.join() === next.join()) {
      return;
    }
    control.action = next.length ? next : false;
    previous.filter((action) => next.indexOf(action) === -1)
            .forEach((action) => this.releaseTouchAction(action));
    next.filter((action) => previous.indexOf(action) === -1)
        .forEach((action) => this.setControl(action, true));
  } // touchMove

  updateFps(timestamp) {
    if (!this.fpsEnabled) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.borderEntity.setFps(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    // R-045: counted before the needDraw branch, so the first number is how
    // often the loop runs, and R-037: the loop draws only when no worker
    // message has drawn since its last pass
    this.updateFps(timestamp);
    if (this.gameOver) {
      // the end screen with the remake's score over it, on the way to the
      // menu (GameOverModel)
      this.app.setModel('GameOverModel');
      return;
    }
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel

} // GameModel

/**
 * ★ The ways the game ends (gameWorker.js frame, M5): all brothers home,
 * home with one lost, the time out, EXIT GAME — any other outcome (the menu's
 * 'start') ends nothing.
 */
GameModel.END_OUTCOMES = ['won', 'lost', 'timeout', 'quit'];
