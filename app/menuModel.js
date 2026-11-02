const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXPlayerNameEntity } = await import('./svision/js/platform/canvas2D/zx/zxPlayerNameEntity.js?ver='+window.srcVersion);
const { ZXSettingsEntity } = await import('./svision/js/platform/canvas2D/zx/zxSettingsEntity.js?ver='+window.srcVersion);
const { ZXWaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/zx/zxWaitForAudioEventEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ZXDialogEntity } = await import('./svision/js/platform/canvas2D/zx/zxDialogEntity.js?ver='+window.srcVersion);
const { ZXDialogProperties } = await import('./svision/js/platform/canvas2D/zx/zxDialogProperties.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { HallOfFameEntity } = await import('./hallOfFameEntity.js?ver='+window.srcVersion);
const { AboutEntity } = await import('./aboutEntity.js?ver='+window.srcVersion);
const { FramedDialogEntity } = await import('./framedDialogEntity.js?ver='+window.srcVersion);
const { ZXVolumeEntity } = await import('./svision/js/platform/canvas2D/zx/zxVolumeEntity.js?ver='+window.srcVersion);
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

    // the dialogs of svision opened from the menu (PLAYER NAME, SOUNDS,
    // SETTINGS) are in the window of ABOUT GAME (openFramedDialog,
    // framedDialogEntity.js) with the theme, the remap dialog and the gesture
    // popup from here; x, y, width and height are where the panels go from
    // (openPanel). What is not set here is the default of ZXDialogProperties
    // (the look of Manic Miner)
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
        // PLAYER NAME's prompt and input in the menu's font (gameApp.js
        // zxFonts8x8Menu, operator 2026-10-31); the default ZX keyboard
        // (194 px) fits the panel (222 px)
        inputFont: 'zxFonts8x8Menu',
        keyboardButtonsBkColor: ZXColor.brightYellow
      },
      // the remap dialog covers the contents of the SETTINGS panel
      // (framedDialogEntity.js, the geometry left false): no frame, black
      // panel, its title in bright red, the same colours inside
      remapKeys: {
        x: false,
        y: false,
        width: false,
        height: false,
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
    this.itemColors = null;
    this.discTaken = false;
    // the item of the disc under the ball in the last frame, or none: Enter
    // opens it as left or right on the disc does
    this.ballItem = null;
    // back from SHOW TAPE LOADING (app.menuResume, once): the ball comes
    // where it was and the hint has been read
    this.resume = app.menuResume === true;
    app.menuResume = false;
    // a direction pressed since the menu came: until then the place of the
    // item names shows how to choose (MenuModel.HINT)
    this.ballMoved = this.resume;
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
      // in the menu's font, close to the game's own (gameApp.js zxFonts8x8Menu);
      // a button, because a click on the name opens the item as Enter does;
      // with no background of its own it hovers and clicks in the platform's
      // colours of a button on black (ZXPlatform), the black under it; its
      // right edge two pixels right of the cells, on the optical edge of the
      // lettering BOBBY BEARING (operator 2026-10-31); the button reaches
      // ITEM_MARGINS beyond the lettering on every side, a bigger area to
      // press (operator 2026-11-02): its right edge and its row are set so
      // that the glyphs stand where they stood with a margin of one pixel
      var buttonColors = this.app.stack.ButtonEntity;
      this.itemColors = {hover: buttonColors.hoverColor[ZXColor.black], click: buttonColors.clickColor[ZXColor.black]};
      var margins = MenuModel.ITEM_MARGINS;
      this.itemEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, 0, this.desktopHeight-8-margins.top, this.desktopWidth-4*8+2+margins.right-1, 8+margins.top+margins.bottom, '', {id: 'openBallItem'}, [], ZXColor.brightCyan, false,
        {align: 'left', leftMargin: margins.left, rightMargin: margins.right, topMargin: margins.top, bottomMargin: margins.bottom, hoverColor: this.itemColors.hover, clickColor: this.itemColors.click});
      this.desktopEntity.addEntity(this.itemEntity);
      this.showItem();
      // the version under BEARING, its right edge on the end of the lettering
      // (column 29 of the screen, less the columns MENU_TITLE leaves out), in the
      // menu's font, a pixel right of it to meet the lettering optically
      // (operator 2026-10-31); a button, because a newer version on the
      // server turns it into UPGRADE !
      var versionWidth = MenuModel.VERSION_CELLS*8;
      this.versionEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, (30-ScreenLayout.MENU_TITLE.col)*8-versionWidth+1, ScreenLayout.MENU_ROOM_ROW*8, versionWidth, 8, '', {id: 'upgradeApp'}, [], ZXColor.yellow, false, {align: 'right'});
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
      this.app.startWorkerSession({
        mode: 'menu',
        // back from SHOW TAPE LOADING: the ball where it was
        resume: this.resume,
        headless: false,
        world: files.world,
        memory: files.memory
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
      // a ball rolled to a click or a touch only stops on the disc: the
      // direction it took the disc with was the worker's, not the player's
      if (item && data.menu.taken && !data.menu.steered && !this.discTaken && !this.desktopEntity.modalEntity) {
        this.sendEvent(0, {id: item.event});
      }
      this.discTaken = data.menu.taken;
    }
  } // handleWorkerMessage

  /**
   * The value an item shows after its name: the player's name for PLAYER
   * NAME when there is one, the volume for SOUNDS (`audioBusSoundsLevel`,
   * 0-10, as the dialog words it: OFF, 10%..90%, MAX).
   * @param {Object} item - An entry of MenuModel.ITEMS.
   * @returns {string|boolean} The value, or false for none.
   */
  itemValue(item) {
    switch (item.event) {
      case 'setPlayerName':
        return this.app.playerName.length ? this.app.playerName : false;
      case 'setSounds':
        return this.app.audioManager ? ZXVolumeEntity.levelText(this.app.audioManager.volume.sounds) : false;
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
    // the button as wide as the text and its margins on either side of it
    // (the proportional font cuts the glyphs to their pixels; the hover
    // colour shows them), its right edge where it stands: only a click on
    // the name opens the item
    var right = this.itemEntity.x+this.itemEntity.width;
    this.itemEntity.width = text.length ? this.itemEntity.lineWidth(text)+MenuModel.ITEM_MARGINS.left+MenuModel.ITEM_MARGINS.right : 1;
    this.itemEntity.x = right-this.itemEntity.width;
    this.itemEntity.hide = !text.length;
    // the hint (MenuModel.HINT) is plain text: no hover or click colours
    this.itemEntity.hoverColor = item ? this.itemColors.hover : false;
    this.itemEntity.clickColor = item ? this.itemColors.click : false;
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

  /**
   * All directions let go and the ball's target dropped: a dialog takes the
   * keys, their release would not come.
   */
  releaseControls() {
    Object.keys(this.controlsState).forEach((action) => this.setControl(action, false));
    this.sendWorkerMessage({id: 'target'});
  } // releaseControls

  /**
   * A click or a touch in the menu room: the ball rolls to it (the worker's
   * steerToTarget — the column first, then the line), on a disc it only
   * stops. A direction pressed takes over.
   * @param {Object} event - The keyPress of Mouse1 or Touch (x, y).
   * @returns {boolean} Whether the point is in the room.
   */
  rollBallTo(event) {
    if (!this.roomEntity || this.desktopEntity.modalEntity || !this.roomEntity.pointOnEntity(event)) {
      return false;
    }
    // the point in the room's coordinates; in the dead zone around the
    // item's button (MenuModel.DEAD_ZONE) the ball stays: a press meant for
    // the button must not roll it (operator 2026-11-02)
    var x = event.x-this.roomEntity.parentX-this.roomEntity.x;
    var y = event.y-this.roomEntity.parentY-this.roomEntity.y;
    var zone = MenuModel.DEAD_ZONE;
    if (x >= zone.x && y+ScreenLayout.MENU_ROOM_ROW*8 >= zone.y) {
      return true;
    }
    this.ballMoved = true;
    this.showItem(this.ballItem || undefined);
    this.sendWorkerMessage({
      id: 'target',
      x: x,
      y: y+ScreenLayout.MENU_ROOM.row*8
    });
    return true;
  } // rollBallTo

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
   * A panel of the remake's own (HALL OF FAME, ABOUT GAME and the dialogs
   * of openFramedDialog — framedPanelEntity.js) as a modal over the menu:
   * the menu ticks it and turns on under it. All take the same place: 25 px
   * left of the dialog properties' x, 13 px lower, 30 px wider and 3 px
   * shorter (operator 2026-10-31), the frame round it.
   * @param {Function} PanelEntity - HallOfFameEntity, AboutEntity or FramedDialogEntity.
   * @param {...*} args - What the panel takes after its place and size.
   */
  openPanel(PanelEntity, ...args) {
    this.releaseControls();
    var p = this.dialogProperties;
    this.desktopEntity.addModalEntity(new PanelEntity(this.desktopEntity, p.x-25, p.y+13, p.width+30, p.height-3, ...args));
  } // openPanel

  /**
   * A dialog of svision in the window of ABOUT GAME (framedDialogEntity.js):
   * the panel of openPanel, the title on its frame, the contents the factory
   * makes for it.
   * @param {string} title - The heading on the frame.
   * @param {Function} contentFactory - Called with the panel, returns the contents.
   */
  openFramedDialog(title, contentFactory) {
    this.openPanel(FramedDialogEntity, title, contentFactory);
  } // openFramedDialog

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
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'startGame':
        this.app.setPlayers(event.players);
        if (!this.app.playerName.length) {
          this.openFramedDialog('PLAYER NAME', (panel) => new ZXPlayerNameEntity(panel, panel.innerX, panel.innerY, panel.innerWidth, panel.contentHeight, true, this.dialogProperties));
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
        this.openFramedDialog('PLAYER NAME', (panel) => new ZXPlayerNameEntity(panel, panel.innerX, panel.innerY, panel.innerWidth, panel.contentHeight, false, this.dialogProperties));
        return true;

      case 'showHallOfFame':
        // a modal panel over the menu (hallOfFameEntity.js), so the menu keeps
        // turning under it; silent, so no gesture for audio is needed on the way
        this.openPanel(HallOfFameEntity);
        return true;

      case 'setSounds':
        // the sample is the game's room change (MenuModel.SAMPLE_EFFECT,
        // rendered by the worker in init), the key click until it comes; the
        // popup of the gesture for audio (PLAY SAMPLE) in the middle of the panel
        var sample = this.app.audioManager && this.app.audioManager.samples.roomSound ? 'roomSound' : 'keyboardSound';
        this.openFramedDialog('SOUNDS', (panel) => {
          var popup = this.dialogProperties.waitForAudioEvent;
          var properties = Object.assign({}, this.dialogProperties, {waitForAudioEvent: Object.assign({}, popup, {
            x: Math.floor((panel.innerWidth-popup.width)/2),
            y: Math.floor((panel.contentHeight-popup.height)/2)
          })});
          return new ZXVolumeEntity(panel, panel.innerX, panel.innerY, panel.innerWidth, panel.contentHeight, 'sounds', 'audioBusSoundsLevel', sample, properties);
        });
        return true;

      case 'setSettings':
        this.openFramedDialog('SETTINGS', (panel) => new ZXSettingsEntity(panel, panel.innerX, panel.innerY, panel.innerWidth, panel.contentHeight, this.app.controlsOptions, this.dialogProperties));
        return true;

      case 'startTapeLoading':
        if (this.app.inputEventsManager.needEventForAudio()) {
          this.openWaitForAudioEvent('startTapeLoading2');
          return true;
        }
      case 'startTapeLoading2':
        // the menu comes back with the ball where it is now (the worker keeps it)
        this.app.menuResume = true;
        this.app.setModel('TapeLoadingModel');
        return true;

      case 'showAbout':
        // a modal panel over the menu (aboutEntity.js), silent until M6
      case 'showAbout2':
        this.openPanel(AboutEntity);
        return true;

      case 'upgradeApp':
        if (this.newVersionAvailable) {
          this.app.upgradeApp();
        }
        return true;

      case 'openBallItem':
        // a click on the name of the item under the ball
        if (this.ballItem && !this.desktopEntity.modalEntity) {
          this.sendEvent(0, {id: this.ballItem.event});
        }
        return true;

      case 'keyPress':
        // Enter (and the gamepad's OK) opens the item under the ball
        if ((event.key == 'Enter' || event.key == 'GamepadOK') && this.ballItem && !this.desktopEntity.modalEntity) {
          this.sendEvent(0, {id: this.ballItem.event});
          return true;
        }
        // a click or a touch rolls the ball there
        if ((event.key == 'Mouse1' || event.key == 'Touch') && this.rollBallTo(event)) {
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
/**
 * The margins of the item's button (menu bottom right) around its lettering,
 * in pixels: the area to press beyond the glyphs (operator 2026-11-02; none
 * at the bottom, the button ends on the edge of the desktop).
 */
MenuModel.ITEM_MARGINS = {top: 4, left: 4, right: 4, bottom: 0};

/**
 * The dead zone around the item's button, in the desktop's pixels: from this
 * corner to the bottom right corner of the desktop a click or a touch does
 * not roll the ball (rollBallTo). Its top left corner stands clear of the
 * room's drawing: the arrow ends at x 181 / y 146, the discs run down the
 * left (x 89 at y 150); the size settled on screen (operator 2026-11-02).
 */
MenuModel.DEAD_ZONE = {x: 104, y: 162};

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

/** the text in the place of the item names until the first direction pressed or the first click */
MenuModel.HINT = 'USE ARROWS OR TOUCH';

/** the width of the version under BEARING in cells: v2026.10.29 and one spare */
MenuModel.VERSION_CELLS = 12;

/** ★ the effect played as the sample of SOUNDS: 5, the room change ($7856) */
MenuModel.SAMPLE_EFFECT = 5;

/** the ball's first row (line of the buffer, the original starts at 4), above the screen */
MenuModel.BALL_START = -32;

/** turns of the menu loop made up at once after a stall, at most */
MenuModel.MENU_CATCH_UP = 4;
