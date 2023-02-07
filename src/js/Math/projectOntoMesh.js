import { Vector3 } from 'three';

function projectOntoMesh( position, mesh ) {
  const world2Model = mesh.matrixWorld.clone().invert();
  const modelPosition = position.clone().applyMatrix4( world2Model );
  const positionAttribute = mesh.geometry.getAttribute("position");
  const itemSize = positionAttribute.itemSize;

  const projectedPoint = new Vector3(0, 0, 0);
  const tmpPoint = new Vector3();
  let minDistance = Infinity;
  let tmpDistance = 0;
  let vertexIndex = 0;
  for(let i = 0; i < positionAttribute.count; i++) {
    tmpPoint.x = positionAttribute.array[ itemSize * i ];
    tmpPoint.y = positionAttribute.array[ itemSize * i + 1 ];
    tmpPoint.z = positionAttribute.array[ itemSize * i + 2 ];
    tmpDistance = tmpPoint.distanceToSquared( modelPosition )
    if( tmpDistance < minDistance ) {
      projectedPoint.copy( tmpPoint );
      vertexIndex = i;
      minDistance = tmpDistance;
    }
  }
  projectedPoint.applyMatrix4( mesh.matrixWorld );
  return({
    point       : projectedPoint,
    distance    : Math.sqrt( minDistance ),
    vertexIndex : vertexIndex
  });
}

export { projectOntoMesh };

