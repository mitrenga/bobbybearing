const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * ABOUT GAME as a modal panel over the menu, where its dialogs open
 * (menuModel.js) — the menu keeps turning under it, as under SETTINGS.
 *
 * ? **Silent until M6.** Whether the original has a tune is not measured,
 * and nothing is played in its place.
 *
 * The title bar keeps the dialog's counter: five clicks on it show the game
 * statistics from the server, five more the system information, five more the
 * text again. CLOSE (Escape, GamepadExit) closes the panel, MORE INFO
 * (Enter, GamepadOK) opens the about page.
 *
 * The window has a bright red frame 3 px wide round the panel (FRAME) with
 * rounded corners (CORNER, the top left one; the others mirrored). The x, y,
 * width and height given are those of the panel; the entity grows by the
 * frame around it. The heading sits on the bottom of the frame at the right,
 * bright cyan on black in the menu's font (gameApp.js zxFonts8x8Menu).
 */
export class AboutEntity extends AbstractEntity {

  /** the frame round the panel: the sides and the top and the bottom, in px */
  static get FRAME() { return {x: 3, y: 3}; }

  /** the top left corner of the frame, `#` the frame; `-` outside it is see-through, inside it the panel */
  static get CORNER() { return ['----#',
                                '--###',
                                '-####',
                                '-###-',
                                '###--']; }

  /** the top left corner of the buttons (ButtonEntity cornerMask) */
  static get BUTTON_CORNER() { return ['---#',
                                       '-###',
                                       '-###',
                                       '####']; }

  constructor(parentEntity, x, y, width, height) {
    var f = AboutEntity.FRAME;
    super(parentEntity, x-f.x, y-f.y, width+2*f.x, height+2*f.y, false, false);
    this.frameColor = ZXColor.brightRed;
    this.id = 'AboutEntity';

    this.panelBkColor = ZXColor.black;

    this.aboutText = 'BOBBY BEARING IS A REMAKE OF THE 1986 GAME BY ROBERT AND TREVOR FIGGINS, PUBLISHED BY THE EDGE FOR THE ZX SPECTRUM.\n' +
                    'IT IS ONE OF THE BEST LOOKING GAMES ON THE ZX SPECTRUM.\n' +
                    'BOBBY IS A STEEL BALL WHO ROLLS OVER THE CURVED SURFACES OF THE METAPLANES TO PUSH HIS FOUR ' +
                    'STUNNED BROTHERS BACK HOME BEFORE THE TIME RUNS OUT - AND THEN HIS ROGUE COUSIN, WHO LED THEM ASTRAY.\n' +
                    'THE HIGH SCORES ARE KEPT IN THE HALL OF FAME ON THE SERVER.';
    this.statsText = 'error:\nstatistics data not available!';
    this.clickCounter = 0;
    this.titleEntity = null;
    // the heading reaches out of the entity under the frame line
    this.clipsChildren = false;
  } // constructor

