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

const ALTERNATE_COLOR = "#9188f3";

export const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  notes,
  bpm,
  keySignature,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Camera state tracks the X offset of the viewport
  const currentScrollRef = useRef<number>(0);

  const STAFF_LINE_SPACING = 12;
  const TREBLE_STAFF_Y = 80;
  const BASS_STAFF_Y = 200;

  const drawStaff = (
    ctx: CanvasRenderingContext2D,
    y: number,
    width: number,
    scrollX: number
  ) => {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    // Draw lines only across the potentially visible area + buffer
    const startX = Math.floor(scrollX / 100) * 100 - 100;
    const endX = scrollX + width + 100;

    for (let i = 0; i < 5; i++) {
      const lineY = y + i * STAFF_LINE_SPACING;
      ctx.beginPath();
      ctx.moveTo(startX, lineY);
      ctx.lineTo(endX, lineY);
      ctx.stroke();
    }
  };

  const drawClef = (
    ctx: CanvasRenderingContext2D,
    type: "treble" | "bass",
    y: number
  ) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Identity transform to draw fixed UI

    ctx.fillStyle = "#000";
    // Increased size to 72px (approx 1.5x)
    ctx.font = "72px serif";

    if (type === "treble") {
      // Adjusted Y offset for larger font
      ctx.fillText("𝄞", 10, y + STAFF_LINE_SPACING * 4.5);
    } else {
      ctx.fillText("𝄢", 10, y + STAFF_LINE_SPACING * 3.5);
    }

    ctx.restore();
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
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 4, 0, 0, Math.PI * 2);
    if (noteType >= 4) ctx.fill();
    else ctx.stroke();
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
    const stemHeight = STAFF_LINE_SPACING * 3.5;
    const stemX = x + 4;
    ctx.beginPath();
    ctx.moveTo(stemX, y);
    ctx.lineTo(stemX, y - stemHeight);
    ctx.stroke();
    if (noteType === 8) drawFlag(ctx, stemX, y - stemHeight, 1, color);
    else if (noteType === 16) drawFlag(ctx, stemX, y - stemHeight, 2, color);
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
    let restSymbol = "𝄻";
    if (noteType === 2) restSymbol = "𝄼";
    else if (noteType === 4) restSymbol = "𝄽";
    else if (noteType === 8) restSymbol = "𝄾";
    else if (noteType === 16) restSymbol = "𝄿";
    ctx.fillText(restSymbol, x - 5, y);
  };

  const drawBarline = (ctx: CanvasRenderingContext2D, x: number) => {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, TREBLE_STAFF_Y);
    ctx.lineTo(x, BASS_STAFF_Y + STAFF_LINE_SPACING * 4);
    ctx.stroke();
  };

  const renderNote = (ctx: CanvasRenderingContext2D, note: Note) => {
    // Note: note.absoluteX is now used directly
    const x = note.absoluteX;

    const staffY = note.staff === "treble" ? TREBLE_STAFF_Y : BASS_STAFF_Y;
    const position = midiToStaffPosition(note.midiPitch, note.staff);
    const noteY = staffY + (8 - position) * (STAFF_LINE_SPACING / 2);

    if (note.midiPitch === 0) {
      const restY = staffY + STAFF_LINE_SPACING * 2;
      drawRest(ctx, note.noteType, x, restY);
    } else {
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

      let colorCode = note.color !== "black" ? ALTERNATE_COLOR : "#000";
      const accidental = getAccidentalForPitch(note.midiPitch, keySignature);
      if (accidental) {
        ctx.fillStyle = colorCode;
        ctx.font = "16px serif";
        ctx.fillText(accidental, x - 15, noteY + 4);
      }
      drawNoteHead(ctx, x, noteY, note.noteType, colorCode);
      if (note.noteType >= 4) {
        drawStem(ctx, x, noteY, note.noteType, colorCode);
      }
    }
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

      // --- SCROLL LOGIC ---
      // Determine the right-most point of the content
      let maxX = 0;
      if (notes.length > 0) {
        const lastNote = notes[notes.length - 1];
        maxX = lastNote.absoluteX;
        if (lastNote.barlineX && lastNote.barlineX > maxX) {
          maxX = lastNote.barlineX;
        }
      }

      // Target position: We want content to be at ~66% of screen
      const targetScreenPos = canvas.width * 0.66;
      let targetScroll = 0;

      if (maxX > targetScreenPos) {
        targetScroll = maxX - targetScreenPos;
      }

      // Smooth camera interpolation
      const scrollDiff = targetScroll - currentScrollRef.current;
      if (Math.abs(scrollDiff) > 1) {
        const lerpFactor = 5 * deltaTime;
        const minSpeed = 50 * deltaTime;

        if (scrollDiff > 0) {
          // Forward scrolling
          currentScrollRef.current += Math.max(
            scrollDiff * lerpFactor,
            Math.min(scrollDiff, minSpeed)
          );
        } else {
          // Backward scrolling (e.g. resize/reset)
          currentScrollRef.current += scrollDiff * lerpFactor;
        }
      }

      // --- RENDERING ---
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply Camera Transform
      ctx.save();
      ctx.translate(-currentScrollRef.current, 0);

      // Draw Staves
      drawStaff(ctx, TREBLE_STAFF_Y, canvas.width, currentScrollRef.current);
      drawStaff(ctx, BASS_STAFF_Y, canvas.width, currentScrollRef.current);

      // Render Visible Notes
      const viewStart = currentScrollRef.current - 50;
      const viewEnd = currentScrollRef.current + canvas.width + 50;

      const visibleNotes = notes.filter((n) => {
        // simple visibility check
        return n.absoluteX >= viewStart && n.absoluteX <= viewEnd;
      });

      visibleNotes.forEach((note) => {
        if (note.newBar && note.barlineX !== undefined) {
          drawBarline(ctx, note.barlineX);
        }
        renderNote(ctx, note);
      });

      ctx.restore();

      // Draw Fixed UI (Clefs)
      drawClef(ctx, "treble", TREBLE_STAFF_Y);
      drawClef(ctx, "bass", BASS_STAFF_Y);

      animationFrameRef.current = requestAnimationFrame(animate);
    },
    [notes, bpm]
  );

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [animate]);

  // Reset scroll on clear
  useEffect(() => {
    if (notes.length === 0) {
      currentScrollRef.current = 0;
    }
  }, [notes.length]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && canvasRef.current.parentElement) {
        canvasRef.current.width = canvasRef.current.parentElement.clientWidth;
        canvasRef.current.height = 350;
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
