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

      const log1pDeltaTime = Math.log1p(deltaTime);
      // Run model
      const prevHidden = this.lastHidden;
      const [beat_prob, downbeat_prob, hidden] = tf.tidy(() => {
        // Pitch within 88 classes
        let feat = tf.tensor(
          [
            [
              pitch - 21,
              log1pDeltaTime,
              velocity,
              this.lastBeatPred,
              this.lastDownbeatPred,
            ],
          ],
          [1, 5],
          "float32"
        );
        const [blgt, dblgt, hi] = this.dec.forward(feat, prevHidden);
        const beat_prob = tf.sigmoid(blgt);
        const downbeat_prob = tf.sigmoid(dblgt);
        return [beat_prob, downbeat_prob, hi];
      });

      // Update state
      if (prevHidden !== null) prevHidden.dispose();
      this.lastTime = time;
      this.lastHidden = hidden;
      return [beat_prob, downbeat_prob];
    }
  }
  my.BeatTracker = BeatTracker;
})(window.tf, window.my);
