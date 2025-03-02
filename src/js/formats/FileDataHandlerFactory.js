import { VolumeHandler } from './VolumeHandler.js';

import { SurfaceHandler } from './SurfaceHandler.js';
import { SurfaceMeasurementHandler } from './SurfaceMeasurementHandler.js';
import { SurfaceAnnotationHandler } from './SurfaceAnnotationHandler.js';

import { ElectrodeCoordinateHandler } from './ElectrodeCoordinateHandler.js';
import { ElectrodeValueHandler } from './ElectrodeValueHandler.js';
import { ElectrodeColorMapHandler } from './ElectrodeColorMapHandler.js';

import { DragNDropColorMapHandler } from './DragNDropColorMapHandler.js';
import { CanvasStateJSONHandler } from './CanvasStateJSONHandler.js';
import { CanvasTransitionJSONHandler } from './CanvasTransitionJSONHandler.js';


const FileDataHandlerFactory = {
  VolumeHandler               : VolumeHandler,

  SurfaceHandler              : SurfaceHandler,
  SurfaceMeasurementHandler   : SurfaceMeasurementHandler,
  SurfaceAnnotationHandler    : SurfaceAnnotationHandler,

  ElectrodeCoordinateHandler  : ElectrodeCoordinateHandler,
  ElectrodeValueHandler       : ElectrodeValueHandler,
  ElectrodeColorMapHandler    : ElectrodeColorMapHandler,

  DragNDropColorMapHandler    : DragNDropColorMapHandler,
  CanvasStateJSONHandler      : CanvasStateJSONHandler,
  CanvasTransitionJSONHandler : CanvasTransitionJSONHandler,
};


export { FileDataHandlerFactory };
