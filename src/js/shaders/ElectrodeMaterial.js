import { Vector3 } from 'three';
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard, select, uniform, texture, varying, attribute, uv, materialReference,
  positionGeometry, normalGeometry, diffuseColor, depth,
  vec2, vec3, vec4, float, abs, dot, normalize, length, mix, any, greaterThan, lessThan
} from 'three/tsl';
import {
  PLACEHOLDER_TEXTURE, textureBindingKey, nearPlaneOrigin, fragmentDepth
} from './nodeHelpers.js';

/**
 * Electrode materials (`geometry/electrode.js`), as node (TSL) subclasses of
 * three's Basic and Physical materials. On top of the base material they:
 *   - darken towards the silhouette (`darken`), or paint it black as an outline
 *     (`useOutline`), optionally only on contacts with values;
 *   - color a prototype through its data texture (`useDataTexture`), drawing
 *     the lead outside the texture translucent gray, up to `setMaxRenderLength`;
 *   - hide contacts without values (`setHideInactives`; needs the per-instance
 *     `instanceActive` attribute, `useInactiveAlpha`);
 *   - draw in front of everything, or only their outlines (`setTranslucent`).
 *
 * The silhouette test uses the geometry's own positions and normals, before an
 * `InstancedMesh`'s instance matrices, like the GLSL patch did.
 */

/**
 * The uniforms as the shader reads them. three shares one shader between
 * electrode materials whose cache keys match, so a uniform node captured from
 * the material the shader was built for would be read for every electrode. The
 * shader reads each value from the material being drawn (`materialReference`)
 * instead. The data texture stays this material's own node, and
 * `customProgramCacheKey()` includes it, so only materials with the same
 * texture share a shader.
 */
function electrodeUniformNodes( uniforms ) {
  return {
    outlineThreshold  : materialReference( 'uniforms.outlineThreshold.value', 'float' ),
    dataTexture       : uniforms.dataTexture,
    darken            : materialReference( 'uniforms.darken.value', 'float' ),
    tangent           : materialReference( 'uniforms.tangent.value', 'vec3' ),
    maxLength         : materialReference( 'uniforms.maxLength.value', 'float' ),
  };
}

// Per-vertex terms, in model coordinates
function createElectrodeVaryings( u ) {
  // the camera ray to this vertex; along a shaft (`tangent`), only its part
  // across the shaft, so the shaft's silhouette runs along its length
  const cameraRay = positionGeometry.sub( nearPlaneOrigin() );
  const hasTangent = length( u.tangent ).greaterThan( 0.5 );
  const rayAcross = select( hasTangent, cameraRay.sub( u.tangent.mul( dot( cameraRay, u.tangent ) ) ), cameraRay );
  return {
    // 1 facing the camera, 0 at the silhouette
    reflectProd             : varying( abs( dot( normalize( normalGeometry ), normalize( rayAcross ) ) ) ),
    positionAlongTrajectory : varying( select( hasTangent, dot( positionGeometry, u.tangent ), float( 0.0 ) ) ),
  };
}

// Materials pass `reflectivity: 0`. The Physical node material has no
// `reflectivity`, only `ior`, which the WebGL material derived from it.
function toNodeParameters( material, parameters ) {
  if( !material.isMeshPhysicalNodeMaterial || parameters.reflectivity === undefined ) {
    return parameters;
  }
  const { reflectivity, ...rest } = parameters;
  rest.ior = ( 1 + 0.4 * reflectivity ) / ( 1 - 0.4 * reflectivity );
  return rest;
}

