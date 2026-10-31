const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
// begin code

/**
 * The screen: **all of it**, 256x192, panel included.
 *
 * ★ The play area is the whole screen and the panel is drawn over it
 * (sources/docs/screen_layout.md), so there is no boundary to split it at.
 *
 * The memory, the painting and the off-screen cache are svision's
 * {@link ZXVideoRAMEntity} (R-003, R-022). What is left here is feeding it
 * with a frame from the worker, which ScreenComposer turns into 6912 bytes.
 */
export class GameAreaEntity extends ZXVideoRAMEntity {

  /**
   * @param {AbstractEntity} parentEntity - The parent entity.
   * @param {number} x - X position relative to the parent.
   * @param {number} y - Y position relative to the parent.
   * @param {ScreenComposer} render - The shared renderer.
   * @param {Object} [area] - Only these character cells of the screen
   *        ({col, row, cols, rows}); the whole screen by default.
   */
  constructor(parentEntity, x, y, render, area) {
    super(parentEntity, x, y,
          area || {col: 0, row: 0, cols: ScreenLayout.COLS, rows: ScreenLayout.ROWS});
    this.id = 'GameAreaEntity';

    this.render = render;
    this.frameState = {};
  } // constructor

  /**
   * The screen the menu, the hall of fame and the about page sit on: ★ the
   * original's opening screen (ScreenComposer.clearScreen).
   * It is built by the same composer out of the same data.
   * @param {AbstractModel} model - The model that owns the desktop.
   * @param {Object} [area] - Only these character cells of the screen
   *        ({col, row, cols, rows}), shown from the top left of the desktop;
   *        the whole screen by default.
   * @param {Object} [scene] - data/screen.json when the caller has it
   *        (AbstractModel.loadDataFiles); read from localStorage otherwise.
   * @returns {ZXVideoRAMEntity|null} The screen, added to the desktop.
   */
  static panelScreen(model, area, scene) {
    if (scene === undefined) {
      scene = model.loadDataFile('screen');
    }
    if (!scene) {
      return null;
    }
    try {
      var render = new ScreenComposer(scene);
      var screen = new ZXVideoRAMEntity(model.desktopEntity, 0, 0, area);
      render.clearScreen(screen.videoRAM);
      screen.invalidate();
      // the composer stays with the screen: the menu turns the original's
      // loop over it (ScreenComposer.menuLoop)
      screen.render = render;
      model.desktopEntity.addEntity(screen);
      // under everything else on the desktop, also when the data came from
      // the server after the model had built the rest
      var entities = model.desktopEntity.entities;
      entities.unshift(entities.pop());
      return screen;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  } // panelScreen

  /**
   * Stores the newest frame and invalidates the cache.
   * @param {Object} state - The 'frame' message of the worker.
   */
  setFrame(state) {
    this.frameState = state;
    this.invalidate();
  } // setFrame

  /**
   * Composes the screen. Called only when the cache is dirty, so the pixel
   * work happens once per game pass rather than once per display frame.
   */
  compose() {
    this.render.composeInto(this.videoRAM, this.frameState);
  } // compose

} // GameAreaEntity
