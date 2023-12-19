import { CONSTANTS } from '../core/constants.js';
import {
  Vector3, Matrix4
} from 'three';

/**
 * 1. Find AC
 * 2. Find PC
 * 3. Find x axis
 */

const tmpVec3 = new Vector3();
const tmpMat4 = new Matrix4();

function registerPresetACPCReAlign( ViewerControlCenter ){

  ViewerControlCenter.prototype.setACPC = function( pos, type ) {

    if( type !== "AC" && type !== "PC" ) {
      throw 'setACPC: `type` must be either AC or PC'
    }

    const prefix = type.toLowerCase();

    // move crosshair to AC
    this._acpc[ prefix ].copy( pos );
    this._acpc[ `${ prefix }Set`] = true;

    const transforms = this.canvas.getTransforms()
    this.broadcast({
      data: {
        'acpc_realign' : {
          'target'      : `acpc.${ prefix }`,
          'acpc'        : this._acpc,
          'transforms'  : transforms
        }
      }
    });

    const ras = tmpVec3.copy( pos )
      .applyMatrix4( tmpMat4.copy( transforms.Torig ).invert() )
      .applyMatrix4( transforms.Norig );

    const ctrl = this[ `${ prefix }PosCtrl` ];
    ctrl.object[ ctrl._name ] =
      `${ ras.x.toFixed(1) },${ ras.y.toFixed(1) },${ ras.z.toFixed(1) }`;
    ctrl.updateDisplay();

    this.gui.hideControllers([
      'Confirm Updating AC', 'Confirm Updating PC',
      'Click to Set/Reset Rotation', 'Confirm Updating Rotation'
    ]);
    this.gui.showControllers([
      'Click to Register/Reset AC', 'Click to Register/Reset PC'
    ]);

    if( this._acpc.acSet && this._acpc.pcSet ) {
       this.gui.showControllers([ 'Click to Set/Reset Rotation' ]);
    }

    this.canvas.title = `${type} registered.`;
    this.canvas.needsUpdate = true;
  }

  ViewerControlCenter.prototype.setACPCNormal = function( xaxis ) {

    if( xaxis === undefined ) {
      xaxis = new Vector3().copy( this.canvas.mainCamera.up )
        .cross(
          tmpVec3.copy( this.canvas.mainCamera.position )
            .sub( this.canvas._crosshairPosition )
        );
    }

    this._acpc.xAxis.copy( xaxis.normalize() );

    const transforms = this.canvas.getTransforms();
    this.broadcast({
      data: {
        'acpc_realign' : {
          'target'      : "acpc.xAxis",
          'acpc'        : this._acpc,
          'transforms'  : transforms
        }
      }
    });

    this.gui.hideControllers([
      'Confirm Updating AC', 'Confirm Updating PC',
      'Confirm Updating Rotation'
    ]);
    this.gui.showControllers([
      'Click to Register/Reset AC', 'Click to Register/Reset PC',
      'Click to Set/Reset Rotation'
    ]);

    this.canvas.title = "Rotation set.";
    this.canvas.trackball._rotationAxisFixed = 0;
    this.canvas.needsUpdate = true;

  }


  ViewerControlCenter.prototype.addPreset_acpcrealign = function(){
    const folderName = CONSTANTS.FOLDERS['acpc-realign'];

    this._acpc = {
      space : 'tkrRAS',
      // AC position in tkrRAS
      acSet : false,
      ac : new Vector3(),
      pcSet : false,
      pc : new Vector3(),
      xAxis : new Vector3().set( 1, 0, 0 ),
    }

    const registerStart = ( type ) => {
      const prefix = type.toLowerCase();
      // move crosshair to AC/PC
      this.canvas.setSliceCrosshair( this._acpc[ prefix ] );
      // Set instructions
      this.canvas.title = `Move & focus crosshair on ${type}, then press 'Confirm Updating ${type}'`;

      this.gui.hideControllers([
        'Click to Register/Reset AC', 'Click to Register/Reset PC',
        'Confirm Updating AC', 'Confirm Updating PC',
        'Click to Set/Reset Rotation', 'Confirm Updating Rotation'
      ]);
      this.gui.showControllers([
        `Click to Register/Reset ${type}`,
        `Confirm Updating ${type}`
      ]);
      this.gui.getController( "Show Panels" ).setValue( true );
      this.gui.getController( "Overlay Coronal" ).setValue( true );
      this.gui.getController( "Overlay Axial" ).setValue( true );
      this.gui.getController( "Overlay Sagittal" ).setValue( true );
      this.gui.getController( "Left Hemisphere" ).setValue( "hidden" );
      this.gui.getController( "Right Hemisphere" ).setValue( "hidden" );
    };

    const findACCtrl = this.gui.addController(
      'Click to Register/Reset AC', () => {
        registerStart( 'AC' );
      },
      { folderName: folderName }
    );
    this.gui.addController(
      'Confirm Updating AC', () => {
        this.setACPC( this.canvas._crosshairPosition, "AC" );
      },
      { folderName: folderName }
    ).hide();
    this.acPosCtrl = this.gui.addController(
      'AC (ScanRAS)', "Unset",
      { folderName: folderName }
    );

    const findPCCtrl = this.gui.addController(
      'Click to Register/Reset PC', () => {
        registerStart( 'PC' );
      },
      { folderName: folderName }
    );
    const setPCCtrl = this.gui.addController(
      'Confirm Updating PC', () => {
        this.setACPC( this.canvas._crosshairPosition, "PC" );
      },
      { folderName: folderName }
    ).hide();
    this.pcPosCtrl = this.gui.addController(
      'PC (ScanRAS)', "Unset",
      { folderName: folderName }
    );

    const findRotationCtrl = this.gui.addController(
      'Click to Set/Reset Rotation', () => {

        const acpcCenter = tmpVec3.copy( this._acpc.ac )
          .add( this._acpc.pc )
          .multiplyScalar( 0.5 ).clone();
        const pcacVector = tmpVec3.copy( this._acpc.ac )
          .sub( this._acpc.pc ).normalize().clone();
        if( pcacVector.length() == 0 ) {
          pcacVector.set(0, 1, 0);
        }
        const xaxis = this._acpc.xAxis;
        if( xaxis.length() == 0 ) {
          xaxis.set(1, 0, 0);
        }

        this.canvas.mainCamera.position.copy( xaxis )
          .cross( pcacVector ).normalize()
          .multiplyScalar( 500 );
        this.canvas.mainCamera.lookAt( this._acpc.ac );
        this.canvas.mainCamera.up.copy( pcacVector );
        this.canvas.mainCamera.updateProjectionMatrix();
        this.canvas.setSliceCrosshair( acpcCenter );
        this.canvas.trackball._rotationAxisFixed = 2;
        this.canvas.title = "Elevate `First-Person` view and adjust the 3dViewer";
        this.gui.getController( "Show Panels").setValue( true );
        this.gui.getController( "Slice Mode" ).setValue( "line-of-sight" );
        this.gui.getController( "Overlay Axial" ).setValue( true );
        this.gui.getController( "Left Hemisphere" ).setValue( "hidden" );
        this.gui.getController( "Right Hemisphere" ).setValue( "hidden" );
        this.gui.getController( "Voxel Type" ).setValue( "none" );

        this.canvas.needsUpdate = true;

        this.gui.hideControllers([
          'Click to Register/Reset AC', 'Click to Register/Reset PC',
          'Confirm Updating AC', 'Confirm Updating PC',
          'Click to Set/Reset Rotation', 'Confirm Updating Rotation'
        ]);
        this.gui.showControllers([
          'Confirm Updating Rotation'
        ]);

        if( this._acpc.acSet && this._acpc.pcSet ) {
           this.gui.showControllers([ 'Click to Set/Reset Rotation' ]);
        }

        // set camera
        // this.gui.hideControllers(['Start to locate AC', 'Start to locate PC', 'Set AC', 'Set PC'])
      },
      { folderName: folderName }
    );
    findRotationCtrl.hide();

    const setRotationCtrl = this.gui.addController(
      'Confirm Updating Rotation', () => {
        this.setACPCNormal();
      },
      { folderName: folderName }
    );
    setRotationCtrl.hide();

    this.gui.openFolder( folderName );

  }

  return( ViewerControlCenter );

}

export { registerPresetACPCReAlign };