function makeElectrodeMaterial( SuperClass ) {
  class ElectrodeMaterial extends SuperClass {

    constructor( parameters = {} ) {
      super();
      this.isElectrodeMaterial = true;

      // named like the GLSL uniforms; every entry has a `.value`
      this.uniforms = {
        outlineThreshold  : uniform( 0 ),
        dataTexture       : texture( PLACEHOLDER_TEXTURE ),
        darken            : uniform( 0 ),

        // model direction for calculating outlines
        tangent           : uniform( new Vector3() ),

        // max length along the trajectory to show,
        // `tangent` must be set
        // -Inf ~ -0: show all
        // 0 ~ l: show max of l
        maxLength         : uniform( -1 ),
      };
      this._uniformNodes = electrodeUniformNodes( this.uniforms );
      this._varyings = createElectrodeVaryings( this._uniformNodes );

      // shader switches (the GLSL defines); see `customProgramCacheKey()`
      this._useOutline = false;           // USE_OUTLINE
      this._outlineActiveOnly = false;    // OUTLINE_ACTIVE_ONLY
      this._alwaysDepth = false;          // ALWAYS_DEPTH
      this._outlineAlwaysDepth = false;   // OUTLINE_ALWAYS_DEPTH
      this._useInactiveAlpha = false;     // USE_INACTIVE_ALPHA
      this._hideInactive = false;         // HIDE_INACTIVE_CONTACTS
      this._useDataTexture = false;       // USE_DATATEXTURE

      this.setValues( toNodeParameters( this, parameters ) );
    }

    // `needsUpdate` only rebuilds the shader when this key changes; see
    // `SurfaceMaterial.customProgramCacheKey()`. The data texture is in it when
    // the shader samples it (see `electrodeUniformNodes()`).
    customProgramCacheKey() {
      const dataTexture = this.uniforms.dataTexture.value;
      return `${ super.customProgramCacheKey() },electrode:${ this._useOutline },` +
        `${ this._outlineActiveOnly },${ this._alwaysDepth },${ this._outlineAlwaysDepth },` +
        `${ this._useInactiveAlpha },${ this._hideInactive },${ this._useDataTexture },` +
        `${ this._useDataTexture ? dataTexture.uuid : '' }:${ textureBindingKey( dataTexture ) }`;
    }

    // sets a shader switch; rebuilds only when it changes
    _setSwitch( name, value ) {
      if( this[ name ] === value ) { return; }
      this[ name ] = value;
      this.needsUpdate = true;
    }

    useOutline( outlineThreshold, activeOnly = false ) {
      if( outlineThreshold > 0.01 ) {
        this.uniforms.outlineThreshold.value = outlineThreshold;
        this._setSwitch( '_useOutline', true );
      } else {
        this._setSwitch( '_useOutline', false );
      }

      // Only outline contacts that have values (requires `instanceActive`,
      // hence a no-op unless `useInactiveAlpha` is also on)
      this._setSwitch( '_outlineActiveOnly', !!activeOnly );
    }

    setTranslucent( level ) {
      // level = 0 or false: nothing is translucent, depth=always
      // level = 1 or true: contact is translucent, outline depth = always
      // level = 2: depth = always for all
      if( level === 0 || level === false ) {
        this._setSwitch( '_alwaysDepth', true );
        return;
      }

      this._setSwitch( '_alwaysDepth', false );

      if( level === 1 || level === true ) {
        // outline is always at the front
        this._setSwitch( '_outlineAlwaysDepth', true );
        return;
      }

      this._setSwitch( '_outlineAlwaysDepth', false );
    }

    useInactiveAlpha( enable ) {
      this._setSwitch( '_useInactiveAlpha', !!enable );
    }

    setHideInactives( hide ) {
      if( hide ) {
        // Lazily enable instanceActive attribute wiring and hiding
        this.useInactiveAlpha( true );
      }
      this._setSwitch( '_hideInactive', !!hide );
    }

    setMaxRenderLength( len ) {
      if( typeof len !== "number" ) { return; }

      if( !isFinite(len) || len <= 0 ) {
        len = -1;
      }

      this.uniforms.maxLength.value = len;
    }

    setModelDirection( dir ) {
      this.uniforms.tangent.value.copy( dir ).normalize();
    }

    useDataTexture( texture, enabled = true ) {
      const previousTexture = this.uniforms.dataTexture.value;
      if( !texture ) {
        enabled = false;
      }

      if( previousTexture !== ( texture || PLACEHOLDER_TEXTURE ) ) {
        this.uniforms.dataTexture.value = texture || PLACEHOLDER_TEXTURE;
        if( previousTexture !== PLACEHOLDER_TEXTURE ) {
          previousTexture.dispose();
        }
        // another texture may bind differently
        this.needsUpdate = true;
      }

      this._setSwitch( '_useDataTexture', !!enabled );
    }

    setupDiffuseColor( builder ) {
      super.setupDiffuseColor( builder );

      // The GLSL patch replaced three's `color_fragment`, before opaque
      // materials get alpha 1, and read that alpha for the depth. `super` has
      // already set it here, so set it again afterwards.
      diffuseColor.assign( this._setupElectrodeColor( builder ) );
      if( builder.isOpaque() ) {
        diffuseColor.a.assign( 1.0 );
      }
    }

    _setupElectrodeColor( builder ) {
      const u = this._uniformNodes;
      const { reflectProd, positionAlongTrajectory } = this._varyings;
      const useDataTexture = this._useDataTexture;
      const useOutline = this._useOutline;
      const alwaysDepth = this._alwaysDepth;
      const outlineAlwaysDepth = this._outlineAlwaysDepth;
      const useInactiveAlpha = this._useInactiveAlpha;
      const hideInactive = useInactiveAlpha && this._hideInactive;
      const outlineActiveOnly = useInactiveAlpha && this._outlineActiveOnly;

      // like three's `setupDepth()`: only with a depth buffer to write to
      const renderTarget = builder.renderer.getRenderTarget();
      const hasDepthBuffer = renderTarget !== null ?
        renderTarget.depthBuffer === true : builder.renderer.depth === true;
      const writesDepth = ( this.depthWrite || this.depthTest ) && hasDepthBuffer;

      return Fn( () => {
        const color = vec4( diffuseColor ).toVar();

        if( useDataTexture ) {
          const vUv = uv();
          color.mulAssign( u.dataTexture.sample( vUv ) );

          // the lead outside the texture: translucent gray, cut at `maxLength`
          If( any( greaterThan( vUv, vec2( 1.0001 ) ) ).or( any( lessThan( vUv, vec2( -0.0001 ) ) ) ), () => {
            const beyondCutoff = u.maxLength.greaterThan( 0.0 )
              .and( abs( positionAlongTrajectory ).greaterThan( u.maxLength ) );
            color.assign( vec4( vec3( 0.78125 ), select( beyondCutoff, 0.0, 0.4 ) ) );
          } );
        }

        color.rgb.assign( mix( color.rgb, vec3( 0.0 ), reflectProd.oneMinus().mul( u.darken ) ) );

        const isActive = useInactiveAlpha ?
          attribute( 'instanceActive', 'float' ).greaterThanEqual( 0.5 ) : null;
        if( hideInactive ) {
          If( isActive.not(), () => {
            Discard();
          } );
        }

        // depth: always in front (0) or where the fragment is
        const inFront = float( 0.0 );
        let fragmentDepthNode = alwaysDepth ? inFront : fragmentDepth();

        if( useOutline ) {
          let outlined = u.outlineThreshold.greaterThan( 0.001 )
            .and( reflectProd.lessThan( u.outlineThreshold ) );
          if( outlineActiveOnly ) {
            outlined = isActive.and( outlined );
          }
          If( outlined, () => {
            color.rgb.assign( vec3( 0.0 ) );
          } );
          if( alwaysDepth || outlineAlwaysDepth ) {
            fragmentDepthNode = select( outlined, inFront, fragmentDepthNode );
          }
        }

        if( writesDepth ) {
          // a fully transparent fragment (beyond `maxLength`) hides nothing
          depth.assign( select( color.a.lessThanEqual( 0.0001 ), float( 1.0 ), fragmentDepthNode ) ).toStack();
        }

        return color;
      } )();
    }

    copy( source ) {
      super.copy( source );
      for( const name in this.uniforms ) {
        const value = source.uniforms[ name ].value;
        if( value && value.isVector3 ) {
          this.uniforms[ name ].value.copy( value );
        } else {
          this.uniforms[ name ].value = value;
        }
      }
      this._useOutline = source._useOutline;
      this._outlineActiveOnly = source._outlineActiveOnly;
      this._alwaysDepth = source._alwaysDepth;
      this._outlineAlwaysDepth = source._outlineAlwaysDepth;
      this._useInactiveAlpha = source._useInactiveAlpha;
      this._hideInactive = source._hideInactive;
      this._useDataTexture = source._useDataTexture;
      return this;
    }
  }

  return ElectrodeMaterial;
}

const ElectrodeBasicMaterial = makeElectrodeMaterial( MeshBasicNodeMaterial );

const ElectrodePhysicalMaterial = makeElectrodeMaterial( MeshPhysicalNodeMaterial );

export { ElectrodeBasicMaterial, ElectrodePhysicalMaterial };
