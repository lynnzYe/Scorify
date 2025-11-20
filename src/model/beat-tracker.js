(function (tf, my) {
  class BeatTracker {
    constructor() {
      // Model
      this.dec = new my.MidiBeatSS();

      // Performance state
      this.lastTime = null;
      this.lastBeatPred = 0;
      this.lastDownbeatPred = 0;
      this.lastKey = null;
      this.lastHidden = null;
    }

    async init() {
      await this.dec.init();

      // Warm start
      this.track(0, 21, 0);
      this.reset();
    }

    reset() {
      if (this.lastHidden !== null) {
        this.lastHidden.dispose();
      }
      this.lastTime = null;
      this.lastKey = null;
      this.lastHidden = null;
    }

    dispose() {
      if (this.lastHidden !== null) {
        this.lastHidden.dispose();
      }
      this.dec.dispose();
    }

    track(time, pitch, velocity) {
      // Check inputs
      velocity = velocity === undefined ? 64 : velocity;
      let deltaTime = this.lastTime === null ? 1e6 : time - this.lastTime;
      if (deltaTime < 0) {
        console.log("Warning: Specified time is in the past");
        deltaTime = 0;
      }
      if (pitch < 21 || pitch >= 21 + my.PIANO_NUM_KEYS) {
        throw "Specified MIDI note is out of piano's range";
      }

      // Run model
      const [prob, hidden] = tf.tidy(() => {
        // Pitch within 88 classes
        let pi = tf.tensor(pitch - 21, [1], "int32");

        // convert delta time to logp1 time
        let ti = tf.tensor(deltaTime, [1], "float32");

        let vi = tf.tensor(velocity, [1], "float32");

        const him1 = this.lastHidden;
        const [hatki, hi] = this.dec.forward(pi, ti, vi, him1);
        const prob = tf.sigmoid(hatki);
        return [prob, hi];
      });

      // Update state
      this.lastTime = time;
      if (this.lastHidden !== null) this.lastHidden.dispose();
      this.lastHidden = hidden;

      return prob;
    }
  }
  my.BeatTracker = BeatTracker;
})(window.tf, window.my);
