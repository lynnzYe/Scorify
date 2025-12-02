import { BEAT_THRES, DOWNBEAT_THRES } from "../model/beat-tracker";

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
let defaultTatum = 2; // default: 8th note quantization
const MAX_TEMPO_JUMP = 1.5;
const ON_BEAT_TOLERANCE_MS = 70;

// BPM tracking
let lastBeatTimestamp: number | null = null;
let smoothedInterval = 500; // Default 120 BPM
let isFirstBeat = true;

// State to track grouping logic
let lastProcessedGroupIndex = -1;
let groupTriggeredNewBar = false;

// ============================
// Public API
// ============================

export function setDrawCallback(cb: DrawNoteFn) {
    drawCallback = cb;
}

export function addNote(midi: number, staff: Staff, timestamp: number) {
    pendingNotes.push({ midi, staff, timestamp });
}

export function addBeat(timestamp: number, isDownbeat: boolean) {
    groupBeat(timestamp, isDownbeat);
}

export function resetScorify() {
    pendingNotes = [];
    beatGroups = [];
    lastBeatTimestamp = null;
    smoothedInterval = 500;
    isFirstBeat = true;
    currentMeasureTatumIndex = 0;
    lastProcessedGroupIndex = -1;
    groupTriggeredNewBar = false;
}

export function updateTatum(tatum: number) {
    defaultTatum = tatum;
}

export function drawBuffedNotes() {
    if (beatGroups.length === 0) return;
    if (!(window as any).drawNote) return;

    const currentGroupIndex = beatGroups.length - 1;
    const latestGroup = beatGroups[currentGroupIndex];
    const beatTime = weightedBeatOnsetTime(latestGroup);

    updateBPM(beatTime);

    // Check if we are processing the same group (chord/simultaneous notes)
    const isSameGroup = currentGroupIndex === lastProcessedGroupIndex;

    let tatumsInGap = 0;
    let virtualBeats = 0;

    // Only calculate gap/advance grid if this is a NEW beat group
    if (!isSameGroup) {
        virtualBeats = getVirtualBeats(beatTime);
        // Advance by 1 beat + any missed beats
        tatumsInGap = (1 + virtualBeats) * defaultTatum;
        // Reset the new bar trigger flag for this new group
        groupTriggeredNewBar = false;
    } else {
        // We are in the same beat group (e.g., 2nd note of a chord)
        // Time has not structurally advanced
        tatumsInGap = 0;
    }

    // Determine context for interpolation (Linear time mapping)
    // If first beat ever, use smoothedInterval as proxy for previous time
    const prevBeatTime = lastBeatTimestamp !== null && !isSameGroup
        ? lastBeatTimestamp
        : (beatTime - smoothedInterval);

    const beatDuration = Math.max(1, beatTime - prevBeatTime);

    // A group is a downbeat if the first detection in it was a downbeat
    const isDownbeat = isFirstBeat || (latestGroup[0].isDownbeat && Math.abs(latestGroup[0].timestamp - beatTime) < GROUP_WINDOW_MS);

    let firstDownbeatProcessed = false;
    const notesToDraw = [...pendingNotes].sort((a, b) => a.timestamp - b.timestamp);

    for (const note of notesToDraw) {
        // Calculate interpolation
        const delta = note.timestamp - prevBeatTime;
        const isOnCurrentBeat = Math.abs(note.timestamp - beatTime) < ON_BEAT_TOLERANCE_MS;

        // Map time to grid units
        // If same group, tatumsInGap is 0, so index is 0 (correct, they stack)
        let index = isOnCurrentBeat
            ? tatumsInGap
            : Math.round((delta / beatDuration) * tatumsInGap);

        if (index < 0) index = 0;
        if (index > tatumsInGap) index = tatumsInGap;

        // Calculate position relative to the START of the previous beat
        let positionInMeasure = currentMeasureTatumIndex + index;

        // Handle Downbeat / New Bar Logic
        let sendNewBar = false;

        if (isDownbeat && isOnCurrentBeat) {
            // Only trigger a new bar if:
            // 1. This group hasn't triggered one yet (prevents double bars for chords)
            // 2. This is the first note in the current batch processing loop
            if (!groupTriggeredNewBar && !firstDownbeatProcessed) {
                sendNewBar = true;
                groupTriggeredNewBar = true;
                firstDownbeatProcessed = true;
            }
            // Reset position to 0 for the new measure
            positionInMeasure = 0;
        }

        const color = isOnCurrentBeat ? 'blue' : "black";

        (window as any).drawNote(
            note.midi,
            note.staff,
            sendNewBar,
            positionInMeasure,
            8,
            null,
            color
        );
    }

    // Advance Global Grid State
    if (!isSameGroup) {
        // If we moved to a new beat group, advance the grid
        if (isDownbeat) {
            currentMeasureTatumIndex = 0;
        } else {
            currentMeasureTatumIndex += tatumsInGap;
        }
    } else {
        // If same group, we don't advance the grid, 
        // BUT if it turned out to be a downbeat now, ensure we reset index
        if (isDownbeat) {
            currentMeasureTatumIndex = 0;
        }
    }

    pendingNotes = [];
    lastBeatTimestamp = beatTime;
    lastProcessedGroupIndex = currentGroupIndex;
    isFirstBeat = false;
}

export type DrawNoteFn = (
    midiPitch: number,
    staff: Staff,
    newBar: boolean,
    positionInMeasure: number,
    noteType: 2 | 4 | 8 | 16 | 32,
    currentBpm?: number | null
) => void;

let pendingNotes: NoteEvent[] = [];
let beatGroups: BeatEvent[][] = [];
let currentMeasureTatumIndex = 0;
let drawCallback: DrawNoteFn | null = null;

function groupBeat(timestamp: number, isDownbeat: boolean) {
    if (beatGroups.length === 0) {
        beatGroups.push([{ timestamp, isDownbeat }]);
        return;
    }
    const group = beatGroups[beatGroups.length - 1];
    const last = group[group.length - 1];
    if (timestamp - last.timestamp < GROUP_WINDOW_MS) {
        group.push({ timestamp, isDownbeat });
    } else {
        beatGroups.push([{ timestamp, isDownbeat }]);
    }
}

function weightedBeatOnsetTime(group: BeatEvent[]): number {
    if (group.length === 0) return 0;
    if (group.length === 1) return group[0].timestamp;
    let total = 0;
    let weightSum = 0;
    group.forEach((g, i) => {
        const w = (i + 1) * (i + 1);
        total += g.timestamp * w;
        weightSum += w;
    });
    return total / weightSum;
}

function updateBPM(currentBeatTime: number) {
    if (lastBeatTimestamp === null) {
        lastBeatTimestamp = currentBeatTime;
        return;
    }
    const observed = currentBeatTime - lastBeatTimestamp;
    // sanity checks
    if (observed > smoothedInterval * MAX_TEMPO_JUMP) return;
    if (observed < 150) return; // debounce

    // smoothing
    smoothedInterval = smoothedInterval * 0.7 + observed * 0.3;
}

function getVirtualBeats(currentBeatTime: number): number {
    if (lastBeatTimestamp == null) return 0;
    const observed = currentBeatTime - lastBeatTimestamp;
    const expected = smoothedInterval;

    if (observed < expected * 1.5) return 0;

    const n = Math.round(observed / expected) - 1;
    return Math.max(0, n);
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