import React, { useState, useCallback, useEffect, useRef } from "react";
import { ScoreDisplay } from "./components/ScoreDisplay";
import { PianoKeyboard } from "./components/PianoKeyboard";
import { ControlPanel } from "./components/ControlPanel";
import { Note, MinBeatLevel, KeySignature } from "./types/music";
import { KEY_SIGNATURES } from "./utils/musicNotation";
import { useMIDI } from "./hooks/useMIDI";
import { useSoundFont } from "./hooks/useSoundFont";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import "./App.css";

import BeatTrackerWrapper from "./model/TSBeatTracker";
import { clickMetronome } from "./utils/metronome";

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [bpm, setBpm] = useState<number>(120);
  const [minBeatLevel, setMinBeatLevel] = useState<MinBeatLevel>(16);
  const [keySignature, setKeySignature] = useState<KeySignature>(
    KEY_SIGNATURES[0]
  );

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
    console.log("DEBUG: handle metro toggle. current status:", metronomeStatus);
    setMetronomeStatus(!metronomeStatus);
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
  }, []);

  function trackBeat(pitch: number, velocity: number) {
    const timeMs = performance.now();
    if (!mbtRef.current) {
      return [0, 0];
    }
    let [beatProbTensor, downbeatProbTensor] = mbtRef.current.track(
      timeMs / 1000,
      pitch,
      velocity
    );
    const beatProb = beatProbTensor.dataSync()[0];
    const downbeatProb = downbeatProbTensor.dataSync()[0];

    beatProbTensor.dispose();
    downbeatProbTensor.dispose();

    // console output
    const last = lastTimeMsRef.current;
    let dt = last ? ((timeMs - last) / 1000).toFixed(3) : 0;
    const latencyMs = performance.now() - timeMs;
    console.log(
      `⌚ ${dt}s, 🔘 ${pitch} beat=${beatProb.toFixed(
        3
      )} downbeat=${downbeatProb.toFixed(3)} (latency ${latencyMs.toFixed(
        1
      )}ms)`
    );
    lastTimeMsRef.current = timeMs;
    return [beatProb, downbeatProb];
  }

  /*=============================*
   *        MIDI Set-up          *
   *=============================*/
  const handleMidiConnect = useCallback(async () => {
    await midi.connect();
    if (midi.error) {
      toast.error(midi.error);
    } else {
      toast.success("MIDI device connected!");
    }
  }, [midi]);

  const handleMidiDisconnect = useCallback(() => {
    midi.disconnect();
    toast.info("MIDI device disconnected");
  }, [midi]);

  // Setup MIDI event handlers
  useEffect(() => {
    console.log("DEBUG Midi connected?", midi.isConnected);
    if (!midi.isConnected) return;

    // Handle MIDI note on (pass in callback)
    midi.onNoteOn((event) => {
      console.log("DEBUG Detected midi note on event");
      const { pitch, velocity } = event;
      const [beat_prob, downbeat_prob] = trackBeat(pitch, velocity);
      // Play sound
      if (sound.isLoaded) {
        sound.playNote(pitch, velocity);
      }
      // If beat / downbeat && play beats.
      if (metronomeStatus && audioContextRef.current) {
        if (beat_prob > 0.5) {
          clickMetronome(audioContextRef.current, 500);
        }
        if (downbeat_prob > 0.5) {
          clickMetronome(audioContextRef.current, 1000);
        }
      }

      // Highlight key
      setPressedKeys((prev) => new Set([...prev, pitch]));
    });

    // Handle MIDI note off
    midi.onNoteOff((event) => {
      const { pitch } = event;
      // Stop sound
      if (sound.isLoaded) {
        sound.stopNote(pitch);
      }
      // Remove highlighed key
      setPressedKeys((prev) => {
        const updated = new Set(prev);
        updated.delete(pitch);
        return updated;
      });
    });
  }, [midi.isConnected, sound.isLoaded]);

  // Show loading status for soundfont
  useEffect(() => {
    if (sound.isLoaded) {
      toast.success("Piano sounds loaded!");
    }
  }, [sound.isLoaded]);

  /*========================================*
   *    Real-time Score Visualization       *
   *========================================*/

  // Fixed measure width (in position units) - standard 4/4 measure with 16th notes = 16 positions
  const POSITIONS_PER_MEASURE = 16;

  // Calculate spacing between positions (not notes)
  const calculatePositionSpacing = useCallback((minBeat: number): number => {
    const BASE_UNIT = 15; // Minimum distance
    return (16 / minBeat) * BASE_UNIT; // e.g., if minBeat=8, spacing = 2*BASE_UNIT
  }, []);

  // Public API: drawNote function that the transcription algorithm will call
  const drawNote = useCallback(
    (
      midiPitch: number,
      staff: "treble" | "bass",
      newBar: boolean,
      positionInMeasure: number,
      noteType: 2 | 4 | 8 | 16 | 32,
      currentBpm?: number
    ) => {
      // Validate that noteType is not finer than minBeatLevel
      // e.g., if minBeatLevel=4 (quarter notes), cannot have 8th (8) or 16th (16) notes
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
        // Guard logic: Calculate where the barline should be placed
        // Find all notes in the current measure
        const currentMeasureNotes = notes.filter(
          (n) => n.measureIndex === measureIndex
        );

        let barlinePosition = 0; // Default to start of measure

        if (currentMeasureNotes.length > 0) {
          // Find the last position index in the measure
          const lastPosition = Math.max(
            ...currentMeasureNotes.map((n) => n.positionInMeasure)
          );

          // Find notes at this last position and get the longest duration
          const notesAtLastPosition = currentMeasureNotes.filter(
            (n) => n.positionInMeasure === lastPosition
          );
          const longestDuration = Math.min(
            ...notesAtLastPosition.map((n) => n.noteType)
          ); // Smaller number = longer duration

          // Calculate where this note ends based on minBeatLevel
          // Each position represents (16/minBeatLevel) sixteenth notes
          // A note of type N occupies (16/N) sixteenth notes
          // So in position units: (16/N) / (16/minBeatLevel) = minBeatLevel / N
          // e.g., minBeatLevel=16, quarter note (4): 16/4 = 4 positions
          // e.g., minBeatLevel=8, quarter note (4): 8/4 = 2 positions
          // e.g., minBeatLevel=4, quarter note (4): 4/4 = 1 position
          const positionDuration = minBeatLevel / longestDuration;
          barlinePosition = lastPosition + positionDuration;
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
        midiPitch,
        staff,
        newBar,
        positionInMeasure,
        noteType,
        timestamp: Date.now(),
        xPosition,
        measureIndex,
        barlineX,
      };

      setNotes((prev) => [...prev, newNote]); // Just append, don't filter

      if (currentBpm) {
        setBpm(currentBpm);
      }

      // Update pressed keys visualization
      if (midiPitch > 0) {
        setPressedKeys((prev) => new Set([...prev, midiPitch]));

        // Auto-release after a short duration (simulated)
        setTimeout(() => {
          setPressedKeys((prev) => {
            const updated = new Set(prev);
            updated.delete(midiPitch);
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

  const handleClear = useCallback(() => {
    setNotes([]);
    setPressedKeys(new Set());
    sound.stopAllNotes();
    currentMeasureRef.current = 0;
    measureStartPositionsRef.current.clear();
    absolutePositionRef.current = window.innerWidth * 0.5;
    positionCounterRef.current = 0;
    scrollOffsetRef.current = 0;
  }, []);

  /*========================================*
   *       Draw note Keyboard Debugs        *
   *========================================*/
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
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
            Real-Time Piano Score Transcription
          </h1>
          <p className="text-gray-600 text-sm">
            Demo: Q-I (upper), A-J (lower), Z-M (bass), 0 (rest), Enter (new
            bar) - Position advances by random [0-3]
          </p>
        </div>

        {/* Control Panel */}
        <ControlPanel
          minBeatLevel={minBeatLevel}
          onMinBeatLevelChange={(level) => {
            setMinBeatLevel(level);
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

        {/* Stats and API Reference */}
        <div className="grid grid-cols-2 gap-4">
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
        </div>
      </div>
    </div>
  );
}
