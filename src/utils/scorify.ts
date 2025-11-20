interface NoteEvent { timestamp: number; pitch: number; velocity: number; onBeat: boolean, onDownbeat: boolean, drawn?: boolean; }
interface BeatEvent { timestamp: number; type: 'beat' | 'downbeat'; probability: number; }

let pendingNotes: NoteEvent[] = [];
let beatHistory: BeatEvent[] = [];
let drawCallback: (
    midiPitch: number,
    staff: "treble" | "bass",
    newBar: boolean,
    positionInMeasure: number,
    noteType: 2 | 4 | 8 | 16 | 32,
    currentBpm?: number) => void;

export function setDrawCallback(cb: typeof drawCallback) {
    drawCallback = cb;
}

export function addNote(pitch: number, velocity: number, onBeat: boolean, onDownbeat: boolean) {
    pendingNotes.push({ timestamp: performance.now(), pitch, velocity, onBeat, onDownbeat });
}

export function addBeat(timestamp: number, type: 'beat' | 'downbeat') {
    beatHistory.push({ timestamp, type, probability: 1 });
    fillNotes(); // automatically process pending notes
}

function fillNotes() {
    if (!drawCallback || beatHistory.length < 2) return;

    const lastDownbeat = beatHistory.slice().reverse().find(b => b.type === 'downbeat');
    if (!lastDownbeat) return;

    const bpm = estimateBPM();
    const beatInterval = 60000 / bpm;

    pendingNotes.forEach(note => {
        if (note.drawn) return;
        const delta = note.timestamp - lastDownbeat.timestamp;
        const positionInMeasure = delta / beatInterval;
        drawCallback(note.pitch, 'treble', note.onDownbeat, 0, 2, bpm);
        note.drawn = true;
    });

    pendingNotes = pendingNotes.filter(n => !n.drawn);
}

function estimateBPM() {
    const recentBeats = beatHistory.slice(-8);
    if (recentBeats.length < 2) return 120;
    const intervals = [];
    for (let i = 1; i < recentBeats.length; i++) intervals.push(recentBeats[i].timestamp - recentBeats[i - 1].timestamp);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return 60000 / avgInterval;
}