class BeatTrackerWrapper {
    private tracker: any;

    constructor() {
        if (!window.my?.BeatTracker) throw new Error("Not loaded");
        this.tracker = new window.my.BeatTracker();
    }

    async load() { await this.tracker.loadModel(); }
    predict(data: Float32Array) { return this.tracker.predict(data); }
}

// const trackerRef = useRef<BeatTrackerWrapper>();

export default BeatTrackerWrapper;