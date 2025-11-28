/*
Goal: 
- Determine positions for notes associated with a beat event
- Determine positions for notes not associate with any beat events

Assumptions:
1. Notes associated with beats always starts at integer positions. 
2. Notes (non-beat) positions quantize to tatum (min beat level)
3. All notes within ±70ms of the beat are predicted as on beats.
4. These classifications are assumed to be consecutive (a group represents one beat)

Insights:
1. When the beat prediction is perfect, the task of inferring non-beat note positions simplifies to quantization.
2. Quantization is essentially rounding positions to certain numbers of bins. 
    - if the prediction is perfect, number of bins = tatum
    - if octave error, number of bins = tatum * 2
    - if irregular, number of bins = `cal_n_tatum()`
3. If we can denoise beat prediction, we can correctly infer non-beat note positions. 
4. By assuming free measure, we can tolerate inaccurate downbeat predictions. (just start a new measure when pred true)

To what extent should we denoise the beat prediction (post-processing)?
- (no) complex heuristic, empirical good performance
- (yes) minimal correction, focus on revealing model capabiltiy

How to perform (denoising: minimal correction), or more specifically, correct what?
- false negative (10000000) (e.g. octave-error)
    - goal is to determine the number of tatum between the two beats (then simply quantize)
    - calculate by heuristic BPM smoothing
        - use previous n beats to create a bpm estimate
        - compute moving average
        - assume no tempo change bigger than 2.5*k
    - use the smoothed BPM pred to infer the number of missing beats
    - total_tatum = n_missing_beats * tatum
- false positive (10011110)
    - case 1: consecutive (0111110)
        - problems:
            - will cause notes with different positions to be painted together (for this one group of FP)
            - disturb bpm estimate
        - solution:
            - bear with the issue of multiple notes painted together (else seems to require too much engineering)
            - compute true beat time using group average to alleviate, biased towards more recent beat onset time
                - under the assumption that later beats are more accurate than previous beats, an empirical discovery
    - case 2: disjoint (0101010)
        - problems:
            - disrupt bpm estimate (octave error, doubling frequency, should be less often)
                - will require the design of octave-error aware BPM tracker. too much tweak.
                - assume octave error is always halfing the frequency no doubling.

Other Issues:
- edge cases:
    - when we don't have BPM available
    - when user pauses for a long time
    - when user changes tempo/music

Pseudo code (ideally use particle filtering etc. take activation probability into account):
- for each predicted beat/downbeat (each fillNotes call):
    - update beat history using weighted group onset time average
    - calculate smoothed bpm, insert virtual beat onsets if necessary
    - compute num tatum between previous beat onset and current beat onset
    - for each pending note:
        - quantize to positions using num tatums (map to exactly one tatum index)
        - ignore duration for now (assume all eighth notes e.g.)
        - drawNote(...)

*/

export type Staff = "treble" | "bass";

export interface NoteEvent {
    midi: number;
    staff: Staff;
    timestamp: number;
}

export interface BeatEvent {
    timestamp: number;
    isDownbeat: boolean;
}


// Config
const GROUP_WINDOW_MS = 250;
let defaultTatum = 2; // min beat level
const MAX_TEMPO_JUMP = 1.5; // heuristic: no jump > 2×
const ON_BEAT_TOLERANCE_MS = 50 // to determine whether current note is at the same timestamp as beat's (should be equal)

// BPM tracking
let lastBeatTimestamp: number | null = null;
let smoothedInterval = 1000; // Default to 60 bpm (~500ms)
let isFirstBeat = true // Whether at the begining of scorification

// ============================
// Public API
// ============================

export function setDrawCallback(cb: DrawNoteFn) {
    drawCallback = cb;
}

// Called per mini note-on
export function addNote(midi: number, staff: Staff, timestamp: number) {
    pendingNotes.push({ midi, staff, timestamp });
}

// Called per beat/downbeat prediction. Notice: timestamp should be the same as note-on timestamp
export function addBeat(timestamp: number, isDownbeat: boolean) {
    groupBeat(timestamp, isDownbeat);
}

// Manually reset everything (e.g. on pause or score clear)
export function resetScorify() {
    pendingNotes = [];
    beatGroups = [];
    lastBeatTimestamp = null;
    smoothedInterval = 1000;
    isFirstBeat = true;
}

export function updateTatum(tatum: number) {
    defaultTatum = tatum
}

