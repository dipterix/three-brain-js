// import { gen_sphere } from '../geometry/sphere.js';
import { gen_electrode, is_electrode } from '../geometry/electrode.js';
import { gen_datacube } from '../geometry/datacube.js';
import { gen_datacube2 } from '../geometry/datacube2.js';
import { gen_tube } from '../geometry/tube.js';
import { gen_free } from '../geometry/free.js';
import { gen_fibertract } from '../geometry/fibertract.js';
import { gen_linesements } from '../geometry/line.js';
import { gen_imagesprite } from '../geometry/imagesprite.js'


const GeometryFactory = {
  // 'sphere'    : gen_sphere,
  'electrode' : gen_electrode,
  'free'      : gen_free,
  'datacube'  : gen_datacube,
  'datacube2' : gen_datacube2,
  'fibertract': gen_fibertract,
  'tube'      : gen_tube,
  'linesegments' : gen_linesements,
  'imagesprite'    : gen_imagesprite,
  'blank'     : (g, canvas) => { return(null) }
}


export { GeometryFactory };
