const { FramedPanelEntity } = await import('./framedPanelEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { GameScore } = await import('./gameScore.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
// begin code

/**
 * The pause panel of the remake: RESUME GAME / SOUNDS / EXIT GAME.
 *
 * ★ The original pauses on `P` (its SET KEYS window, disasm_notes.md §3).
 * ? What it shows while it waits is M4. The panel here is the remake's own,
 * like the main menu; `P`, Escape and a tab that loses focus open it,
 * because a browser game has to stop somewhere (ZADANI chap. 10).
 *
 * The window is the remake's framed panel (framedPanelEntity.js, operator
 * 2026-10-31): the black panel, bright white text, the selected item on
 * a bright cyan bar, the heading on the frame as in ABOUT GAME.
 */
export class PauseGameEntity extends FramedPanelEntity {

  constructor(parentEntity, x, y, width, height, title, exitModel) {
    super(parentEntity, x, y, width, height);
    this.id = 'PauseGameEntity';


    this.title = title;
    this.exitModel = exitModel;
    this.menuItems = [
      {t1: 'RESUME GAME', event: {id: 'closePauseGame'}},
      {t1: 'SOUNDS', event: {id: 'changeSoundsState'}},
      {t1: 'EXIT GAME', event: {id: 'exitGame'}}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.zxFonts8x8Menu,
      leftMargin: 9,
      rightMargin: 9,
      topMargin: 8,
      itemHeight: 12,
      t1LeftMargin: 3,
      t1TopMargin: 2, 
      t2Width: 114,
      t2RightMargin: 3,
      t2TopMargin: 2, 
      textColor: ZXColor.brightWhite,
      selectionTextColor: ZXColor.black,
      selectionBarColor: ZXColor.brightCyan,
      hoverColor: '#ffffff1e',
      selectionHoverColor: '#82e8fdff',
      clickColor: '#ffffff2e',
      selectionClickColor: '#b8f2feff'
    }
  } // constructor

  init() {
    super.init();

    var x = this.innerX, y = this.innerY, w = this.innerWidth, h = this.innerHeight;
    // the items in the remake's font (gameApp.js zxFonts8x8Menu, operator
    // 2026-10-31), the score below stays 5x5
    this.addEntity(new MenuEntity(this, x+1, y+1, w-2, h-2, false, this.menuOptions, this, this.getMenuData));
    // M7: brothers and rooms under the items (operator 2026-10-30: the
    // score shows in the pause too, without the time — the panel's clock
    // is on the screen), as the worker last sent them
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, x+1, y+h-14, w-2, 9, GameScore.text(this.app.score), ZXColor.brightWhite, false, {align: 'center', margin: 2}));

    // the heading on the frame, as in ABOUT GAME
    this.addTitle(this.title);
  } // init

  /**
   * The heading of the frame (FramedPanelEntity.titleEvent) a pixel higher
   * (operator 2026-10-31).
   * @param {string} text - The heading.
   * @returns {Object} The 'updateEntity' event of the heading.
   */
  titleEvent(text) {
    var event = super.titleEvent(text);
    event.y--;
    return event;
  } // titleEvent

  getMenuData(self, key, row) {
    switch (key) {
      
      case 'numberOfItems':
        return self.menuItems.length;

      case 't2':
        switch (row) {
          case 1:
            return self.app.muted.sounds ? 'MUTE' : 'ON';
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

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'keyPress':
        switch (event.key) {
          case 'Escape':
            this.sendEvent(-1, 1, {id: 'continueGame'});
            this.destroy();
            return true;
        }
        break;

      case 'closePauseGame':
        this.sendEvent(-1, 1, {id: 'continueGame'});
        this.destroy();
        return true;
        
      case 'changeSoundsState':
        this.app.muted.sounds = !this.app.muted.sounds;
        AudioManager.BUSES.forEach((bus) => {
          this.sendEvent(0, 0, {id: 'muteAudioBus', bus: bus, muted: this.app.muted.sounds});
        });
        this.sendEvent(1, 0, {id: 'refreshMenu'});
        return true;

      case 'exitGame':
        this.app.setModel(this.exitModel);
        return true;
    }

    return false;
  } // handleEvent

} // PauseGameEntity