export function drawBuffedNotes() {
    // Ideal call time: after the end of a beat group, e.g.:
    // 1. current performed note is not on a beat
    // 2. current note is on beat, but distance to the last beat is greater than maximum allowed grouped beat IOI
    if (beatGroups.length === 0) return;
    // if (!drawCallback) {
    //     console.warn("drawNote not available");
    //     return;
    // }
    if (!(window as any).drawNote) {
        console.error("Scorify draw note not initialized")
        return
    }
    // Check consecutive beat labels any problems.

    // Step 1: compute the true beat time for the latest group
    const latestGroup = beatGroups[beatGroups.length - 1];
    const beatTime = weightedBeatOnsetTime(latestGroup);

    // Step 2: compute beat interval (BPM smoothing)
    updateBPM(beatTime);

    // Step 3: insert virtual beats for missing ones (handle false negative predictions)
    let virtualBeats = getVirtualBeats(beatTime);

    // Step 4: process all pending notes BEFORE this beat
    const notesToDraw = [...pendingNotes];
    const tatumSize = smoothedInterval / defaultTatum;
    console.debug("=======tatum size:", defaultTatum, 'smoothed interval:', smoothedInterval, 'beattime:', beatTime, 'virtual beat:', virtualBeats)

    // Step 5: loop and draw all notes
    let latestTatumIdx = 0
    for (const note of notesToDraw) {
        // draw |---n1--n3--n5---(n8n9|)
        let delta = lastBeatTimestamp === null ? 0 : note.timestamp - lastBeatTimestamp;
        let index = Math.round(delta / tatumSize); // Quantize to tatum position 
        if (index < 0) index = 0;

        /* There are two cases: 
            1. list of pending notes + latest note is on a beat/downbeat
            2. no pending notes, just new on-beat notes
        - So, total number of beats between last beat = (whether new beat) + virtualBeats
        - Additionally, 
        */
        let beatsToPrev = 1
        let isDownbeat = isFirstBeat || (latestGroup[0].isDownbeat && Math.abs(note.timestamp - beatTime) < ON_BEAT_TOLERANCE_MS)
        // Case 2 (or when previous note is on beat, current also)
        if (latestGroup.length > 0 && Math.abs(delta) < ON_BEAT_TOLERANCE_MS) {
            console.debug("found more note on beat, time:", note.timestamp)
            beatsToPrev = 0
            index = 0
            isDownbeat = false || isFirstBeat // There is a previous downbeat and in the same group. don't start a new measure this time, unless it is at the start.
            virtualBeats = 0 // Since note onset on a beat, no additional beats in between
        }
        // Compute the number of tatums for this segment of performance (always between two beats due to how this function is called)
        const beatsBetween = beatsToPrev + virtualBeats;
        const tatumsBetween = beatsBetween * defaultTatum;
        if (index > tatumsBetween) index = tatumsBetween;
        if (isDownbeat) { currentMeasureTatumIndex = 0; index = 0; } // start a new measure from 0 position

        // Empirical limit on index: no more than 1 measures of rest. 
        index = Math.min(defaultTatum * 4, index)

        let positionInMeasure = currentMeasureTatumIndex + index;

        console.debug("Curr note:", note, 'delta:', delta, 'lastbeat:', lastBeatTimestamp, 'tatumSize:', tatumSize,
            'pre index:', index, 'isdownbeat:', isDownbeat, 'latest group', latestGroup, 'beats between:', beatsBetween,
            'draw position:', positionInMeasure, 'index:', index, 'smoothed', smoothedInterval);
        // drawCallback(
        (window as any).drawNote(
            note.midi,
            note.staff,
            isDownbeat, // if true, will draw a new measure line and reset measure tatum index to 0 (above)
            positionInMeasure,
            8, // default note type
            120, // debug use default draw BPM // getCurrentBpm()
        );
        latestTatumIdx = index
        isFirstBeat = false // After any note is drawn, we are no longer at the start of scorification.
    }

    // Step 6: clear pending notes
    pendingNotes.length = 0;

    // Step 7: update lastBeatTimestamp and tatum cumulative index
    lastBeatTimestamp = beatTime;
    currentMeasureTatumIndex += latestTatumIdx; // Add till current beat
    // console.debug("update last beat timestamp to:", beatTime, 'curr measure index:', currentMeasureTatumIndex)
}

export type DrawNoteFn = (
    midiPitch: number,
    staff: Staff,
    newBar: boolean,
    positionInMeasure: number,
    noteType: 2 | 4 | 8 | 16 | 32,
    currentBpm?: number | null
) => void;

// -------------------------------
// Internal state
// -------------------------------
let pendingNotes: NoteEvent[] = [];
let beatGroups: BeatEvent[][] = [];

let flushScheduled = false;

let currentMeasureTatumIndex = 0; // Keep track of cumulative tatum index in a measure

let drawCallback: DrawNoteFn | null = null;

