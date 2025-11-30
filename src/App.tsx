import React, { useState, useCallback, useEffect, useRef } from "react";
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

// Helper to calculate constant spacing
const BASE_UNIT = 15;
const calculatePositionSpacing = (minBeat: number): number => {
  return (16 / minBeat) * BASE_UNIT;
};

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);

  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [bpm, setBpm] = useState<number>(120);
  const [minBeatLevel, setMinBeatLevel] = useState<MinBeatLevel>(16);
  const [keySignature, setKeySignature] = useState<KeySignature>(
    KEY_SIGNATURES[0]
  );
  const userBeatOverrideRef = useRef(false);

  const midi = useMIDI();
  const sound = useSoundFont();

  // --- SYNCHRONOUS LAYOUT STATE ---
  // We use this Ref to track layout immediately, bypassing React render cycles
  const layoutStateRef = useRef({
    currentMeasureIndex: 0,
    measureStartAbsoluteX: window.innerWidth * 0.5, // Start somewhat in middle
    absoluteHeadX: window.innerWidth * 0.5, // The furthest right point drawn so far
    currentMeasureNotes: [] as { position: number; duration: number }[], // Shadow copy for barline calc
  });

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
    setMetronomeStatus((prev) => !prev);
  }

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    async function initMBT() {
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
    setDrawCallback(drawNote);
    updateTatum(computeTatum(minBeatLevel));
  }, []);

  // ... [Keep trackBeat, handleMidiConnect, handleMidiDisconnect, determineStaff] ...

  function trackBeat(pitch: number, velocity: number, dbHint: boolean = false) {
    const timeMs = performance.now();
    if (!mbtRef.current) return [0, 0];

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
    lastTimeMsRef.current = timeMs;
    return [beatProb, downbeatProb];
  }

  const handleMidiConnect = useCallback(async () => {
    const err = await midi.connect();
    if (err) toast.error(err);
    else toast.success("MIDI device connected!");
  }, [midi]);

  const handleMidiDisconnect = useCallback(() => {
    midi.disconnect();
    toast.info("MIDI device disconnected");
  }, [midi]);

  function determineStaff(midi: number): Staff {
    return midi < 60 ? "bass" : "treble";
  }

  // Wrappers to avoid dependency cycles in useEffect
  const onAddNote = useCallback(
    (pitch: number, staff: Staff, timestamp: number) => {
      addNote(pitch, staff, timestamp);
    },
    []
  );
  const onAddBeat = useCallback((timestamp: number, isDownbeat: boolean) => {
    addBeat(timestamp, isDownbeat);
  }, []);
  const onDrawBuffedNotes = useCallback(() => {
    drawBuffedNotes();
  }, []);

  // MIDI Event Handlers
  const soundRef = useRef(sound);
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
    onAddNote,
    onAddBeat,
    onDrawBuffedNotes,
    determineStaff,
    metronomeStatus,
  ]);

  const handleController = useCallback((event: MIDIControllerEvent) => {
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

    if (soundRef.current.isLoaded) {
      soundRef.current.playNote(pitch, velocity);
    }

    onAddNoteRef.current(pitch, determineStaffRef.current(pitch), timestamp);

    if (beat_prob > BEAT_THRES) {
      onAddBeatRef.current(timestamp, downbeat_prob > DOWNBEAT_THRES);
      // Run mostly immediately
      setTimeout(() => onDrawBuffedNotesRef.current(), 0);

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
    if (soundRef.current.isLoaded) soundRef.current.stopNote(pitch);
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
  }, [midi.isConnected]);

  // Show loading status
  useEffect(() => {
    if (sound.isLoaded) toast.success("Piano sounds loaded!");
  }, [sound.isLoaded]);

  /*========================================*
   *    Real-time Score Visualization       *
   *========================================*/

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
      // 1. Enforce minBeatLevel constraints
      const drawPitch = midiPitch - 12; // visual adjustment
      if (noteType > minBeatLevel) {
        noteType = minBeatLevel as any;
      }

      const positionSpacing = calculatePositionSpacing(minBeatLevel);
      const layout = layoutStateRef.current;

      let barlineX: number | undefined;

      // 2. Handle Bar Logic synchronously using LayoutRef
      if (newBar) {
        // Calculate where previous measure ended based on contents
        let barlineRelativePos = 0;

        if (layout.currentMeasureNotes.length > 0) {
          const lastPosition = Math.max(
            ...layout.currentMeasureNotes.map((n) => n.position)
          );
          const notesAtLastPos = layout.currentMeasureNotes.filter(
            (n) => n.position === lastPosition
          );

          // Calculate duration in terms of grid positions
          const positionDurations = notesAtLastPos.map(
            (n) => minBeatLevel / n.duration
          );
          const maxDuration = Math.max(...positionDurations);
          barlineRelativePos = lastPosition + maxDuration;
        }

        // Calculate Absolute X for barline
        const absoluteBarlineX =
          layout.measureStartAbsoluteX +
          barlineRelativePos * positionSpacing +
          30; // 30px padding
        barlineX = absoluteBarlineX;

        // Reset Layout for new measure
        layout.currentMeasureIndex += 1;
        layout.measureStartAbsoluteX = absoluteBarlineX + 30; // Start new measure after barline + padding
        layout.currentMeasureNotes = []; // Clear shadow notes
      }

      // 3. Calculate Absolute Note Position
      const absoluteX =
        layout.measureStartAbsoluteX + positionInMeasure * positionSpacing;

      // Update head (furthest point)
      if (absoluteX > layout.absoluteHeadX) {
        layout.absoluteHeadX = absoluteX;
      }

      // Add to shadow list for next bar calculation
      layout.currentMeasureNotes.push({
        position: positionInMeasure,
        duration: noteType,
      });

      // 4. Create Note Object (using AbsoluteX, NOT screen X)
      const newNote: Note = {
        id: `note-${Date.now()}-${Math.random()}`,
        midiPitch: drawPitch,
        staff,
        newBar,
        positionInMeasure,
        noteType,
        timestamp: Date.now(),
        absoluteX: absoluteX, // NEW FIELD
        measureIndex: layout.currentMeasureIndex,
        barlineX,
        color,
      };

      setNotes((prev) => [...prev, newNote]);

      if (currentBpm) setBpm(currentBpm);

      // Visual feedback key
      if (midiPitch > 0) {
        const pressedPitch = midiPitch;
        setPressedKeys((prev) => new Set([...prev, pressedPitch]));
        setTimeout(() => {
          setPressedKeys((prev) => {
            const updated = new Set(prev);
            updated.delete(pressedPitch);
            return updated;
          });
        }, 200);
      }
    },
    [minBeatLevel]
  );

  // Expose to window
  useEffect(() => {
    (window as any).drawNote = drawNote;
    return () => {
      delete (window as any).drawNote;
    };
  }, [drawNote]);

  const handleClear = useCallback(() => {
    setNotes([]);
    setPressedKeys(new Set());
    resetScorify();
    sound.stopAllNotes();
    mbtRef.current?.reset();

    // Reset Layout Ref
    layoutStateRef.current = {
      currentMeasureIndex: 0,
      measureStartAbsoluteX: window.innerWidth * 0.5,
      absoluteHeadX: window.innerWidth * 0.5,
      currentMeasureNotes: [],
    };

    setDrawCallback(drawNote);
  }, [drawNote, sound]);

  // Demo Keyboard Hooks (Simplified for brevity, same as original logic but calling drawNote)
  const positionCounterRef = React.useRef<number>(0);
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (NDEBUG) return;
      if (e.key === "c") handleClear();
      // ... [Insert previous keyboard demo logic here if needed] ...
    };
    window.addEventListener("keypress", handleKeyPress);
    return () => window.removeEventListener("keypress", handleKeyPress);
  }, [handleClear]);

  useEffect(() => {
    // Scorify demo keys logic...
    const handleScorifyKeyPress = (e: KeyboardEvent) => {
      if (NDEBUG) return;
      // ... [Insert previous scorify demo logic] ...
    };
    window.addEventListener("keypress", handleScorifyKeyPress);
    return () => window.removeEventListener("keypress", handleScorifyKeyPress);
  }, []);

  function computeTatum(level: number) {
    return Math.round(level / 4);
  }

  // Render
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
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Toaster />
        <div className="text-center space-y-2">
          <h1
            style={{ fontSize: "3rem", fontWeight: "bold", color: "#143f7bff" }}
          >
            Real-Time "Scorification"
          </h1>
        </div>

        <ControlPanel
          minBeatLevel={minBeatLevel}
          onMinBeatLevelChange={(level) => {
            setMinBeatLevel(level);
            updateTatum(computeTatum(level));
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

        <div className="h-96 bg-white rounded-lg shadow-lg">
          <ScoreDisplay
            notes={notes}
            bpm={bpm}
            keySignature={keySignature}
            minBeatLevel={minBeatLevel}
            onNotesUpdate={() => {}} // No longer needed for logic, maybe for debug
            onScrollOffsetUpdate={() => {}} // Internalized in ScoreDisplay
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-gray-700 text-sm">88-Key Piano Keyboard</h2>
          <PianoKeyboard pressedKeys={pressedKeys} />
        </div>

        {/* Tips section ... */}
      </div>
    </div>
  );
}
