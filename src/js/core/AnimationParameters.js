import { EventDispatcher, Clock, Vector3 } from 'three';

class AnimationParameters extends EventDispatcher {
  constructor () {
    super();
    this._eventDispatcher = new EventDispatcher();
    this.object = {
      'Play/Pause' : false,
      'Time' : 0,
      'Speed' : 1
    }
    this.exists = false;
    this.min = 0;
    this.max = 0;
    this.loop = true;
    this.display = '[None]';
    this.threshold = '[None]';

    this._clock = new Clock();
    this._onChange = undefined;
    this.oldTime = 0;
    this.clockDelta = 0;

    this.objectFocused = {
      instance : null,
      position : new Vector3(),
      templateMapping : {},
      get currentDataValue () {
        if( this.instance ) {
          return this.instance._currentValue;
        }
        return undefined;
      }
    }
    this.hasObjectFocused = false;
  }

  get play() {
    return this.object[ 'Play/Pause' ];
  }
  get time() {
    return this.object[ 'Time' ];
  }
  get speed() {
    return this.object[ 'Speed' ];
  }
  get renderLegend() {
    return this.object[ 'Show Legend' ] ?? true;
  }

  get renderTimestamp () {
    return this.object['Show Time'] ?? false;
  }

  set time ( v ) {
    if( typeof v !== "number" ) {
      v = this.min;
    } else {
      if( v < this.min ) {
        v = this.min;
      } else if( v > this.max ) {
        v = v - this.max + this.min;
        if( v > this.max ) {
          v = this.min;
        }
      }
    }
    this.object[ 'Time' ] = v;
    this._eventDispatcher.dispatchEvent({
      type : "animation.time.onChange",
      value : v
    })
  }

  dispose() {
    this._clock.stop();
  }

  get elapsedTime () {
    return (this.time - this.oldTime) / 1000;
  }

  get trackPosition () {
    return this.time - this.min;
  }

  incrementTime () {
    // tok clock anyway

    const clockDelta = this._clock.getDelta();
    this.oldTime = this.time;

    if( !this.exists ) {
      this.clockDelta = 0;
      this.currentTime = 0;
      return false;
    }

    this.clockDelta = clockDelta;

    // update time
    if( this.play ) {
      this.time = this.oldTime + this.clockDelta * this.speed;

      if( typeof this._onChange === "function" ) {
        this._onChange( this.trackPosition, this.max - this.min );
      }
      return true;
    }
    return false;


  }

  onChange( callback ) {
    this._onChange = undefined;
    if( typeof callback === "function" ) {
      this._onChange = callback;
    }
  }

  updateFocusedInstance ( inst ) {
    if( !inst ) {
      this.hasObjectFocused = false;
      return;
    }
    this.hasObjectFocused = true;

    const objectInfo = this.objectFocused;
    const objectUserData = inst.object.userData;

    inst.object.getWorldPosition( objectInfo.position );
    objectInfo.instance = inst;
    objectInfo.name = inst.name;
    objectInfo.customInfo = inst._params.custom_info;
    objectInfo.isElectrode = inst.isElectrode ?? false;
    objectInfo.MNI305Position = objectUserData.MNI305_position;
    objectInfo.templateMapping.mapped = objectUserData._template_mapped || false;
    objectInfo.templateMapping.shift = objectUserData._template_shift || 0;
    objectInfo.templateMapping.space = objectUserData._template_space || 'original';
    objectInfo.templateMapping.surface = objectUserData._template_surface || 'NA';
    objectInfo.templateMapping.hemisphere = objectUserData._template_hemisphere || 'NA';
    objectInfo.templateMapping.mni305 = objectUserData._template_mni305;
    // objectInfo.currentDataValue = undefined;
  }

}

export { AnimationParameters };
