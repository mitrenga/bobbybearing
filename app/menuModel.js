const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXPlayerNameEntity } = await import('./svision/js/platform/canvas2D/zx/zxPlayerNameEntity.js?ver='+window.srcVersion);
const { ZXVolumeEntity } = await import('./svision/js/platform/canvas2D/zx/zxVolumeEntity.js?ver='+window.srcVersion);
const { ZXSettingsEntity } = await import('./svision/js/platform/canvas2D/zx/zxSettingsEntity.js?ver='+window.srcVersion);
const { ZXWaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/zx/zxWaitForAudioEventEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ZXDialogEntity } = await import('./svision/js/platform/canvas2D/zx/zxDialogEntity.js?ver='+window.srcVersion);
const { ZXDialogProperties } = await import('./svision/js/platform/canvas2D/zx/zxDialogProperties.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * Main menu over the original's own opening screen.
 *
 * ★ The screen is the original's opening screen composed out of the
 * program — the packed picture at $DA30 unpacked as `$D9D8` does it
 * (ScreenComposer.composeTitle, tools/matchscreen.mjs). The original's own
 * choice there is the controls (`6` / `7`, under the logo) and `0` starts.
 * The model has no menu of its own over it (no MenuEntity, no version line);
 * the events of the dialogs below stay.
 *
 * ★ The ball in the „O" bounces as in the original: the menu loop `$D6D0`
 * without a key (ScreenComposer.menuLoop — `$D90A` every other turn,
 * `$D9B6` onto the screen), turned over the screen's video memory from
 * loopModel at the original's own pace: the loop runs in DI and a turn is
 * its `LDIR` of 2000 bytes plus the work, 68 280 / 90 586 T measured
 * (tools/tracemenu.py, checked by tools/matchmenu.mjs). The selector of
 * the controls under the logo stands still.
 *
 * There is **one volume** (SOUNDS): one bus, one slider, one AudioContext
 * (R-024).
 *
 * The menu itself never touches the audio buses; items that need sound go
 * through ZXWaitForAudioEventEntity first when the browser wants a user
 * gesture.
 */
export class MenuModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'MenuModel';

    // the dialogs opened from the menu look like the ABOUT GAME panel
    // (aboutModel.js): a black window with the title in bright red. The
    // contents come from svision and are laid out for 200 x 124 px; the
    // window has no frame, only the title bar, so they get 192 x 117 — the
    // right edge of the volume panel (MAX, +) and of the keyboard loses up to
    // 6 px. It fills cells 4-27 in width, from y 50 down to 176. What is not
    // set here is the default of ZXDialogProperties (the look of Manic Miner)
    this.dialogProperties = ZXDialogProperties.merge({
      x: 32,
      y: 50,
      width: 192,
      height: 126,
      frameWidth: 0,
      titleColor: ZXColor.brightRed,
      bkColor: ZXColor.black,
      theme: {
        penColor: ZXColor.brightWhite,
        valueColor: ZXColor.brightCyan,
        selectionColor: ZXColor.white,
        selectionPenColor: ZXColor.black,
        hoverColor: '#333333ff',
        clickColor: '#444444ff',
        separatorColor: ZXColor.brightWhite,
        iconColor: ZXColor.brightCyan,
        sliderColor: ZXColor.brightWhite,
        keyboardButtonsBkColor: ZXColor.brightCyan,
        // the default keyboard is 194 px wide, the panel 192: the rows are shifted
        // by 7 instead of 9 and SPACE is 23 instead of 25, so the widest row is
        // exactly 192. `update` merges `buttons` key by key (the other keys stay)
        // and replaces `rows` whole
        keyboardLayout: {
          action: 'update',
          options: {
            rows: [{shiftX: 0}, {shiftX: 5}, {shiftX: 10}, {shiftX: 0}],
            buttons: {
              '⇧': {width: 19},
              ' ': {width: 21}
            }
          }
        }
      },
      // the remap dialog covers the whole settings window, its title bar
      // included: the contents start 9 px under the top of the window, so the
      // dialog sits at -9 and the contents must not clip it. It looks like the
      // settings window itself: no frame, black panel, the title in bright
      // red, the same colours inside
      clipsChildren: false,
      remapKeys: {
        x: 0,
        y: -9,
        width: 192,
        height: 126,
        frameWidth: 0,
        titleColor: ZXColor.brightRed,
        bkColor: ZXColor.black,
        theme: {
          penColor: ZXColor.brightWhite,
          valueColor: ZXColor.brightCyan,
          // the field awaiting the key: black cursor on cyan
          selectionColor: ZXColor.cyan,
          selectionPenColor: ZXColor.black
        }
      },
      // the gesture for audio: the popup of the about panel, black on yellow
      waitForAudioEvent: {frameColor: ZXColor.black, bkColor: ZXColor.brightYellow, theme: {penColor: ZXColor.black}}
    });

    this.titleEntity = null;
    this.subtitleEntity = null;
    // a newer version on the server (checkServerVersion), and the version
    // under BEARING that shows it (showVersion)
    this.newVersionAvailable = false;
    this.versionEntity = null;
    // the logo of The Edge under BOBBY BEARING (a screen of its own)
    this.logoEntity = null;
    // the window of the dialog open from the menu (openDialog), while it lasts
    this.dialogEntity = null;
    // the game's own picture under the menu (GameAreaEntity.panelScreen)
    this.screenEntity = null;
    // the worker's screen of the menu room under the logo, the worker and
    // the directions held for it (the game's controls)
    this.roomEntity = null;
    // the ball on the arrow in the last frame (the start, once per arrival)
    this.ballOnStart = false;
    // the name of the item under the ball, bottom right (MenuModel.ITEMS),
    // and the disc taken in the last frame (an item, once per take)
    this.itemEntity = null;
    this.discTaken = false;
    // the item of the disc under the ball in the last frame, or none: Enter
    // opens it as left or right on the disc does
    this.ballItem = null;
    // a direction pressed since the menu came: until then the place of the
    // item names shows how to choose (MenuModel.HINT)
    this.ballMoved = false;
    this.worker = null;
    this.controlsState = {left: false, right: false, up: false, down: false};
    this.gameInfoEntity = null;
    // ★ the menu loop of the original over that picture: its state
    // (ScreenComposer.menuStart) and the machine time it has run to (ms)
    this.menuState = null;
    this.menuDue = false;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    this.checkServerVersion();

    // Menu je **němé**, a to schválně: prohlížeč pustí zvuk až po gestu
    // uživatele, a do menu se přijde hned po načtení stránky, kdy žádné gesto
    // ještě být nemuselo. Sběrnice se proto zavřou a zvuk začíná až o patro
    // níž, za položkou menu, kterou hráč zvolil — tam už gesto proběhlo a
    // ZXWaitForAudioEventEntity si ho v handleEvent umí vyžádat. ? Zvuky
    // originálu jsou M6; do té doby jsou němé i ABOUT GAME a hall of fame.
    // the flash clock of the ZX attributes (app.stack.flashState, 330 ms like
    // the ROM's 16 frames): the blinking cursor of the remap dialog and of the
    // player name input reads it, so the menu has to keep it going like every
    // other model
    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});

    // the screen and the worker's room need their data files: at once from
    // localStorage, or from the server when they are missing there (R-062)
    this.loadDataFiles(['screen', 'world', 'memory'], (files, error) => this.initData(files, error));

    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // init

  /**
   * The part of init() that needs the data files: the title, the worker's
   * room and what sits around it. Runs inside init() when the files are in
   * localStorage, later when they had to come from the server.
   * @param {Object|null} files - screen, world and memory, or null.
   * @param {Error} [error] - Why the files are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      files = {};
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }
    // ★ the original's opening screen (ScreenComposer.composeTitle), only
    // the logo, one row higher (ScreenLayout.MENU_TITLE)
    this.screenEntity = GameAreaEntity.panelScreen(this, ScreenLayout.MENU_TITLE, files.screen);
    if (this.screenEntity && this.screenEntity.render) {
      this.menuState = this.screenEntity.render.menuStart();
      // the ball falls in from above the screen: off the buffer at the
      // original's start (row 4), on again at MenuModel.BALL_START
      if (this.menuState) {
        this.screenEntity.render.xorBall(this.menuState);
        this.menuState.pos = MenuModel.BALL_START;
        this.screenEntity.render.xorBall(this.menuState);
      }
    }
    if (!this.screenEntity) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'BOBBY BEARING', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/screen.json). RUN tools/mksnapshot.sh AND tools/mkscreen.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
    }
    // ★ under the logo the original's screen after a game ($71BB): the
    // worker runs it over the original's memory in room $1E with six discs
    // (BobbyLogic.MENU_PATCH) and the player rolls the ball with the
    // game's controls: the arrow starts the game, the six discs are the
    // items of MenuModel.ITEMS — the one under the ball is named bottom
    // right, left or right on it opens it.
    if (this.screenEntity) {
      this.roomEntity = new GameAreaEntity(this.desktopEntity, 0, ScreenLayout.MENU_ROOM_ROW*8, this.screenEntity.render, ScreenLayout.MENU_ROOM);
      this.desktopEntity.addEntity(this.roomEntity);
      // in the menu's font, close to the game's own (gameApp.js zxFonts8x8Menu)
      this.itemEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, 0, this.desktopHeight-8, this.desktopWidth-4*8, 8, '', ZXColor.brightCyan, false, {align: 'right'});
      this.desktopEntity.addEntity(this.itemEntity);
      this.showItem();
      // the version under BEARING, its right edge on the end of the lettering
      // (column 29 of the screen, less the columns MENU_TITLE leaves out), in the
      // menu's font; a button, because a newer version on the server turns
      // it into UPGRADE !
      var versionWidth = MenuModel.VERSION_CELLS*8;
      this.versionEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, (30-ScreenLayout.MENU_TITLE.col)*8-versionWidth, ScreenLayout.MENU_ROOM_ROW*8, versionWidth, 8, '', {id: 'upgradeApp'}, [], ZXColor.yellow, false, {align: 'right'});
      this.desktopEntity.addEntity(this.versionEntity);
      // no hover or click colours: it looks like plain text
      this.versionEntity.hoverColor = false;
      this.versionEntity.clickColor = false;
      this.showVersion();
      // the logo of The Edge under BOBBY BEARING at the left edge, two rows
      // under the row of the version: a screen of its own, as the room under it is the
      // worker's (the composer draws it at ScreenLayout.EDGE_LOGO,
      // the entity shows those cells)
      var logo = ScreenLayout.EDGE_LOGO;
      var logoCols = ScreenComposer.EDGE_LOGO_TEXT[0].length;
      var logoRows = ScreenComposer.EDGE_LOGO_TEXT.length;
      this.logoEntity = new ZXVideoRAMEntity(this.desktopEntity, 0, (ScreenLayout.MENU_ROOM_ROW+2)*8, {col: logo.col, row: logo.row, cols: logoCols, rows: logoRows});
      this.screenEntity.render.composeEdgeLogo(this.logoEntity.videoRAM);
      this.logoEntity.invalidate();
      this.desktopEntity.addEntity(this.logoEntity);
      // the credit down the right edge in two lines, reading top to bottom
      // from the top of BOBBY (row 3 of the screen, ScreenLayout.EDGE_LOGO
      // row); the first line on the edge
      var font = this.app.fonts.fonts5x5;
      var creditY = (ScreenLayout.EDGE_LOGO.row-ScreenLayout.MENU_TITLE.row)*8;
      var creditWidth = 2*font.charsHeight+font.lineSpacing;
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, font, this.desktopWidth-creditWidth, creditY, creditWidth, this.desktopHeight-creditY, MenuModel.CREDIT, ZXColor.white, false, {align: 'left', rotation: 270}));
      this.worker = this.app.worker;
      this.sendWorkerMessage({
        id: 'init',
        initData: {
          mode: 'menu',
          headless: false,
          world: files.world,
          memory: files.memory
        }
      });
      // ★ the sample of SOUNDS: the room change (effect 5, $7856) rendered
      // by the worker over the original's tables
      this.sendWorkerMessage({id: 'renderEffect', value: MenuModel.SAMPLE_EFFECT});
    }

  } // initData


  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
  } // shutdown

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  handleWorkerMessage(event) {
    var data = event.data;
    if (data.id == 'effect' && data.value === MenuModel.SAMPLE_EFFECT && this.app.audioManager) {
      this.app.audioManager.setSample('roomSound', data);
    }
    if (data.id == 'frame' && this.roomEntity) {
      this.roomEntity.setFrame(data);
    }
    if (data.id == 'frame' && data.menu) {
      // ★ the ball rolled onto the arrow (cell $10): the original starts the
      // game ($7481); the remake goes the way of START GAME (the player's
      // name, the gesture for audio). Once per arrival: a ball left on the
      // arrow after a dialog has to roll off and back
      if (data.menu.start && !this.ballOnStart && !this.desktopEntity.modalEntity) {
        this.sendEvent(0, {id: 'startGame', players: 1});
      }
      this.ballOnStart = data.menu.start;
      // the disc under the ball names its item; ★ left or right held on it
      // takes it in the original ($724A) — here it opens the item, once per
      // take: a direction still held after a dialog has to be let go first
      var item = MenuModel.ITEMS[data.menu.disc];
      this.ballItem = item || null;
      this.showItem(item);
      if (item && data.menu.taken && !this.discTaken && !this.desktopEntity.modalEntity) {
        this.sendEvent(0, {id: item.event});
      }
      this.discTaken = data.menu.taken;
    }
  } // handleWorkerMessage

  /**
   * The value an item shows after its name: the player's name for PLAYER
   * NAME when there is one, the volume for SOUNDS (`audioBusSoundsLevel`,
   * 0-10, as a percentage).
   * @param {Object} item - An entry of MenuModel.ITEMS.
   * @returns {string|boolean} The value, or false for none.
   */
  itemValue(item) {
    switch (item.event) {
      case 'setPlayerName':
        return this.app.playerName.length ? this.app.playerName : false;
      case 'setSounds':
        return this.app.audioManager ? this.app.audioManager.volume.sounds*10+'%' : false;
    }
    return false;
  } // itemValue

  /**
   * Puts the text for an item bottom right: its name in bright cyan, with
   * its value (itemValue) after a colon in white; with no item
   * MenuModel.HINT in yellow until the first direction pressed.
   * @param {Object|undefined} item - An entry of MenuModel.ITEMS, or none.
   */
  showItem(item) {
    if (!this.itemEntity) {
      return;
    }
    var text = item ? item.label : (this.ballMoved ? '' : MenuModel.HINT);
    var colors = {};
    var value = item ? this.itemValue(item) : false;
    if (value !== false) {
      text += ': ';
      for (var i = 0; i < value.length; i++) {
        colors[text.length+i] = ZXColor.white;
      }
      text += value;
    }
    // the map goes with the text: a new text redraws the entity (setText)
    this.itemEntity.options.penColorsMap = colors;
    this.itemEntity.setText(text);
    this.itemEntity.setPenColor(item ? ZXColor.brightCyan : ZXColor.yellow);
  } // showItem

  /**
   * One direction for the ball and the whole state over to the worker when
   * it changed (gameModel.js setControl). Nothing while a dialog is open.
   * @param {string} action - left, right, up or down.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    if (value) {
      this.ballMoved = true;
    }
    this.sendWorkerMessage(Object.assign({id: 'controls'}, this.controlsState));
  } // setControl

  /** All directions let go: a dialog takes the keys, their release would not come. */
  releaseControls() {
    Object.keys(this.controlsState).forEach((action) => this.setControl(action, false));
  } // releaseControls

  /**
   * The direction a key stands for: the game's own controls (SETTINGS) and
   * the gamepad (gameModel.js controlAction, without CHEAT).
   * @param {string} key - The key of the event.
   * @returns {string|boolean} The direction, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    if (key.length == 1) {
      key = key.toUpperCase();
    }
    switch (key) {
      case kb.left: case 'GamepadLeft': return 'left';
      case kb.right: case 'GamepadRight': return 'right';
      case kb.up: case 'GamepadUp': return 'up';
      case kb.down: case 'GamepadDown': return 'down';
    }
    return false;
  } // controlAction

  checkServerVersion() {
    var receiver = {
      id: this.id+'Version',
      fetchDataId: '',
      setData: (data) => {
        if (data.data.version && data.data.version !== 'unknown' && data.data.version !== this.app.version) {
          this.newVersionAvailable = true;
          this.showVersion();
        }
      },
      errorData: () => {}
    };
    receiver.fetchDataId = this.app.fetchData('version.db', false, {}, receiver);
  } // checkServerVersion

  /**
   * The version under BEARING: v and the number in yellow, or UPGRADE ! in
   * bright red when the server has a newer one.
   */
  showVersion() {
    if (!this.versionEntity) {
      return;
    }
    if (this.newVersionAvailable) {
      this.versionEntity.setText('UPGRADE !');
      this.versionEntity.setPenColor(ZXColor.brightRed);
    } else {
      this.versionEntity.setText('v'+this.app.version);
      this.versionEntity.setPenColor(ZXColor.yellow);
    }
  } // showVersion

  /**
   * Opens a dialog from the menu: the window with the title (ZXDialogEntity)
   * over the middle of the screen, placed and coloured by the dialog
   * properties, and the contents the factory makes for it, as the modal of
   * the desktop.
   * @param {string} title - The text of the title bar.
   * @param {Function} contentFactory - Called with the window, returns the contents entity.
   */
  openDialog(title, contentFactory) {
    this.releaseControls();
    var p = this.dialogProperties;
    this.dialogEntity = new ZXDialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, title, p, contentFactory);
    this.desktopEntity.addModalEntity(this.dialogEntity);
  } // openDialog

  /**
   * Asks for the browser's gesture for audio before an action that plays
   * sound: ZXWaitForAudioEventEntity in a window without a title, centred on
   * the screen, coloured by the `waitForAudioEvent` dialog properties.
   * @param {string} continueEvent - The event sent when the gesture comes.
   */
  openWaitForAudioEvent(continueEvent) {
    this.releaseControls();
    var p = this.dialogProperties.waitForAudioEvent;
    this.desktopEntity.addModalEntity(new ZXDialogEntity(this.desktopEntity, 66, 77, 124, 41, false, p, (dialog) => new ZXWaitForAudioEventEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, continueEvent, p)));
  } // openWaitForAudioEvent

  handleEvent(event) {
    // the dialog's window closing — the desktop removes it in super.handleEvent
    // and returns true, so it is forgotten before that
    if (event.id == 'destroy' && event.entity === this.dialogEntity) {
      this.dialogEntity = null;
    }
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'startGame':
        this.app.setPlayers(event.players);
        if (!this.app.playerName.length) {
          this.openDialog('PLAYER NAME', (dialog) => new ZXPlayerNameEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, true, this.dialogProperties));
          return true;
        } else {
          if (this.app.inputEventsManager.needEventForAudio()) {
            this.openWaitForAudioEvent('startGame2');
            return true;
          }
        }
      case 'startGame2':
        // straight into the game. ★ The original starts on `0` from its
        // opening screen ($D969); the control choice is the remake's SETTINGS
        this.app.startGame();
        return true;

      case 'setPlayerName':
        this.openDialog('PLAYER NAME', (dialog) => new ZXPlayerNameEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, false, this.dialogProperties));
        return true;

      case 'showHallOfFame':
        // a screen of its own (hallOfFameModel.js); silent, so no gesture for
        // audio is needed on the way
        this.app.setModel('HallOfFameModel');
        return true;

      case 'setSounds':
        // the sample is the game's room change (MenuModel.SAMPLE_EFFECT,
        // rendered by the worker in init); the key click until it comes
        var sample = this.app.audioManager && this.app.audioManager.samples.roomSound ? 'roomSound' : 'keyboardSound';
        this.openDialog('SOUNDS', (dialog) => new ZXVolumeEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'sounds', 'audioBusSoundsLevel', sample, this.dialogProperties));
        return true;

      case 'setSettings':
        this.openDialog('SETTINGS', (dialog) => new ZXSettingsEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, this.app.controlsOptions, this.dialogProperties));
        return true;

      case 'startTapeLoading':
        if (this.app.inputEventsManager.needEventForAudio()) {
          this.openWaitForAudioEvent('startTapeLoading2');
          return true;
        }
      case 'startTapeLoading2':
        this.app.setModel('TapeLoadingModel');
        return true;

      case 'showAbout':
        // a screen of its own (aboutModel.js), silent until M6
      case 'showAbout2':
        this.app.setModel('AboutModel');
        return true;

      case 'upgradeApp':
        if (this.newVersionAvailable) {
          this.app.upgradeApp();
        }
        return true;

      case 'keyPress':
        // Enter (and the gamepad's OK) opens the item under the ball
        if ((event.key == 'Enter' || event.key == 'GamepadOK') && this.ballItem && !this.desktopEntity.modalEntity) {
          this.sendEvent(0, {id: this.ballItem.event});
          return true;
        }
      case 'keyRelease':
        // the ball in the menu room rolls with the game's controls
        var action = this.desktopEntity.modalEntity ? false : this.controlAction(event.key);
        if (action !== false) {
          this.setControl(action, event.id == 'keyPress');
          return true;
        }
        break;

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.turnMenuLoop(timestamp);

    this.drawModel();
  } // loopModel

  /**
   * ★ The original's menu loop as far as the machine would have got by now:
   * each turn costs what it costs in T-states (ScreenComposer.menuLoop), so
   * the ball bounces at the original's pace whatever the display's rate. A
   * tab that comes back from the background does not run off with it: at
   * most MENU_CATCH_UP turns at once.
   * @param {number} timestamp - The loop's time (ms).
   */
  turnMenuLoop(timestamp) {
    if (!this.menuState || !this.screenEntity) {
      return;
    }
    if (this.menuDue === false) {
      this.menuDue = timestamp;
    }
    var turns = 0;
    while (this.menuDue <= timestamp && turns < MenuModel.MENU_CATCH_UP) {
      this.menuDue += this.screenEntity.render.menuLoop(this.screenEntity.videoRAM, this.menuState)/3500;
      turns++;
    }
    if (this.menuDue <= timestamp) {
      this.menuDue = timestamp;
    }
    if (turns) {
      this.screenEntity.invalidate();
    }
  } // turnMenuLoop

} // MenuModel

