// A start/stop stopwatch built on `THREE.Timer`, replacing the deprecated `THREE.Clock`
// (deprecated in three r183, which warns on every construction).
//
// `Timer` is an update()-driven, side-effect-free timebase: it has no `start()`, `stop()`,
// `running`, or `getElapsedTime()`. This adapter restores those semantics so the viewer's
// timing code reads the same as it did against `Clock`, while a single shared `Timer` -
// owned and advanced once per frame by `ViewerApp` - provides the underlying time. That
// also means every consumer within a frame now reads the same delta, instead of each
// clock sampling `performance.now()` at a different point in the frame.
//
// The observable behavior intentionally matches `Clock`, including `autoStart` and the
// fact that `stop()` clears it.
class Stopwatch {

  // `timer` is the shared THREE.Timer; `autoStart` mirrors `new Clock( autoStart )`.
  constructor( timer, autoStart = true ) {
    this._timer = timer;
    this.autoStart = autoStart;

    // value of `timer.getElapsed()` when start() was last called
    this._startedAt = 0;

    // elapsed time frozen at the moment stop() was called
    this._elapsed = 0;

    this.running = false;
  }

  // Like Clock.start(), this re-zeroes the elapsed time.
  start() {
    this._startedAt = this._timer.getElapsed();
    this._elapsed = 0;
    this.running = true;
  }

  stop() {
    this._elapsed = this.getElapsedTime();
    this.running = false;
    this.autoStart = false;
  }

  // Unlike Clock.getElapsedTime(), this has no side effects - it never advances the clock.
  getElapsedTime() {
    if( !this.running ) { return this._elapsed; }
    return this._timer.getElapsed() - this._startedAt;
  }

  // Returns the delta of the frame in which the shared timer was last updated,
  // or 0 while stopped.
  getDelta() {
    if( this.autoStart && !this.running ) {
      this.start();
      return 0;
    }
    return this.running ? this._timer.getDelta() : 0;
  }

}

export { Stopwatch };