  init() {
    super.init();

    // the panel inside the frame, the rest on it
    var f = AboutEntity.FRAME;
    var w = this.width-2*f.x, h = this.height-2*f.y;
    var panel = new AbstractEntity(this, f.x, f.y, w, h, false, this.panelBkColor);
    this.addEntity(panel);
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, f.x+1, f.y+1, w-2, h-17, this.aboutText, ZXColor.brightWhite, false, {align: 'justify', textWrap: true, margin: 2, member: 'aboutText'}));
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, f.x+3, f.y+h-16, 54, 13, 'MORE INFO', {id: 'openAboutURL'}, ['Enter', 'GamepadOK'], ZXColor.brightWhite, ZXColor.green, {align: 'center', margin: 4, cornerMask: AboutEntity.BUTTON_CORNER}));
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, f.x+w-39, f.y+h-16, 36, 13, 'CLOSE', {id: 'closeAbout'}, ['Escape', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4, cornerMask: AboutEntity.BUTTON_CORNER}));

    // the heading on black, as wide as its text and a pixel on either side; drawn over the frame (drawEntity)
    this.titleEntity = new ButtonEntity(this, this.app.fonts.zxFonts8x8Menu, 0, 0, 0, 8, '', {id: 'clickLabel'}, [], ZXColor.brightCyan, ZXColor.black, {leftMargin: 1, member: 'titleBar'});
    this.addEntity(this.titleEntity);
    // a plain heading to look at: no hover or click colours (the clicks still
    // count, see updateAbout)
    this.titleEntity.hoverColor = false;
    this.titleEntity.clickColor = false;
    this.sendEvent(1, 0, this.titleEvent('ABOUT GAME'));

    this.fetchData('stats.db', false, {});
  } // init

  /**
   * Places the heading for its text: as wide as the text and one pixel of
   * black on either side of it (the proportional font cuts the glyphs to
   * their pixels), the right edge 1 px off the corner
   * (CORNER), the 8 rows over the 3 of the bottom frame, a row lower than
   * centred.
   * @param {string} text - The heading.
   * @returns {Object} The 'updateEntity' event of the heading.
   */
  titleEvent(text) {
    var f = AboutEntity.FRAME, width = this.titleEntity.lineWidth(text)+2;
    return {id: 'updateEntity', member: 'titleBar', text: text,
      x: this.width-AboutEntity.CORNER.length-1-width, y: this.height-f.y+Math.floor((f.y-8)/2)+1, width: width};
  } // titleEvent

  /**
   * The contents, then the frame over them — its corners round off the
   * panel — and the heading over the frame.
   */
  drawEntity() {
    if (this.hide == true) {
      return;
    }
    this.drawSubEntities();

    var f = AboutEntity.FRAME, corner = AboutEntity.CORNER, size = corner.length;
    var w = this.width, h = this.height;
    var paint = (x, y, width, height) => this.app.layout.paint(this, x, y, width, height, this.frameColor);
    paint(size, 0, w-2*size, f.y);
    paint(size, h-f.y, w-2*size, f.y);
    paint(0, size, f.x, h-2*size);
    paint(w-f.x, size, f.x, h-2*size);
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        if (corner[row][col] == '#') {
          paint(col, row, 1, 1);
          paint(w-1-col, row, 1, 1);
          paint(col, h-1-row, 1, 1);
          paint(w-1-col, h-1-row, 1, 1);
        }
      }
    }
    if (this.titleEntity && !this.titleEntity.hide) {
      this.drawSubEntity(this.titleEntity);
    }
  } // drawEntity

  setData(data) {
    this.statsText = '';
    Object.entries(data.data).forEach(([periodKey, periodValue]) => {
      this.statsText += periodKey + ': [';
      Object.entries(periodValue).forEach(([key, value]) => {
        this.statsText += key + ':' + value + ', ';
      });
      this.statsText = this.statsText.slice(0, -2) + ']\n';
    });
  } // setData

  errorData(error) {
  } // errorData

  /**
   * Switches the panel between the about text, the statistics and the system
   * information, by the count of clicks on the title bar.
   * @returns {void}
   */
  updateAbout() {
    switch (Math.floor(this.clickCounter/5)) {
      case 1:
        this.sendEvent(1, 0, this.titleEvent('GAME STATS'));
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'aboutText', text: this.statsText});
        break;
      case 2:
        this.sendEvent(1, 0, this.titleEvent('SYSTEM INFO'));
        var ipLabelSeparator = ' ';
        if (window.clientIP.indexOf(':') >= 0) {
          ipLabelSeparator = '\n';
        }
        var sysInfoText =
          'version: ' + this.app.version + '\n' +
          'element: ' + this.app.element.clientWidth + ' x ' + this.app.element.clientHeight + '\n' +
          'canvas: ' + this.app.element.width + ' x ' + this.app.element.height + '\n' +
          'ratio: ' + this.app.layout.ratio + '\n' +
          'ip:' + ipLabelSeparator + window.clientIP + '\n';
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'aboutText', text: sysInfoText});
        break;
      default:
        this.sendEvent(1, 0, this.titleEvent('ABOUT GAME'));
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'aboutText', text: this.aboutText});
        break;
    }
  } // updateAbout

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'closeAbout':
        this.destroy();
        return true;

      case 'openAboutURL':
        window.location.href = 'about';
        return true;

      case 'clickLabel':
        if (this.clickCounter < 14) {
          this.clickCounter++;
        } else {
          this.clickCounter = 0;
        }
        if (this.clickCounter%5 == 0) {
          this.updateAbout();
        }
        return true;

      case 'resizeModel':
        if (this.clickCounter > 9) {
          this.updateAbout();
        }
        return false;

    }

    return false;
  } // handleEvent

} // AboutEntity