/**
 * The items on the six discs of the menu room, choices 0-5 (cells
 * `$42`-`$47`, BobbyLogic.MENU_PATCH): the name shown while the ball is on
 * the disc and the event it opens. START GAME is the arrow.
 */
MenuModel.ITEMS = [
  {label: 'PLAYER NAME', event: 'setPlayerName'},
  {label: 'HALL OF FAME', event: 'showHallOfFame'},
  {label: 'SOUNDS', event: 'setSounds'},
  {label: 'SETTINGS', event: 'setSettings'},
  {label: 'SHOW TAPE LOADING', event: 'startTapeLoading'},
  {label: 'ABOUT GAME', event: 'showAbout'}
];

/** the credit down the right edge of the menu, two lines */
MenuModel.CREDIT = 'REMAKE BY L. MITRENGA\nCC BY-NC-SA 4.0';

/** the text in the place of the item names until the first direction pressed */
MenuModel.HINT = 'USE ARROWS TO SELECT';

/** the width of the version under BEARING in cells: v2026.10.29 and one spare */
MenuModel.VERSION_CELLS = 12;

/** ★ the effect played as the sample of SOUNDS: 5, the room change ($7856) */
MenuModel.SAMPLE_EFFECT = 5;

/** the ball's first row (line of the buffer, the original starts at 4), above the screen */
MenuModel.BALL_START = -32;

/** turns of the menu loop made up at once after a stall, at most */
MenuModel.MENU_CATCH_UP = 4;
