import { Vector3, Matrix4 } from 'three';
import { FileDataHandler } from './FileDataHandler.js';
import { CONSTANTS } from '../core/constants.js';
import { getThreeBrainInstance } from '../geometry/abstract.js';


class ElectrodeCoordinateHandler extends FileDataHandler {



  assertData( data, filename ) {

    if( !Array.isArray(data) || data.length === 0 ) {
      throw new Error("ElectrodeCoordinateHandler: empty electrode table");
    }
    const sample = data[ 0 ];
    if( !sample || typeof sample !== "object" ) {
      throw new Error("ElectrodeCoordinateHandler: unknown electrode table format");
    }
    // RAVE requires Electrode, Coord_xyz/T1RAS/MNI152/MNI305, Label
    if( !sample['Label'] && !sample['name'] ) {
      throw new Error("ElectrodeCoordinateHandler: electrode table must have contact `Label` (RAVE) or `name` (BIDS) as column name");
    }

    if( sample['Electrode'] === undefined && sample['ElectrodeID'] === undefined && sample['Channel'] === undefined && sample['ChannelID'] === undefined ) {
      // We will just use the order as channel name, as BIDS does not require this column :/
      // throw new Error("ElectrodeCoordinateHandler: electrode table must have `Electrode` channel as column name");
    }

    // check if the xyz are undefined
    this._coordSys = "scanRAS";
    this._coordColumns = ['x', 'y', 'z'];
    if(
      typeof sample['Coord_x'] === "number" &&
      typeof sample['Coord_y'] === "number" &&
      typeof sample['Coord_z'] === "number"
    ) {
      this._coordSys = "tkrRAS";
      this._coordColumns = ['Coord_x', 'Coord_y', 'Coord_z'];
    } else if (
      typeof sample['T1R'] === "number" &&
      typeof sample['T1A'] === "number" &&
      typeof sample['T1S'] === "number"
    ) {
      this._coordSys = "scanRAS";
      this._coordColumns = ['T1R', 'T1A', 'T1S'];
    } else if (
      typeof sample['MNI152_x'] === "number" &&
      typeof sample['MNI152_y'] === "number" &&
      typeof sample['MNI152_z'] === "number"
    ) {
      this._coordSys = "mni152";
      this._coordColumns = ['MNI152_x', 'MNI152_y', 'MNI152_z'];
    } else if (
      typeof sample['MNI305_x'] === "number" &&
      typeof sample['MNI305_y'] === "number" &&
      typeof sample['MNI305_z'] === "number"
    ) {
      this._coordSys = "mni305";
      this._coordColumns = ['MNI305_x', 'MNI305_y', 'MNI305_z'];
    } else if (
      typeof sample['x'] === "number" &&
      typeof sample['y'] === "number" &&
      typeof sample['z'] === "number"
    ) {
      // BIDS format
      // TODO: handle filename!
      this._coordSys = "scanRAS";
      this._coordColumns = ['x', 'y', 'z'];
    } else {
      throw new Error("ElectrodeCoordinateHandler: No coordinate columns found.");
    }

  }

