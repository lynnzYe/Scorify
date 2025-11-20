export interface Note {
  id: string;
  midiPitch: number; // 0 for rest
  staff: 'treble' | 'bass';
  newBar: boolean;
  positionInMeasure: number; // index of the min beat level (e.g., 0-7 for eighth notes in 4/4)
  noteType: 2 | 4 | 8 | 16 | 32; // whole=1, half=2, quarter=4, eighth=8, sixteenth=16
  timestamp: number;
  xPosition: number; // Current x position on canvas (calculated from position in measure)
  measureIndex: number; // Which measure this note belongs to
  barlineX?: number; // X position of barline if newBar is true
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