// -------------------------------
// Internal Helpers
// -------------------------------
function groupBeat(timestamp: number, isDownbeat: boolean) {
    // Case: first group
    if (beatGroups.length === 0) {
        beatGroups.push([{ timestamp, isDownbeat }]);
        return;
    }

    const group = beatGroups[beatGroups.length - 1];
    const last = group[group.length - 1];

    // Consecutive only if < thres ms (use 250ms not 70ms - increase tolerance to address adjacent FP ~ max 240 BPM)
    if (timestamp - last.timestamp < GROUP_WINDOW_MS) {
        group.push({ timestamp, isDownbeat }); // Append to previous groups of beats (group of on-beat note onset times)
    } else {
        beatGroups.push([{ timestamp, isDownbeat }]); // Start a new group
    }
}

function weightedBeatOnsetTime(group: BeatEvent[]): number {
    if (group.length === 0) { console.error("beat Group length == 0 in scorify") }
    // Input a group of onset times, compute the weighted avg onset time representing this group.
    if (group.length === 1) return group[0].timestamp;

    let total = 0;
    let weightSum = 0;

    // Example: weight more towards later events
    // weight = (i+1)^2 gives more emphasis to more recent detections
    group.forEach((g, i) => {
        const w = (i + 1) * (i + 1);
        total += g.timestamp * w;
        weightSum += w;
    });

    return total / weightSum;
}

function updateBPM(currentBeatTime: number) {
    // BPM is abstracted using exponentially smoothed inter-beat-interval
    if (lastBeatTimestamp === null) {
        lastBeatTimestamp = currentBeatTime;
        return;
    }

    const observed = currentBeatTime - lastBeatTimestamp;

    // reject huge unexpected jumps
    if (observed > smoothedInterval * MAX_TEMPO_JUMP) {
        // probably missing beats — let virtual beat handler fix
        return;
    }
    if (observed < ON_BEAT_TOLERANCE_MS) {
        smoothedInterval = smoothedInterval
    } else {
        // exponential smoothing
        smoothedInterval = smoothedInterval * 0.7 + observed * 0.3;
    }
}

function getVirtualBeats(currentBeatTime: number): number {
    if (lastBeatTimestamp == null) return 0;

    const observed = currentBeatTime - lastBeatTimestamp;
    const expected = smoothedInterval;
    console.debug("Cal virtual beat, observed:", observed, 'expected', expected)
    if (observed < expected * MAX_TEMPO_JUMP) return 0; // twice as slow

    // Estimate missing beats
    const n = Math.round(observed / expected) - 1;
    console.debug("predicted", n, 'virtual beat')
    return Math.max(0, n);
}

export function getCurrentBpm(): number {
    return 60000 / smoothedInterval;
}

export function resetEngine() {
    pendingNotes.length = 0;
    beatGroups.length = 0;
    lastBeatTimestamp = null;
    smoothedInterval = 500;
}



//======= Debug Events=========
export const PERF_PRESET: NoteEvent[] = [
    // E F GABG | C D E
    // C C C B  | A B C
    { midi: 60, staff: 'bass', timestamp: 0 },
    { midi: 64, staff: 'treble', timestamp: 0 },
    { midi: 60, staff: 'bass', timestamp: 1000 },
    { midi: 65, staff: 'treble', timestamp: 1000 },
    { midi: 60, staff: 'bass', timestamp: 2000 },
    { midi: 67, staff: 'treble', timestamp: 2000 },
    { midi: 69, staff: 'treble', timestamp: 2500 },
    { midi: 59, staff: 'bass', timestamp: 3000 },
    { midi: 71, staff: 'treble', timestamp: 3000 },
    { midi: 67, staff: 'treble', timestamp: 3500 },
    { midi: 57, staff: 'bass', timestamp: 4000 },
    { midi: 72, staff: 'treble', timestamp: 4000 },
    { midi: 59, staff: 'bass', timestamp: 5000 },
    { midi: 74, staff: 'treble', timestamp: 5000 },
    { midi: 60, staff: 'bass', timestamp: 6000 },
    { midi: 76, staff: 'treble', timestamp: 6000 },
];
export const BEAT_TYPE_PRESET: boolean[] = [
    true, true, false, false, false, true, false, true, true, false, true, true, true, true, true, true
]
export const BEAT_PRESET: BeatEvent[] = [
    { timestamp: 0, isDownbeat: true },
    { timestamp: 0, isDownbeat: true },
    // { timestamp: 1000, isDownbeat: false },
    // { timestamp: 1000, isDownbeat: false },
    // { timestamp: 2000, isDownbeat: false },
    // { timestamp: 2000, isDownbeat: false },
    { timestamp: 2500, isDownbeat: false },
    { timestamp: 3000, isDownbeat: false },
    { timestamp: 3000, isDownbeat: false },
    { timestamp: 4000, isDownbeat: true },
    { timestamp: 4000, isDownbeat: true },
    { timestamp: 5000, isDownbeat: false },
    { timestamp: 5000, isDownbeat: false },
    { timestamp: 6000, isDownbeat: false },
    { timestamp: 6000, isDownbeat: false },
];