  handleData( data, app, filename, { clearFirst = true } = {} ) {
    super.handleData( data, app, filename );
    const ras = new Vector3();

    const xName = this._coordColumns[0],
          yName = this._coordColumns[1],
          zName = this._coordColumns[2];

    // const subjectIDs = app.canvas.subject_codes;
    // It's unclear why people respecting subject code...
    // If native brain, why dropping other subjects' electrode coords?
    // For template, I assume users have MNI coords already?

    // const subject = sample['Subject'] ?? sample['SubjectCode'] ?? sample['SubjectId'] ?? app.canvas.get_state("target_subject");
    const matTotkrRAS = new Matrix4().identity();

    const subject = app.canvas.get_state("target_subject");
    const subjectMatrices = app.canvas.getTransforms( subject );

    switch ( this._coordSys ) {
      case 'scanRAS':
        matTotkrRAS.copy( subjectMatrices.tkrRAS_Scanner ).invert();
        break;
      case 'mni152':
        matTotkrRAS.copy( CONSTANTS.MNI305_to_MNI152 ).invert()
          .premultiply( subjectMatrices.MNI305_tkrRAS );
        break;
      case 'mni305':
        matTotkrRAS.copy( subjectMatrices.MNI305_tkrRAS );
        break;
      default:
        // code
    }


    const electrodeParams = data
      .map((sample, i) => {
        if(!sample || typeof sample !== "object") { return; }
        window.sample = sample;
        let channel = sample['Electrode'] ?? sample['ElectrodeID'] ?? sample['Channel'] ?? sample['ChannelID'] ?? i + 1;
        channel = parseInt(channel);
        // has channel column but NA? you need to fix the file dude
        if(typeof channel !== "number" || isNaN(channel)) { return; }

        let label = (sample['Label'] ?? sample['name'] ?? "").trim();
        if( label === "" ) {
          label = `UnLabeled${channel}`;
        }

        ras.set( parseFloat(sample[xName] ?? NaN), parseFloat(sample[yName] ?? NaN), parseFloat(sample[zName] ?? NaN) )
          .applyMatrix4(matTotkrRAS);

        let norm = ras.lengthSq();
        if( isNaN(norm) || norm == 0 ) {
          // not a valid position, skip
          return;
        }

        const tkr = ras.toArray();

        ras.set( parseFloat(sample["MNI305_x"] ?? NaN), parseFloat(sample["MNI305_y"] ?? NaN), parseFloat(sample["MNI305_z"] ?? NaN) );

        norm = ras.lengthSq();
        if( isNaN(norm) || norm == 0 ) {
          // MNI305 is not explicitly given, try MNI152
          const MNI152ToMNI305 = CONSTANTS.MNI305_to_MNI152.clone().invert();

          ras.set( parseFloat(sample["MNI152_x"] ?? NaN), parseFloat(sample["MNI152_y"] ?? NaN), parseFloat(sample["MNI152_z"] ?? NaN) )
            .applyMatrix4(MNI152ToMNI305);

          norm = ras.lengthSq();
          if( isNaN(norm) || norm == 0 ) {

            // OK fall back to affine transform from tkrRAS
            const tkrRASToMNI305 = subjectMatrices.MNI305_tkrRAS.clone().invert();
            ras.fromArray(tkr).applyMatrix4(tkrRASToMNI305);

          }
        }
        const mni305 = ras.toArray();

        const radius = sample['Radius'] ?? 1.;

        return {
          name          : `${subject}, ${channel} - ${label}`,
          type          : "electrode",
          subtype       : "SphereGeometry",
          geomParams    : {
            radius      : radius,
            channel_numbers: [channel]
          },
          time_stamp    : [],
          position      : tkr,
          value         : null,
          clickable     : true,
          layer         : 0,
          group         :
          {
            group_name  : `group_Electrodes (${subject})`,
            group_layer : 0,
            group_position: [0, 0, 0]
          },
          use_cache     : false,
          custom_info   : "",
          subject_code  : subject,
          radius        : radius,
          is_electrode  : true,
          is_surface_electrode: String(sample['SurfaceElectrode'] ?? 'false').toLowerCase().startsWith("t"),
          use_template  : false,
          surface_type  : "pial",
          hemisphere    : sample['Hemisphere'],

          trans_mat     : null,
          disable_trans_mat: false,
          keyframes     :
          {
            "[Subject]" :
            {
              name      : "[Subject]",
              time      : 0,
              value     : subject,
              data_type : "discrete",
              cached    : false
            }
          },
          prototype_name: null,

          // some params not that much used
          sub_cortical  : true,
          vertex_number : -1,
          search_geoms  : null,
          number        : channel,
          fixed_color   : null,
          surface_offset: sample['DistanceToPial'] ?? sample['DistanceShifted'] ?? 0,
          MNI305_position: mni305,
          sphere_position: [sample['Sphere_x'] ?? 0, sample['Sphere_y'] ?? 0, sample['Sphere_z'] ?? 0]
        };
      })
      .filter(el => {
        return el !== undefined;
      });

    if(!electrodeParams.length) { return; }

    if( clearFirst ) {
      app.canvas.clearElectrodes( subject );
    }
    electrodeParams.forEach( contactParams => {
      app.canvas.add_object( contactParams );
    });
  }

}

export { ElectrodeCoordinateHandler };
