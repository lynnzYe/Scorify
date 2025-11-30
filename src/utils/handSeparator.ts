export class HandSeparator {
    // Initial guesses: Left hand around C3 (48), Right hand around C5 (72)
    private leftCentroid: number = 48;
    private rightCentroid: number = 72;

    // Learning rate (0.0 to 1.0). 
    // Higher = adapts faster to jumps. Lower = more stable.
    // 0.1 is a good balance for piano.
    private readonly alpha: number = 0.1;

    // Force a "hard" split point to prevent extreme crossing behavior
    // e.g., anything below C2 is always bass, anything above C6 always treble
    private readonly HARD_BASS_CEILING = 84; // C6
    private readonly HARD_TREBLE_FLOOR = 36; // C2

    public classify(pitch: number): "treble" | "bass" {
        // 1. Edge case hard limits (optional, keeps logic sane for extreme notes)
        if (pitch > this.HARD_BASS_CEILING) return "treble";
        if (pitch < this.HARD_TREBLE_FLOOR) return "bass";

        // 2. Calculate distance to current hand positions
        const distToLeft = Math.abs(pitch - this.leftCentroid);
        const distToRight = Math.abs(pitch - this.rightCentroid);

        // 3. Assign to closest cluster
        if (distToLeft <= distToRight) {
            // Update Left Centroid (Moving Average)
            this.leftCentroid = this.leftCentroid * (1 - this.alpha) + pitch * this.alpha;

            // Constraint: Don't let left hand average drift ABOVE right hand average
            if (this.leftCentroid > this.rightCentroid) {
                this.leftCentroid = this.rightCentroid - 1;
            }
            console.debug("handS: left update, centroid:", this.leftCentroid)
            return "bass";
        } else {
            // Update Right Centroid
            this.rightCentroid = this.rightCentroid * (1 - this.alpha) + pitch * this.alpha;

            // Constraint: Don't let right hand average drift BELOW left hand average
            if (this.rightCentroid < this.leftCentroid) {
                this.rightCentroid = this.leftCentroid + 1;
            }
            console.debug("handS: right update, centroid:", this.leftCentroid)
            return "treble";
        }
    }

    public reset() {
        this.leftCentroid = 48;
        this.rightCentroid = 72;
    }
}