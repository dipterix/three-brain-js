import { CONSTANTS } from '../core/constants.js';

// Order matters: `⇧F` steps through these, and the strings are the R-facing
// controller values, so they must stay stable.
const FOCUS_OBJECT_TYPES = [ 'all', 'surface mesh', '2D slice', '3D voxel', 'streamline' ];

/**
 * Focus mode: hold `F` and click to interrogate whatever is under the cursor,
 * restricted to one kind of object.
 *
 * Normal left-click only reaches the "clickable" layer -- in practice
 * electrodes. This uses the geometry type tags (layers 16-20) instead, so
 * surfaces, slices, volumes and streamlines become answerable without becoming
 * clickable, and without disturbing `object_chosen`.
 */
function registerPresetFocusObject( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_focusObject = function(){

    const folderName = CONSTANTS.FOLDERS[ 'focus-object' ] || 'Default';

    const controller = this.gui
      .addController( 'Focus Object Type', FOCUS_OBJECT_TYPES[ 0 ],
                      { args : FOCUS_OBJECT_TYPES, folderName : folderName })
      .onChange(( v ) => {
        if( typeof v !== 'string' ) { return; }
        this.canvas.set_state( 'focusModeObjectType', v );
        // the type decides who is raycastable, so re-ask if F is already held
        if( this.canvas.get_state( 'focus_mode_activated' ) ) {
          this.canvas.prepareFocusMode({ mode : 'focus', objectType : v });
        }
        this.broadcast();
      });

    // seed the canvas so a pick before any user interaction still has a type
    this.canvas.set_state( 'focusModeObjectType', controller.getValue() );

    controller.tooltip(
      'Hold F and click to focus an object of this type; ⇧F cycles the type',
      CONSTANTS.TOOLTIPS.KEY_CYCLE_FOCUS_TYPE
    );

    // `F` held enables focus mode.
    //
    // `shiftKey: false` so it does not also fire for the cycle binding below.
    // Keydown auto-repeats while the key is held, hence the idempotent set.
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_RAYCASTER_ALL,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      metaIsCtrl: false,
      callback  : [
        () => {
          if( this.canvas.get_state( 'focus_mode_activated' ) ) { return; }
          // a press starts a fresh pick, so drop whatever the last one left on
          // the info panel; no argument clears unconditionally. Not done inside
          // `prepareFocusMode`, which the ruler and the type controller also
          // call and neither should wipe the panel.
          this.canvas.clearFocusModeTarget();
          this.canvas.set_state( 'focus_mode_activated', true );
          this.canvas.prepareFocusMode({
            mode : 'focus',
            objectType : controller.getValue(),
          });
          // `bindKeyboard` does not repaint on its own
          this.canvas.needsUpdate = true;
        },
        () => {
          // Unconditional, because the keyup event carries no key to test:
          // `ViewerControlCenter._onKeyUp` re-dispatches a shared constant
          // (`{ type: "viewerApp.keyboad.keyup" }`) without copying `code` the
          // way the keydown path does. Any release therefore leaves focus mode,
          // which is also how the ruler behaves.
          this.canvas.set_state( 'focus_mode_activated', false );
        }
      ]
    });

    // `⇧F` cycles the type
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_FOCUS_TYPE,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      metaIsCtrl: false,
      callback  : () => {
        const current = FOCUS_OBJECT_TYPES.indexOf( controller.getValue() );
        const next = ( current + 1 ) % FOCUS_OBJECT_TYPES.length;
        controller.setValue( FOCUS_OBJECT_TYPES[ next ] );
      }
    });

  };

  return( ViewerControlCenter );
}

export { registerPresetFocusObject, FOCUS_OBJECT_TYPES };
