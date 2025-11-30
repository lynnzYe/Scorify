import React, { useRef, useEffect, useCallback } from "react";
import { Note, KeySignature, MinBeatLevel } from "../types/music";
import {
  midiToStaffPosition,
  needsLedgerLines,
  getAccidentalForPitch,
} from "../utils/musicNotation";

interface ScoreDisplayProps {
  notes: Note[];
  bpm: number;
  keySignature: KeySignature;
  minBeatLevel: MinBeatLevel;
  onNotesUpdate: (notes: Note[]) => void;
  onScrollOffsetUpdate: (offset: number) => void;
}


const ALTERNATE_COLOR = '#9188f3'
export const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  notes,
  bpm,
  keySignature,
  minBeatLevel,
  onNotesUpdate,
  onScrollOffsetUpdate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const totalScrollOffsetRef = useRef<number>(0);

  const STAFF_LINE_SPACING = 12;
  const TREBLE_STAFF_Y = 80;
  const BASS_STAFF_Y = 200;

  // Calculate scroll speed based on note density
  const calculateScrollSpeed = useCallback(
    (notes: Note[], canvasWidth: number) => {
      if (notes.length === 0) return 0;

      // Target: keep rightmost note around 2/3 (67%) of the screen
      const targetX = canvasWidth * 0.67;

      // Find the rightmost note position
      const rightmostX = notes.reduce(
        (max, note) => Math.max(max, note.xPosition),
        0
      );

      // Calculate how far the rightmost note is from the target position
      const deviation = rightmostX - targetX;

      // Don't scroll if notes are within acceptable range (50%-70% of screen)
      const acceptableMin = canvasWidth * 0.5;
      const acceptableMax = canvasWidth * 0.7;

      if (rightmostX >= acceptableMin && rightmostX <= acceptableMax) {
        return 0; // No scrolling needed, notes are in good position
      }

      // If notes are too far right, scroll to bring them back
      if (deviation > 0) {
        // Base speed proportional to BPM
        const baseSpeed = (bpm / 60) * 50; // pixels per second

        // Increase speed based on how far past the target we are
        const urgencyMultiplier = Math.max(1, deviation / 150);

        // Calculate speed to bring notes back to target within a reasonable time
        const calculatedSpeed = baseSpeed * urgencyMultiplier;

        // Guarantee notes come back to target position quickly if far away
        const minimumSpeed = deviation * 0.8; // Move 80% of the distance per second

        return Math.max(calculatedSpeed, minimumSpeed);
      }

      return 0;
    },
    [bpm]
  );

  const drawStaff = (
    ctx: CanvasRenderingContext2D,
    y: number,
    width: number
  ) => {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;

    // Draw 5 horizontal lines
    for (let i = 0; i < 5; i++) {
      const lineY = y + i * STAFF_LINE_SPACING;
      ctx.beginPath();
      ctx.moveTo(60, lineY);
      ctx.lineTo(width, lineY);
      ctx.stroke();
    }
  };

  const drawClef = (
    ctx: CanvasRenderingContext2D,
    type: "treble" | "bass",
    y: number
  ) => {
    ctx.fillStyle = "#000";
    ctx.font = "48px serif";

    if (type === "treble") {
      // Treble clef (𝄞)
      ctx.fillText("𝄞", 10, y + STAFF_LINE_SPACING * 3.5);
    } else {
      // Bass clef (𝄢)
      ctx.fillText("𝄢", 10, y + STAFF_LINE_SPACING * 2.5);
    }
  };

  const drawBarline = (ctx: CanvasRenderingContext2D, x: number) => {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, TREBLE_STAFF_Y);
    ctx.lineTo(x, BASS_STAFF_Y + STAFF_LINE_SPACING * 4);
    ctx.stroke();
  };

  const drawNote = (ctx: CanvasRenderingContext2D, note: Note, x: number) => {
    const staffY = note.staff === "treble" ? TREBLE_STAFF_Y : BASS_STAFF_Y;
    const position = midiToStaffPosition(note.midiPitch, note.staff);

    // Y position: each position increment = half a line spacing
    // Position 0 = bottom line, position 8 = top line
    const noteY = staffY + (8 - position) * (STAFF_LINE_SPACING / 2);

    if (note.midiPitch === 0) {
      // Draw rest at middle of staff
      const restY = staffY + STAFF_LINE_SPACING * 2;
      drawRest(ctx, note.noteType, x, restY);
    } else {
      // Draw ledger lines if needed (must be drawn before note)
      const ledgerLines = needsLedgerLines(position);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ledgerLines.forEach((linePos) => {
        const ledgerY = staffY + (8 - linePos) * (STAFF_LINE_SPACING / 2);
        ctx.beginPath();
        ctx.moveTo(x - 10, ledgerY);
        ctx.lineTo(x + 10, ledgerY);
        ctx.stroke();
      });

      let colorCode = "#000";
      if (note.color != "black") {
        colorCode = ALTERNATE_COLOR;
      }

      // Draw accidental if needed
      const accidental = getAccidentalForPitch(note.midiPitch, keySignature);
      if (accidental) {
        ctx.fillStyle = colorCode;
        ctx.font = "16px serif";
        ctx.fillText(accidental, x - 15, noteY + 4);
      }

      // Draw note head
      drawNoteHead(ctx, x, noteY, note.noteType, colorCode);

      // Draw stem for quarter notes and shorter
      if (note.noteType >= 4) {
        drawStem(ctx, x, noteY, note.noteType, colorCode);
      }
    }
  };

  const drawNoteHead = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    noteType: number,
    color = "#000"
  ) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    // Elliptical note head
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 4, 0, 0, Math.PI * 2);

    if (noteType >= 4) {
      // Filled for quarter note and shorter
      ctx.fill();
    } else {
      // Hollow for half and whole notes
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawStem = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    noteType: number,
    color = "#000"
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    // Stem goes up or down
    const stemHeight = STAFF_LINE_SPACING * 3.5;
    const stemX = x + 4;

    ctx.beginPath();
    ctx.moveTo(stemX, y);
    ctx.lineTo(stemX, y - stemHeight);
    ctx.stroke();

    // Add flags for eighth and sixteenth notes
    if (noteType === 8) {
      drawFlag(ctx, stemX, y - stemHeight, 1, color);
    } else if (noteType === 16) {
      drawFlag(ctx, stemX, y - stemHeight, 2, color);
    }
  };

  const drawFlag = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    count: number,
    color = "#000"
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    for (let i = 0; i < count; i++) {
      const flagY = y + i * 4;
      ctx.beginPath();
      ctx.moveTo(x, flagY);
      ctx.quadraticCurveTo(x + 8, flagY + 3, x + 6, flagY + 8);
      ctx.stroke();
    }
  };

  const drawRest = (
    ctx: CanvasRenderingContext2D,
    noteType: number,
    x: number,
    y: number
  ) => {
    ctx.fillStyle = "#000";
    ctx.font = "20px serif";

    let restSymbol = "";
    switch (noteType) {
      case 2:
        restSymbol = "𝄼"; // half rest
        break;
      case 4:
        restSymbol = "𝄽"; // quarter rest
        break;
      case 8:
        restSymbol = "𝄾"; // eighth rest
        break;
      case 16:
        restSymbol = "𝄿"; // sixteenth rest
        break;
      default:
        restSymbol = "𝄻"; // whole rest
    }

    ctx.fillText(restSymbol, x - 5, y);
  };

  const animate = useCallback(
    (currentTime: number) => {
      if (!canvasRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const deltaTime = lastTimeRef.current
        ? (currentTime - lastTimeRef.current) / 1000
        : 0;
      lastTimeRef.current = currentTime;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw staves
      drawStaff(ctx, TREBLE_STAFF_Y, canvas.width);
      drawStaff(ctx, BASS_STAFF_Y, canvas.width);

      // Draw clefs
      drawClef(ctx, "treble", TREBLE_STAFF_Y);
      drawClef(ctx, "bass", BASS_STAFF_Y);

      // Calculate scroll speed
      const scrollSpeed = calculateScrollSpeed(notes, canvas.width);

      // Track total scroll offset
      if (scrollSpeed > 0) {
        totalScrollOffsetRef.current += scrollSpeed * deltaTime;
        onScrollOffsetUpdate(totalScrollOffsetRef.current);
      }

      // Update note positions and render (also update barline positions)
      const updatedNotes = notes
        .map((note) => ({
          ...note,
          xPosition: note.xPosition - scrollSpeed * deltaTime,
          barlineX:
            note.barlineX !== undefined
              ? note.barlineX - scrollSpeed * deltaTime
              : undefined,
        }))
        .filter((note) => note.xPosition > -50); // Remove notes that have scrolled off screen

      // Draw barlines and notes
      updatedNotes.forEach((note, index) => {
        if (note.newBar && note.barlineX !== undefined) {
          drawBarline(ctx, note.barlineX);
        }
        drawNote(ctx, note, note.xPosition);
      });

      onNotesUpdate(updatedNotes);

      animationFrameRef.current = requestAnimationFrame(animate);
    },
    [notes, calculateScrollSpeed, onNotesUpdate]
  );

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animate]);

  // Reset scroll offset when notes are cleared
  useEffect(() => {
    if (notes.length === 0) {
      totalScrollOffsetRef.current = 0;
      onScrollOffsetUpdate(0);
    }
  }, [notes.length, onScrollOffsetUpdate]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const parent = canvasRef.current.parentElement;
        if (parent) {
          canvasRef.current.width = parent.clientWidth;
          canvasRef.current.height = 350;
        }
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="w-full h-full bg-white rounded-lg shadow-inner p-4">
      <canvas ref={canvasRef} className="w-full" style={{ display: "block" }} />
    </div>
  );
};
