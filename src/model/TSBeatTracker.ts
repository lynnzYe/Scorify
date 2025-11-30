import * as tf from "@tensorflow/tfjs";

class BeatTrackerWrapper {
    private tracker: any;

    constructor() {
        if (!window.my?.BeatTracker) throw new Error("Not loaded");
        this.tracker = new window.my.BeatTracker();
    }

    async load() { await this.tracker.init(); }
    predict(data: Float32Array) { return this.tracker.predict(data); }

    track(time: number, pitch: number, velocity: number, dbHint: boolean = false): [tf.Tensor, tf.Tensor] {
        return this.tracker.track(time, pitch, velocity, dbHint)
    }

    reset() {
        console.info("reset LSTM beat tracker")
        this.tracker.reset()
    }
}

export default BeatTrackerWrapper;