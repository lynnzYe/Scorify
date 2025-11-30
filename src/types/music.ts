export interface Note {
  id: string;
  midiPitch: number; // 0 for rest
  staff: 'treble' | 'bass';
  newBar: boolean;
  positionInMeasure: number; // index of the min beat level
  noteType: 2 | 4 | 8 | 16 | 32;
  timestamp: number;

  // CHANGE: We now store the absolute world coordinate
  absoluteX: number;

  measureIndex: number; // Which measure this note belongs to
  barlineX?: number; // X position of barline if newBar is true
  color: "black" | "blue"; // optional color
}

export interface KeySignature {
  name: string;
  sharps: number; // positive for sharps, negative for flats
}

export interface PianoKey {
  midiNote: number;
  pressed: boolean;
}

export type MinBeatLevel = 4 | 8 | 16;