const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * The window of the remake's own panels over the menu — ABOUT GAME
 * (aboutEntity.js) and HALL OF FAME (hallOfFameEntity.js), operator
 * 2026-10-31: a black panel in a bright red frame 3 px wide (FRAME) with
 * rounded corners (CORNER, the top left one; the others mirrored), and the
 * heading on the bottom of the frame at the right, bright cyan on black in
 * the menu's font (gameApp.js zxFonts8x8Menu). The buttons of the panels
 * round their corners by BUTTON_CORNER (ButtonEntity cornerMask).
 *
 * The x, y, width and height given are those of the panel; the entity grows
 * by the frame around it. The contents go at `innerX`, `innerY` in
 * `innerWidth` x `innerHeight`.
 */
export class FramedPanelEntity extends AbstractEntity {

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
    var f = FramedPanelEntity.FRAME;
    super(parentEntity, x-f.x, y-f.y, width+2*f.x, height+2*f.y, false, false);
    this.id = 'FramedPanelEntity';

    this.frameColor = ZXColor.brightRed;
    this.panelBkColor = ZXColor.black;
    this.innerX = f.x;
    this.innerY = f.y;
    this.innerWidth = width;
    this.innerHeight = height;
    this.titleEntity = null;
    // the heading reaches out of the entity under the frame line
    this.clipsChildren = false;
  } // constructor

  init() {
    super.init();
    // the panel inside the frame, the contents on it
    this.addEntity(new AbstractEntity(this, this.innerX, this.innerY, this.innerWidth, this.innerHeight, false, this.panelBkColor));
  } // init

  /**
   * The heading on the frame: plain text, or with `event` a button without
   * hover or click colours (ABOUT GAME counts the clicks on it).
   * @param {string} text - The heading.
   * @param {Object|false} [event] - The event of a click on it, or false.
   */
  addTitle(text, event = false) {
    var font = this.app.fonts.zxFonts8x8Menu, options = {leftMargin: 1, member: 'titleBar'};
    if (event) {
      this.titleEntity = new ButtonEntity(this, font, 0, 0, 0, 8, '', event, [], ZXColor.brightCyan, ZXColor.black, options);
    } else {
      this.titleEntity = new TextEntity(this, font, 0, 0, 0, 8, '', ZXColor.brightCyan, ZXColor.black, options);
    }
    this.addEntity(this.titleEntity);
    // a heading to look at: no hover or click colours
    this.titleEntity.hoverColor = false;
    this.titleEntity.clickColor = false;
    this.sendEvent(1, 0, this.titleEvent(text));
  } // addTitle

  /**
   * Places the heading for its text: as wide as the text and one pixel of
   * black on either side of it (the proportional font cuts the glyphs to
   * their pixels), the right edge 1 px off the corner (CORNER), the 8 rows
   * over the 3 of the bottom frame, a row lower than centred.
   * @param {string} text - The heading.
   * @returns {Object} The 'updateEntity' event of the heading.
   */
  titleEvent(text) {
    var f = FramedPanelEntity.FRAME, width = this.titleEntity.lineWidth(text)+2;
    return {id: 'updateEntity', member: 'titleBar', text: text,
      x: this.width-FramedPanelEntity.CORNER.length-1-width, y: this.height-f.y+Math.floor((f.y-8)/2)+1, width: width};
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

    var f = FramedPanelEntity.FRAME, corner = FramedPanelEntity.CORNER, size = corner.length;
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

} // FramedPanelEntity
