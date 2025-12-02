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
  resetScorify,
  setDrawCallback,
  Staff,
  updateTatum,
  drawBuffedNotes,
} from "./utils/scorify";
import { BEAT_THRES, DOWNBEAT_THRES } from "./model/beat-tracker";
import { HandSeparator } from "./utils/handSeparator";

const NDEBUG = true;

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
  const handSeparatorRef = useRef(new HandSeparator());
  const lastTimeMsRef = useRef(0);

  // SYNCHRONOUS LAYOUT STATE
  const layoutStateRef = useRef({
    currentMeasureIndex: 0,
    measureStartAbsoluteX: window.innerWidth * 0.5,
    absoluteHeadX: window.innerWidth * 0.5,
    currentMeasureNotes: [] as { position: number; duration: number }[],
  });

  const [loadingMBT, setLoadingMBT] = useState(true);
  const [status, setStatus] = useState("Initializing model...");
  const mbtRef = React.useRef<BeatTrackerWrapper | null>(null);
  const [error, setError] = useState(false);
  const [metronomeStatus, setMetronomeStatus] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // --- AUDIO CONTEXT RESUME HELPER ---
  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
        console.log("AudioContext resumed successfully");
      } catch (e) {
        console.error("Failed to resume AudioContext", e);
      }
    }
  }, []);

  function handleMetronomeToggle() {
    ensureAudioContext(); // Resume on click
    setMetronomeStatus((prev) => !prev);
  }

  useEffect(() => {
    // Initialize context (likely suspended until interaction)
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();

    async function initMBT() {
      if (!window.my || !window.my.testBeatSS || !window.my.BeatTracker) {
        setError(true);
        return;
      }
      setStatus("Running model self-test...");
      if (!window._midiTestRan) {
        window._midiTestRan = true;
        await window.my.testBeatSS();
      }
      mbtRef.current = new BeatTrackerWrapper();
      await mbtRef.current.load();
      setStatus("Ready!");
      setLoadingMBT(false);
    }
    initMBT();
    setDrawCallback(drawNote);
    updateTatum(computeTatum(minBeatLevel));

    // Attempt to resume on any click in the window as a fallback
    const resumeOnInteraction = () => {
      ensureAudioContext();
      window.removeEventListener("click", resumeOnInteraction);
      window.removeEventListener("keydown", resumeOnInteraction);
    };
    window.addEventListener("click", resumeOnInteraction);
    window.addEventListener("keydown", resumeOnInteraction);

    return () => {
      window.removeEventListener("click", resumeOnInteraction);
      window.removeEventListener("keydown", resumeOnInteraction);
    };
  }, [ensureAudioContext, minBeatLevel]);

  function trackBeat(pitch: number, velocity: number, dbHint: boolean = false) {
    if (!mbtRef.current) return [0, 0];
    const timeMs = performance.now();
    let [beatProbTensor, downbeatProbTensor] = mbtRef.current.track(
      timeMs / 1000,
      pitch,
      velocity,
      dbHint
    );
    const beatProb = beatProbTensor.dataSync()[0];
    const downbeatProb = downbeatProbTensor.dataSync()[0];
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
    beatProbTensor.dispose();
    downbeatProbTensor.dispose();
    return [beatProb, downbeatProb];
  }

  const handleMidiConnect = useCallback(async () => {
    await ensureAudioContext(); // Resume on connect
    const err = await midi.connect();
    if (err) toast.error(err);
    else toast.success("MIDI device connected!");
  }, [midi, ensureAudioContext]);

  const handleMidiDisconnect = useCallback(() => {
    midi.disconnect();
    toast.info("MIDI device disconnected");
  }, [midi]);

  const soundRef = useRef(sound);
  const metronomeStatusRef = useRef(metronomeStatus);
  const onAddNoteRef = useRef((p: number, s: Staff, t: number) =>
    addNote(p, s, t)
  );
  const onAddBeatRef = useRef((t: number, d: boolean) => addBeat(t, d));
  const onDrawBuffedNotesRef = useRef(() => drawBuffedNotes());

  useEffect(() => {
    soundRef.current = sound;
    metronomeStatusRef.current = metronomeStatus;
  }, [sound, metronomeStatus]);

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

    // Fallback: If context is still suspended, try resume (might fail if not triggered by user)
    // or use performance.now() as a fallback for timestamp to prevent freezing
    let timestamp = 0;
    if (audioContextRef.current.state === "running") {
      timestamp = audioContextRef.current.currentTime * 1000;
    } else {
      // Fallback for visual timing if audio is blocked
      timestamp = performance.now();
    }

    const { pitch, velocity } = event;

    const [beat_prob, downbeat_prob] = trackBeat(
      pitch,
      velocity,
      userBeatOverrideRef.current
    );
    userBeatOverrideRef.current = false;

    if (soundRef.current.isLoaded) soundRef.current.playNote(pitch, velocity);

    // Use separator
    const staff = handSeparatorRef.current.classify(pitch);
    onAddNoteRef.current(pitch, staff, timestamp);

    if (beat_prob > BEAT_THRES) {
      onAddBeatRef.current(timestamp, downbeat_prob > DOWNBEAT_THRES);
      setTimeout(() => onDrawBuffedNotesRef.current(), 0);
      if (
        metronomeStatusRef.current &&
        audioContextRef.current.state === "running"
      ) {
        clickMetronome(
          audioContextRef.current,
          downbeat_prob > DOWNBEAT_THRES ? 1000 : 500
        );
      }
    }
    setPressedKeys((prev) => new Set([...prev, pitch]));
  }, []);

  const handleNoteOff = useCallback((event: MIDINoteEvent) => {
    if (soundRef.current.isLoaded) soundRef.current.stopNote(event.pitch);
    setPressedKeys((prev) => {
      const updated = new Set(prev);
      updated.delete(event.pitch);
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

  // Layout Logic
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
      const drawPitch = midiPitch - 12;
      const positionSpacing = calculatePositionSpacing(minBeatLevel);
      const layout = layoutStateRef.current;
      let barlineX: number | undefined;

      if (newBar) {
        let barlineRelativePos = 0;

        if (layout.currentMeasureNotes.length > 0) {
          const lastPosition = Math.max(
            ...layout.currentMeasureNotes.map((n) => n.position)
          );
          const notesAtLastPos = layout.currentMeasureNotes.filter(
            (n) => n.position === lastPosition
          );
          const positionDurations = notesAtLastPos.map(
            (n) => minBeatLevel / n.duration
          );
          const maxDuration = Math.max(...positionDurations);
          barlineRelativePos = lastPosition + Math.max(maxDuration, 1);
        }

        const absoluteBarlineX =
          layout.measureStartAbsoluteX +
          barlineRelativePos * positionSpacing +
          40;
        barlineX = absoluteBarlineX;

        layout.currentMeasureIndex += 1;
        layout.measureStartAbsoluteX = absoluteBarlineX + 30;
        layout.currentMeasureNotes = [];
      }

      const absoluteX =
        layout.measureStartAbsoluteX + positionInMeasure * positionSpacing;

      layout.currentMeasureNotes.push({
        position: positionInMeasure,
        duration: noteType,
      });

      if (absoluteX > layout.absoluteHeadX) layout.absoluteHeadX = absoluteX;

      const newNote: Note = {
        id: `note-${Date.now()}-${Math.random()}`,
        midiPitch: drawPitch,
        staff,
        newBar,
        positionInMeasure,
        noteType,
        timestamp: Date.now(),
        absoluteX: absoluteX,
        measureIndex: layout.currentMeasureIndex,
        barlineX,
        color,
      };

      setNotes((prev) => [...prev, newNote]);
      if (currentBpm) setBpm(currentBpm);

      if (midiPitch > 0) {
        setPressedKeys((prev) => new Set([...prev, midiPitch]));
        setTimeout(() => {
          setPressedKeys((prev) => {
            const updated = new Set(prev);
            updated.delete(midiPitch);
            return updated;
          });
        }, 200);
      }
    },
    [minBeatLevel]
  );

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
    handSeparatorRef.current.reset();
    layoutStateRef.current = {
      currentMeasureIndex: 0,
      measureStartAbsoluteX: window.innerWidth * 0.5,
      absoluteHeadX: window.innerWidth * 0.5,
      currentMeasureNotes: [],
    };
    setDrawCallback(drawNote);
  }, [drawNote, sound]);

  function computeTatum(level: number) {
    return Math.round(level / 4);
  }

  if (loadingMBT)
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>{status}</p>
      </div>
    );
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
            onNotesUpdate={() => {}}
            onScrollOffsetUpdate={() => {}}
          />
        </div>
        <div className="space-y-2">
          <h2 className="text-gray-700 text-sm">88-Key Piano Keyboard</h2>
          <PianoKeyboard pressedKeys={pressedKeys} />
        </div>
      </div>
    </div>
  );
}
