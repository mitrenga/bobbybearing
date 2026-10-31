const { FramedPanelEntity } = await import('./framedPanelEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { KeyboardEntity } = await import('./svision/js/platform/canvas2D/keyboardEntity.js?ver='+window.srcVersion);
// begin code

/**
 * A dialog of svision (PLAYER NAME — ZXPlayerNameEntity, SOUNDS —
 * ZXVolumeEntity, SETTINGS — ZXSettingsEntity) in the window of ABOUT GAME
 * (operator 2026-10-31): the remake's framed panel (framedPanelEntity.js),
 * the title as the heading on its frame and the contents the factory makes
 * for it, laid out for the panel. Every
 * button in it rounds its corners like those of ABOUT GAME (BUTTON_CORNER)
 * — the buttons of the dialogs the contents open later (REMAP … KEYS) too,
 * the keys of PLAYER NAME's keyboard not (operator 2026-10-31): svision's
 * dialogs have no option for it, so the panel sets the mask on the buttons
 * of its whole tree before it draws (roundButtons). The contents closing
 * themselves (CLOSE, Escape: 'contentClosed') close the panel.
 *
 * The contents get the panel a pixel shorter (`contentHeight`): svision
 * puts CLOSE 2 px above their bottom, ABOUT GAME 3 px above the panel's
 * (operator 2026-10-31).
 */
export class FramedDialogEntity extends FramedPanelEntity {

  /**
   * @param {AbstractEntity} parentEntity - The desktop of the menu.
   * @param {number} x - The x of the panel.
   * @param {number} y - The y of the panel.
   * @param {number} width - The width of the panel.
   * @param {number} height - The height of the panel.
   * @param {string} title - The heading on the frame.
   * @param {Function} contentFactory - Called with the panel, returns the contents at innerX, innerY in innerWidth x contentHeight.
   */
  constructor(parentEntity, x, y, width, height, title, contentFactory) {
    super(parentEntity, x, y, width, height);
    this.id = 'FramedDialogEntity';

    this.title = title;
    this.contentFactory = contentFactory;
    this.contentHeight = this.innerHeight-1;
    this.contentEntity = null;
  } // constructor

  init() {
    super.init();

    this.contentEntity = this.contentFactory(this);
    this.addEntity(this.contentEntity);

    this.addTitle(this.title);
  } // init

  /**
   * The corners of BUTTON_CORNER on every button under the entity, the keys
   * of a keyboard left square.
   * @param {AbstractEntity} entity - Where to start.
   */
  roundButtons(entity) {
    entity.entities.forEach((child) => {
      if (child instanceof KeyboardEntity) {
        return;
      }
      if (child instanceof ButtonEntity) {
        child.cornerMask = FramedPanelEntity.BUTTON_CORNER;
      }
      this.roundButtons(child);
    });
  } // roundButtons

  /**
   * The contents tick on their own (SETTINGS polls the gamepads — they send
   * no events — and slides the gamepad's name); the menu ticks its modal,
   * this panel, so it passes the tick on as svision's DialogEntity does.
   * @param {number} timestamp - The current frame timestamp.
   */
  loopEntity(timestamp) {
    if (this.contentEntity) {
      this.contentEntity.loopEntity(timestamp);
    }
  } // loopEntity

  drawEntity() {
    if (this.contentEntity) {
      this.roundButtons(this.contentEntity);
    }
    super.drawEntity();
  } // drawEntity

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    if (event.id == 'contentClosed' && event.entity === this.contentEntity) {
      this.destroy();
      return true;
    }

    return false;
  } // handleEvent

} // FramedDialogEntity
