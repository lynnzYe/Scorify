import React, { useState, useCallback, useEffect, useRef, use } from "react";
import { ScoreDisplay } from "./components/ScoreDisplay";
import { PianoKeyboard } from "./components/PianoKeyboard";
import { ControlPanel } from "./components/ControlPanel";
import { Note, MinBeatLevel, KeySignature } from "./types/music";
import { KEY_SIGNATURES } from "./utils/musicNotation";
import { MIDIControllerEvent, MIDINoteEvent, useMIDI } from "./hooks/useMIDI";
import { useSoundFont } from "./hooks/useSoundFont";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import "./App.css";

import BeatTrackerWrapper from "./model/TSBeatTracker";
import { clickMetronome } from "./utils/metronome";
import {
  addBeat,
  addNote,
  BEAT_PRESET,
  BEAT_TYPE_PRESET,
  BeatEvent,
  drawBuffedNotes,
  NoteEvent,
  PERF_PRESET,
  resetScorify,
  setDrawCallback,
  Staff,
  updateTatum,
} from "./utils/scorify";
import { BEAT_THRES, DOWNBEAT_THRES } from "./model/beat-tracker";

const NDEBUG = true;

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const notesRef = useRef<Note[]>([]);

  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [bpm, setBpm] = useState<number>(120);
  const [minBeatLevel, setMinBeatLevel] = useState<MinBeatLevel>(16);
  const [keySignature, setKeySignature] = useState<KeySignature>(
    KEY_SIGNATURES[0]
  );
  const userBeatOverrideRef = useRef(false);

  const midi = useMIDI();
  const sound = useSoundFont();

  // Track measure start positions in ABSOLUTE coordinates (unaffected by scroll)
  const measureStartPositionsRef = React.useRef<Map<number, number>>(new Map());
  const currentMeasureRef = React.useRef<number>(0);
  const absolutePositionRef = React.useRef<number>(window.innerWidth * 0.5); // Next absolute position to place notes
  const scrollOffsetRef = React.useRef<number>(0); // Track total scroll distance

  /*=============================*
   *     Load Beat Tracker       *
   *=============================*/
  const [loadingMBT, setLoadingMBT] = useState(true);
  const [status, setStatus] = useState("Initializing model...");
  const mbtRef = React.useRef<BeatTrackerWrapper | null>(null);
  const [error, setError] = useState(false);
  const [metronomeStatus, setMetronomeStatus] = useState(false);
  const lastTimeMsRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  function handleMetronomeToggle() {
    setMetronomeStatus((prev) => {
      const newStatus = !prev;
      console.log("Toggle from", prev, "to", newStatus);
      return newStatus;
    });
  }
  useEffect(() => {
    // initialize AudioContext once
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    // Init Midi Beat Tracker (run tests, load model)
    async function initMBT() {
      // try {
      if (!window.my || !window.my.testBeatSS || !window.my.BeatTracker) {
        console.log("ERROR: cannot find window.my (...)");
        setError(true);
        return;
      }

      setStatus("Running model self-test...");
      if (!window._midiTestRan) {
        window._midiTestRan = true;
        await window.my.testBeatSS();
        setStatus("Loading Beat Tracker...");
      }

      mbtRef.current = new BeatTrackerWrapper();
      await mbtRef.current.load();

      setStatus("Ready!");
      setLoadingMBT(false);
    }
    initMBT();
    // Initialize scorify
    setDrawCallback(drawNote);
    updateTatum(computeTatum(minBeatLevel));
  }, []);

  function trackBeat(pitch: number, velocity: number, dbHint: boolean = false) {
    const timeMs = performance.now();
    if (!mbtRef.current) {
      return [0, 0];
    }
    let [beatProbTensor, downbeatProbTensor] = mbtRef.current.track(
      timeMs / 1000,
      pitch,
      velocity,
      dbHint
    );
    const beatProb = beatProbTensor.dataSync()[0];
    const downbeatProb = downbeatProbTensor.dataSync()[0];

    beatProbTensor.dispose();
    downbeatProbTensor.dispose();

    // console output
    const last = lastTimeMsRef.current;
    let dt = last ? ((timeMs - last) / 1000).toFixed(3) : 0;
    const latencyMs = performance.now() - timeMs;
    console.info(
      `⌚ ${dt}s, 🔘 ${pitch} beat=${beatProb.toFixed(
        3
      )} downbeat=${downbeatProb.toFixed(
        3
      )} (end-to-end latency ${latencyMs.toFixed(1)}ms)`
    );
    lastTimeMsRef.current = timeMs;
    return [beatProb, downbeatProb];
  }

  /*=============================*
   *        MIDI Set-up          *
   *=============================*/
  const handleMidiConnect = useCallback(async () => {
    const err = await midi.connect();
    if (err) {
      toast.error(err);
    } else {
      toast.success("MIDI device connected!");
    }
  }, [midi]);

  const handleMidiDisconnect = useCallback(() => {
    midi.disconnect();
    toast.info("MIDI device disconnected");
  }, [midi]);

  function determineStaff(midi: number): Staff {
    if (midi < 60) {
      return "bass";
    }
    return "treble";
  }

  const onDrawBuffedNotes = useCallback(() => {
    drawBuffedNotes();
  }, [drawBuffedNotes]);
  const onAddNote = useCallback(
    (pitch: number, staff: Staff, timestamp: number) => {
      addNote(pitch, staff, timestamp);
    },
    [addNote]
  );
  const onAddBeat = useCallback(
    (timestamp: number, isDownbeat: boolean) => {
      addBeat(timestamp, isDownbeat);
    },
    [addBeat]
  );
  // Setup MIDI event handlers
  const soundRef = useRef(sound); // Fix useEffect triggers multiple onNoteOn
  const metronomeStatusRef = useRef(metronomeStatus);
  const onAddNoteRef = useRef(onAddNote);
  const onAddBeatRef = useRef(onAddBeat);
  const onDrawBuffedNotesRef = useRef(onDrawBuffedNotes);
  const determineStaffRef = useRef(determineStaff);

  useEffect(() => {
    soundRef.current = sound;
    metronomeStatusRef.current = metronomeStatus;
    onAddNoteRef.current = onAddNote;
    onAddBeatRef.current = onAddBeat;
    onDrawBuffedNotesRef.current = onDrawBuffedNotes;
    determineStaffRef.current = determineStaff;
  }, [
    sound,
    // metronomeStatusRef,
    onAddNote,
    onAddBeat,
    onDrawBuffedNotes,
    determineStaff,
  ]);
  const handleController = useCallback((event: MIDIControllerEvent) => {
    // Foot tap overrides downbeat
    console.debug("FOot peDal event:", event);

    if (event.controller === 64 && event.value > 0) {
      userBeatOverrideRef.current = true;
      if (metronomeStatusRef.current && audioContextRef.current) {
        clickMetronome(audioContextRef.current, 1000);
      }
    }
  }, []);
  const handleNoteOn = useCallback((event: MIDINoteEvent) => {
    if (!audioContextRef.current) return;

    const timestamp = audioContextRef.current.currentTime * 1000;
    const { pitch, velocity } = event;

    const [beat_prob, downbeat_prob] = trackBeat(
      pitch,
      velocity,
      userBeatOverrideRef.current
    );
    userBeatOverrideRef.current = false;

    // 🔊 FIX: Use ref version
    if (soundRef.current.isLoaded) {
      soundRef.current.playNote(pitch, velocity);
    }

    onAddNoteRef.current(pitch, determineStaffRef.current(pitch), timestamp);

    if (beat_prob > BEAT_THRES) {
      onAddBeatRef.current(timestamp, downbeat_prob > DOWNBEAT_THRES);
      setTimeout(() => onDrawBuffedNotesRef.current(), 0.01);

      if (metronomeStatusRef.current) {
        clickMetronome(
          audioContextRef.current,
          downbeat_prob > DOWNBEAT_THRES ? 1000 : 500
        );
      }
    }

    setPressedKeys((prev) => new Set([...prev, pitch]));
  }, []);
  const handleNoteOff = useCallback((event: MIDINoteEvent) => {
    const { pitch } = event;

    // Stop sound using ref
    if (soundRef.current.isLoaded) {
      soundRef.current.stopNote(pitch);
    }

    // Update pressed keys safely
    setPressedKeys((prev) => {
      const updated = new Set(prev);
      updated.delete(pitch);
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!midi.isConnected) return;
    const unSubCtrl = midi.onController(handleController);
    const unSubNoteOn = midi.onNoteOn(handleNoteOn);
    const unSubNoteOff = midi.onNoteOff(handleNoteOff);
    return () => {
      unSubCtrl();
      unSubNoteOn();
      unSubNoteOff();
    };
  }, [
    midi.isConnected,
    // sound.isLoaded,
    // onAddNote,
    // onAddBeat,
    // onDrawBuffedNotes,
    // metronomeStatus,
  ]);

  // Show loading status for soundfont
  useEffect(() => {
    if (sound.isLoaded) {
      toast.success("Piano sounds loaded!");
    }
  }, [sound.isLoaded]);

  /*========================================*
   *    Real-time Score Visualization       *
   *========================================*/
  // Calculate spacing between positions (not notes)
  const calculatePositionSpacing = useCallback((minBeat: number): number => {
    const BASE_UNIT = 15; // Minimum distance
    return (16 / minBeat) * BASE_UNIT; // e.g., if minBeat=8, spacing = 2*BASE_UNIT
  }, []);

  // Public API: drawNote function that the transcription algorithm will call
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  const drawNote = useCallback(
    (
      midiPitch: number,
      staff: "treble" | "bass",
      newBar: boolean,
      positionInMeasure: number,
      noteType: 2 | 4 | 8 | 16 | 32,
      currentBpm?: number | null,
      color: "black" | "blue" = "black"
    ) => {
      // Validate that noteType is not finer than minBeatLevel
      // e.g., if minBeatLevel=4 (quarter notes), cannot have 8th (8) or 16th (16) notes
      const drawPitch = midiPitch - 12; // for drawing only
      const pressedPitch = midiPitch; // actual MIDI pitch
      if (noteType > minBeatLevel) {
        console.warn(
          `Note type ${noteType} is finer than min beat level ${minBeatLevel}. Adjusting to ${minBeatLevel}.`
        );
        noteType = minBeatLevel as 2 | 4 | 8 | 16 | 32;
      }

      const positionSpacing = calculatePositionSpacing(minBeatLevel);

      let measureIndex = currentMeasureRef.current;
      let barlineX: number | undefined;

      // Handle new bar
      if (newBar) {
        console.debug("start of new bar!, notes:", notes);
        // Guard logic: Calculate where the barline should be placed
        // Find all notes in the current measure
        const currentMeasureNotes = notesRef.current.filter(
          (n) => n.measureIndex === measureIndex
        );

        let barlinePosition = 0; // Default to start of measure

        if (currentMeasureNotes.length > 0) {
          // console.debug("calculate bar with previous notes");
          // Find the last position index in the measure
          const lastPosition = Math.max(
            ...currentMeasureNotes.map((n) => n.positionInMeasure)
          );

          // Find notes at this last position and get the longest duration
          const notesAtLastPosition = currentMeasureNotes.filter(
            (n) => n.positionInMeasure === lastPosition
          );
          // const longestDuration = Math.min(
          //   ...notesAtLastPosition.map((n) => n.noteType)
          // ); // Smaller number = longer duration

          // Calculate where this note ends based on minBeatLevel
          // Each position represents (16/minBeatLevel) sixteenth notes
          // A note of type N occupies (16/N) sixteenth notes
          // So in position units: (16/N) / (16/minBeatLevel) = minBeatLevel / N
          // e.g., minBeatLevel=16, quarter note (4): 16/4 = 4 positions
          // e.g., minBeatLevel=8, quarter note (4): 8/4 = 2 positions
          // e.g., minBeatLevel=4, quarter note (4): 4/4 = 1 position
          const positionDurations = notesAtLastPosition.map(
            (n) => minBeatLevel / n.noteType
          );
          const maxDuration = Math.max(...positionDurations);
          barlinePosition = lastPosition + maxDuration;
          // barlinePosition = lastPosition + positionDuration;
          // console.debug(
          //   "bar position: ",
          //   barlinePosition,
          //   "lastpos:",
          //   lastPosition,
          //   "notes:",
          //   notesAtLastPosition
          // );
        }

        // Get the absolute X coordinate for the barline
        const absoluteMeasureStartX =
          measureStartPositionsRef.current.get(measureIndex) ||
          absolutePositionRef.current;
        const absoluteBarlineX =
          absoluteMeasureStartX + barlinePosition * positionSpacing + 30;
        barlineX = absoluteBarlineX - scrollOffsetRef.current; // Convert to screen position

        // Start a new measure
        currentMeasureRef.current += 1;
        measureIndex = currentMeasureRef.current;

        const newMeasureStartAbsolute = absoluteBarlineX + 30;
        measureStartPositionsRef.current.set(
          measureIndex,
          newMeasureStartAbsolute
        );
        absolutePositionRef.current = newMeasureStartAbsolute;
      } else {
        // Ensure current measure has a start position
        if (!measureStartPositionsRef.current.has(measureIndex)) {
          measureStartPositionsRef.current.set(
            measureIndex,
            absolutePositionRef.current
          );
        }
      }

      // Get measure start position in ABSOLUTE coordinates
      const absoluteMeasureStartX =
        measureStartPositionsRef.current.get(measureIndex)!;

      // Calculate absolute X position based on position in measure (grid-based)
      const absoluteXPosition =
        absoluteMeasureStartX + positionInMeasure * positionSpacing;

      // Convert to screen position by applying scroll offset
      const xPosition = absoluteXPosition - scrollOffsetRef.current;

      // Update absolute position tracker (for next note/bar)
      if (absoluteXPosition > absolutePositionRef.current) {
        absolutePositionRef.current = absoluteXPosition;
      }

      const newNote: Note = {
        id: `note-${Date.now()}-${Math.random()}`,
        midiPitch: drawPitch,
        staff,
        newBar,
        positionInMeasure,
        noteType,
        timestamp: Date.now(),
        xPosition,
        measureIndex,
        barlineX,
        color,
      };
      // console.debug("Set notes:", notes, newNote);
      setNotes((prev) => [...prev, newNote]); // Just append, don't filter

      if (currentBpm) {
        setBpm(currentBpm);
      }

      // Update pressed keys visualization
      if (midiPitch > 0) {
        setPressedKeys((prev) => new Set([...prev, pressedPitch]));

        // Auto-release after a short duration (simulated)
        setTimeout(() => {
          setPressedKeys((prev) => {
            const updated = new Set(prev);
            updated.delete(pressedPitch);
            return updated;
          });
        }, 200);
      }
    },
    [minBeatLevel, calculatePositionSpacing, notes]
  );

  // Expose drawNote to window for external API access
  useEffect(() => {
    (window as any).drawNote = drawNote;

    return () => {
      delete (window as any).drawNote;
    };
  }, [drawNote]);

  // Handle scroll offset updates from ScoreDisplay
  const handleScrollOffsetUpdate = useCallback((offset: number) => {
    scrollOffsetRef.current = offset;
  }, []);

  // Demo mode: simulate transcription with keyboard
  const positionCounterRef = React.useRef<number>(0);
  const beatCounterRef = React.useRef<number>(0);

  const handleClear = useCallback(() => {
    setNotes([]);
    setPressedKeys(new Set());
    resetScorify();
    sound.stopAllNotes();
    currentMeasureRef.current = 0;
    measureStartPositionsRef.current.clear();
    absolutePositionRef.current = window.innerWidth * 0.5;
    positionCounterRef.current = 0;
    beatCounterRef.current = 0;
    scrollOffsetRef.current = 0;
    mbtRef.current?.reset();
    setDrawCallback(drawNote);
  }, []);

  /*========================================*
   *       Draw note Keyboard Debugs        *
   *========================================*/
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (NDEBUG) {
        return;
      }
      // Demo: use keyboard keys to simulate note input
      // Treble staff scale: E4(64) to F5(77)
      // Bass staff scale: G2(43) to A3(57)
      const keyMap: {
        [key: string]: { midi: number; staff: "treble" | "bass" };
      } = {
        // Treble clef - C major scale from C4 to C6
        q: { midi: 72, staff: "treble" }, // C5
        w: { midi: 74, staff: "treble" }, // D5
        e: { midi: 76, staff: "treble" }, // E5
        r: { midi: 77, staff: "treble" }, // F5
        t: { midi: 79, staff: "treble" }, // G5
        y: { midi: 81, staff: "treble" }, // A5
        u: { midi: 83, staff: "treble" }, // B5
        i: { midi: 84, staff: "treble" }, // C6

        a: { midi: 60, staff: "treble" }, // C4 (middle C)
        s: { midi: 62, staff: "treble" }, // D4
        d: { midi: 64, staff: "treble" }, // E4
        f: { midi: 65, staff: "treble" }, // F4
        g: { midi: 67, staff: "treble" }, // G4
        h: { midi: 69, staff: "treble" }, // A4
        j: { midi: 71, staff: "treble" }, // B4

        // Bass clef - lower notes
        z: { midi: 48, staff: "bass" }, // C3
        x: { midi: 50, staff: "bass" }, // D3
        c: { midi: 52, staff: "bass" }, // E3
        v: { midi: 53, staff: "bass" }, // F3
        b: { midi: 55, staff: "bass" }, // G3
        n: { midi: 57, staff: "bass" }, // A3
        m: { midi: 59, staff: "bass" }, // B3
      };

      const noteInfo = keyMap[e.key.toLowerCase()];
      if (noteInfo) {
        const noteTypes: (2 | 4 | 8 | 16)[] = [2, 4, 4, 8, 8, 16];
        const noteType =
          noteTypes[Math.floor(Math.random() * noteTypes.length)];

        // Current position, then advance by random [0, 1, 2, 3]
        const position = positionCounterRef.current;
        const advancement = Math.floor(Math.random() * 4);
        positionCounterRef.current += advancement;

        drawNote(noteInfo.midi, noteInfo.staff, false, position, noteType, bpm);
      }

      // Press 0 for rest
      if (e.key === "0") {
        const noteTypes: (4 | 8 | 16)[] = [4, 8, 16];
        const noteType =
          noteTypes[Math.floor(Math.random() * noteTypes.length)];

        const position = positionCounterRef.current;
        const advancement = Math.floor(Math.random() * 4);
        positionCounterRef.current += advancement;

        drawNote(0, "treble", false, position, noteType, bpm);
      }

      // Press Enter for new barline
      if (e.key === "Enter") {
        positionCounterRef.current = 0; // Reset for new measure
        drawNote(67, "treble", true, 0, 8, bpm); // Note at position 0 in new measure
      }
    };

    window.addEventListener("keypress", handleKeyPress);
    return () => window.removeEventListener("keypress", handleKeyPress);
  }, [drawNote, bpm]);

  /*========================================*
   *    Real-time Scorification Debugs      *
   *========================================*/
  useEffect(() => {
    const handleScorifyKeyPress = (e: KeyboardEvent) => {
      if (NDEBUG) {
        return;
      }
      // console.debug("scorify button pressed.")
      // Demo: use keyboard keys to simulate note input
      // Treble staff scale: E4(64) to F5(77)
      // Bass staff scale: G2(43) to A3(57)
      // Use predefined sequence of performance & beat tracking results, fixed delta time.

      // Current position
      const position = positionCounterRef.current;
      const beatPos = beatCounterRef.current;
      const isBeat = BEAT_TYPE_PRESET[position];
      const note: NoteEvent = PERF_PRESET[position];
      const beat: BeatEvent = BEAT_PRESET[beatPos];
      addNote(note.midi, note.staff, note.timestamp);
      if (isBeat) {
        addBeat(beat.timestamp, beat.isDownbeat);
        drawBuffedNotes();
      }
      positionCounterRef.current += 1;
      if (isBeat) {
        beatCounterRef.current += 1;
      }
    };

    window.addEventListener("keypress", handleScorifyKeyPress);
    return () => window.removeEventListener("keypress", handleScorifyKeyPress);
  }, [drawNote, bpm]);

  function computeTatum(level: number, timeSignature: number[] = [4, 4]) {
    /*
    - param level: min beat level, 4 for quarter note etc.
      - e.g. at 4/4, 16th notes: tatum is 4 (4*4), 8th notes: tatum is 2 (2*4), quarter: tatum is 1
    */
    const nbeat = timeSignature[0];
    const beatType = timeSignature[1];

    // TODO: compute tatum based on time signature
    return Math.round(level / 4);
  }
  /*========================================*
   *           Begin Components             *
   *========================================*/
  if (loadingMBT) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>{status}</p>
      </div>
    );
  }

  if (error)
    return (
      <div className="error-screen">
        <h2>⚠️ Initialization failed</h2>
        <p>{error}</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <Toaster />
        <div className="text-center space-y-2">
          <h1
            style={{ fontSize: "3rem", fontWeight: "bold", color: "#143f7bff" }}
          >
            Real-Time "Scorification"
          </h1>
        </div>

        {/* Control Panel */}
        <ControlPanel
          minBeatLevel={minBeatLevel}
          onMinBeatLevelChange={(level) => {
            setMinBeatLevel(level);
            updateTatum(computeTatum(level)); // TODO Tatum should change according to time signature & min beat level. for now just assume 4/4
            // Reset positioning when min beat level changes
            handleClear();
          }}
          keySignature={keySignature}
          onKeySignatureChange={setKeySignature}
          onClear={handleClear}
          midiConnected={midi.isConnected}
          onMidiConnect={handleMidiConnect}
          onMidiDisconnect={handleMidiDisconnect}
          metronomeOn={metronomeStatus}
          onMetronomeClick={handleMetronomeToggle}
        />

        {/* Score Display - Upper Half */}
        <div className="h-96 bg-white rounded-lg shadow-lg">
          <ScoreDisplay
            notes={notes}
            bpm={bpm}
            keySignature={keySignature}
            minBeatLevel={minBeatLevel}
            onNotesUpdate={setNotes}
            onScrollOffsetUpdate={handleScrollOffsetUpdate}
          />
        </div>

        {/* Piano Keyboard - Lower Half */}
        <div className="space-y-2">
          <h2 className="text-gray-700 text-sm">88-Key Piano Keyboard</h2>
          <PianoKeyboard pressedKeys={pressedKeys} />
        </div>
        <h4>Tips</h4>
        <ul className="text-gray-600 text-sm">
          <li>1. On-beat notes are purple. Off-beat notes are black.</li>
          <li>2. You can hint the model by foot tapping on a pedal!</li>
          <li>
            3. Scorification currently only supports 3/4, 4/4, 6/4 ... (any
            meter ending with 4 or 2). But beat tracking supports any meter
            covered in the training data (ASAP, CPM, A-MAPS)
          </li>
          <li>
            4. Occasionally some notes may not be drawn (bugs in scorify.ts).
          </li>
          <li>
            5. Scorification (specifically drawNote) can break possibly due to
            tempo changes... As a result, you may find the score flowing too
            quickly, or bar line mismatch. Click [Clear Score] to 'fix' this..
          </li>
        </ul>
        {/* Stats and API Reference */}
        {/* <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
            <h3 className="text-green-900 mb-2">Current Settings</h3>
            <div className="text-green-800 space-y-1">
              <p>
                Min Beat Level:{" "}
                <span className="font-mono">{minBeatLevel}th notes</span>
              </p>
              <p>
                Position Spacing:{" "}
                <span className="font-mono">{(16 / minBeatLevel) * 15}px</span>
              </p>
              <p>
                BPM: <span className="font-mono">{bpm}</span>
              </p>
              <p>
                Key: <span className="font-mono">{keySignature.name}</span>
              </p>
              <p>
                Notes on screen:{" "}
                <span className="font-mono">{notes.length}</span>
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
            <h3 className="text-blue-900 mb-2">API Usage</h3>
            <pre className="text-blue-800 font-mono text-xs overflow-x-auto">
              {`window.drawNote(
  midiPitch: number,
  staff: 'treble' | 'bass',
  newBar: boolean,
  positionInMeasure: number,  // Grid index
  noteType: 2 | 4 | 8 | 16,   // Visual only
  bpm?: number
);`}
            </pre>
          </div>
        </div> */}
      </div>
    </div>
  );
}
