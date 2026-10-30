const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { ZXPlayerNameEntity } = await import('./svision/js/platform/canvas2D/zx/zxPlayerNameEntity.js?ver='+window.srcVersion);
const { ZXVolumeEntity } = await import('./svision/js/platform/canvas2D/zx/zxVolumeEntity.js?ver='+window.srcVersion);
const { ZXSettingsEntity } = await import('./svision/js/platform/canvas2D/zx/zxSettingsEntity.js?ver='+window.srcVersion);
const { ZXWaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/zx/zxWaitForAudioEventEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ZXDialogEntity } = await import('./svision/js/platform/canvas2D/zx/zxDialogEntity.js?ver='+window.srcVersion);
const { ZXDialogProperties } = await import('./svision/js/platform/canvas2D/zx/zxDialogProperties.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * Main menu, the same structure as the other ZX remakes, laid out over the
 * original's own opening screen.
 *
 * ★ The screen under it is the original's opening screen composed out of the
 * program — the packed picture at $DA30 unpacked as `$D9D8` does it
 * (ScreenComposer.composeTitle, tools/matchscreen.mjs). The original's own
 * choice there is the controls (`6` / `7`, under the logo) and `0` starts.
 * The remake's menu is a window over that lower part in the opening screen's
 * colours — bright white and bright yellow on black, the cyan of the
 * selector box for the bar — and in the ROM font (ScreenLayout.MENU_WINDOW).
 * Its size and place are the remake's.
 *
 * ★ What the original does **not** offer: a two-player game.
 *
 * ★ The ball in the „O" bounces as in the original: the menu loop `$D6D0`
 * without a key (ScreenComposer.menuLoop — `$D90A` every other turn,
 * `$D9B6` onto the screen), turned over the screen's video memory from
 * loopModel at the original's own pace: the loop runs in DI and a turn is
 * its `LDIR` of 2000 bytes plus the work, 68 280 / 90 586 T measured
 * (tools/tracemenu.py, checked by tools/matchmenu.mjs). The selector of
 * the controls under the logo stands still and lies under the window.
 *
 * There is **one volume** (SOUNDS): one bus, one slider, one AudioContext
 * (R-024).
 *
 * The menu itself never touches the audio buses; items that need sound go
 * through ZXWaitForAudioEventEntity first when the browser wants a user
 * gesture.
 */
export class MenuModel extends AbstractModel {

  constructor(app, selectionItem) {
    super(app);
    this.id = 'MenuModel';

    // ★ bright white on black like the opening screen ($47)
    var item = ZXColor.brightWhite;
    this.menuItems = [
      {t1: 'START GAME', event: {id: 'startGame', players: 1}, penColor: item},
      {t1: 'PLAYER NAME', event: {id: 'setPlayerName'}, penColor: item},
      {t1: 'HALL OF FAME', event: {id: 'showHallOfFame'}, penColor: item},
      {t1: 'SOUNDS', event: {id: 'setSounds'}, penColor: item},
      {t1: 'SETTINGS', event: {id: 'setSettings'}, penColor: item},
      {t1: 'LOAD TAPE', event: {id: 'startTapeLoading'}, penColor: item},
      {t1: 'ABOUT GAME', event: {id: 'showAbout'}, penColor: item}
    ];
    this.menuOptions = {
      // ★ the game's own font (gameApp.gameFont: $F70C out of the program),
      // fixed width, so that the text sits on the character cells like on
      // the machine (operator 2026-10-30)
      fonts: this.app.gameFont(),
      // one item a row from row 15, column 6 (ScreenLayout.MENU_ITEMS)
      leftMargin: 0,
      rightMargin: 0,
      topMargin: 0,
      itemHeight: 8,
      itemPitch: 8,
      t1LeftMargin: 0,
      t1TopMargin: 0,
      t2Width: 64,
      t2RightMargin: 0,
      t2TopMargin: 0,
      textColor: ZXColor.brightWhite,
      // the bar is the cyan of the original's selector box ($45)
      selectionTextColor: ZXColor.black,
      selectionBarColor: ZXColor.brightCyan,
      hoverColor: '#333333ff',
      selectionHoverColor: ZXColor.cyan,
      clickColor: '#444444ff',
      selectionClickColor: ZXColor.cyan,
      selection: selectionItem
    };
    // the dialogs opened from the menu look like the ABOUT GAME panel
    // (aboutModel.js): a black window with the title in bright red over the
    // menu window. The
    // contents come from svision and are laid out for 200 x 124 px; the
    // window has no frame, only the title bar, so they get 192 x 117 — the
    // right edge of the volume panel (MAX, +) and of the keyboard loses up to
    // 6 px. It fills cells 4-27 in width, from y 50 down to 176, where the
    // version line starts. What is not set here is the default of
    // ZXDialogProperties (the look of Manic Miner)
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
    this.versionEntity = null;
    this.menuEntity = null;
    this.newVersionAvailable = false;
    // the window of the dialog open from the menu (openDialog), while it lasts
    this.dialogEntity = null;
    // the game's own picture under the menu (GameAreaEntity.panelScreen)
    this.screenEntity = null;
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

    // ★ the original's opening screen with the menu window over it
    // (ScreenComposer.composeMenu)
    this.screenEntity = GameAreaEntity.panelScreen(this, true);
    if (this.screenEntity && this.screenEntity.render) {
      this.menuState = this.screenEntity.render.menuStart();
    }
    if (!this.screenEntity) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'BOBBY BEARING', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/screen.json). RUN tools/mksnapshot.sh AND tools/mkscreen.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
    }
    var items = ScreenLayout.MENU_ITEMS;
    var w = ScreenLayout.MENU_WINDOW;
    // no heading in the window: the logo above it is the name of the game
    // (operator 2026-10-30)
    this.menuEntity = new MenuEntity(this.desktopEntity, items.col*8, items.row*8, (w.cols-4)*8, this.menuItems.length*items.pitch*8, ZXColor.white, this.menuOptions, this, this.getMenuData);
    this.desktopEntity.addEntity(this.menuEntity);

    // the version, centred in the ZX font on the bottom row; still a button,
    // because a newer version on the server turns it into UPGRADE !
    var versionText = 'v'+this.app.version;
    var versionWidth = 14*8;                            // fourteen cells, centred
    this.versionEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, (this.desktopWidth-versionWidth)/2, ScreenLayout.MENU_VERSION_ROW*8, versionWidth, 8, versionText, {id: 'upgradeApp'}, [], ZXColor.white, ZXColor.black, {align: 'center'});
    this.desktopEntity.addEntity(this.versionEntity);
    // suppress the hover/click colors resolved in init(), so the button always
    // looks like plain text
    this.versionEntity.hoverColor = false;
    this.versionEntity.clickColor = false;
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

    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // init


  checkServerVersion() {
    var receiver = {
      id: this.id+'Version',
      fetchDataId: '',
      setData: (data) => {
        if (data.data.version && data.data.version !== 'unknown' && data.data.version !== this.app.version) {
          this.newVersionAvailable = true;
          // not over the copyright line of an open dialog; showVersion() puts
          // UPGRADE ! there when the dialog closes
          if (this.dialogEntity === null) {
            this.showVersion();
          }
        }
      },
      errorData: () => {}
    };
    receiver.fetchDataId = this.app.fetchData('version.db', false, {}, receiver);
  } // checkServerVersion

  getMenuData(self, key, row) {
    switch (key) {

      case 'numberOfItems':
        return self.menuItems.length;

      case 't2':
        switch (row) {
          case 1:
            return self.app.playerName;
          case 3:
            return self.volumeText(self.app.audioManager.volume.sounds);
        }
        break;

      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;

    }
    return '';
  } // getMenuData

  volumeText(volume) {
    switch (volume) {
      case 0:
        return 'OFF';
      case 10:
        return 'MAX';
    }
    return (volume*10)+'%';
  } // volumeText

  /**
   * Opens a dialog from the menu: the window with the title (ZXDialogEntity)
   * over the middle of the screen, placed and coloured by the dialog
   * properties, and the contents the factory makes for it, as the modal of
   * the desktop.
   * @param {string} title - The text of the title bar.
   * @param {Function} contentFactory - Called with the window, returns the contents entity.
   */
  openDialog(title, contentFactory) {
    var p = this.dialogProperties;
    this.dialogEntity = new ZXDialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, title, p, contentFactory);
    this.desktopEntity.addModalEntity(this.dialogEntity);
  } // openDialog

  /**
   * Puts the version back on the bottom band: the version number, or UPGRADE !
   * in red when the server has a newer one.
   */
  showVersion() {
    if (this.newVersionAvailable) {
      this.versionEntity.setText('UPGRADE !');
      this.versionEntity.setPenColor(ZXColor.brightRed);
    } else {
      this.versionEntity.setText('v'+this.app.version);
      this.versionEntity.setPenColor(ZXColor.white);
    }
  } // showVersion

  /**
   * Asks for the browser's gesture for audio before an action that plays
   * sound: ZXWaitForAudioEventEntity in a window without a title, centred on
   * the screen, coloured by the `waitForAudioEvent` dialog properties.
   * @param {string} continueEvent - The event sent when the gesture comes.
   */
  openWaitForAudioEvent(continueEvent) {
    var p = this.dialogProperties.waitForAudioEvent;
    this.desktopEntity.addModalEntity(new ZXDialogEntity(this.desktopEntity, 66, 77, 124, 41, false, p, (dialog) => new ZXWaitForAudioEventEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, continueEvent, p)));
  } // openWaitForAudioEvent

  handleEvent(event) {
    // the dialog's window closing — the desktop removes it in super.handleEvent
    // and returns true, so the version has to come back before that
    if (event.id == 'destroy' && event.entity === this.dialogEntity) {
      this.dialogEntity = null;
      this.showVersion();
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
        // ? the sample is the machine's key click, because the game's own
        // sounds are M6 and there is nothing of the original to play yet
        // (audioManager.js). When M6 reads them, one of them takes this place.
        this.openDialog('SOUNDS', (dialog) => new ZXVolumeEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'sounds', 'audioBusSoundsLevel', 'keyboardSound', this.dialogProperties));
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
    } else if (this.menuEntity) {
      // a player's name too long for its column ping-pongs
      this.menuEntity.loopEntity(timestamp);
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

/** turns of the menu loop made up at once after a stall, at most */
MenuModel.MENU_CATCH_UP = 4;
