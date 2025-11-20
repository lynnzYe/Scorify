import { Note, KeySignature } from '../types/music';

// Convert MIDI pitch to staff position (diatonic)
export function midiToStaffPosition(midiPitch: number, staff: 'treble' | 'bass'): number {
  // Position 0 = bottom line, position 8 = top line
  // Even positions (0,2,4,6,8) are on lines
  // Odd positions (1,3,5,7) are in spaces
  
  // Map MIDI to note class (C=0, D=2, E=4, F=5, G=7, A=9, B=11)
  const noteInOctave = midiPitch % 12;
  const octave = Math.floor(midiPitch / 12);
  
  // Map chromatic to diatonic position within octave (0-6 for C-B)
  const chromaticToDiatonic: { [key: number]: number } = {
    0: 0,   // C
    1: 0,   // C# -> C
    2: 1,   // D
    3: 1,   // D# -> D
    4: 2,   // E
    5: 3,   // F
    6: 3,   // F# -> F
    7: 4,   // G
    8: 4,   // G# -> G
    9: 5,   // A
    10: 5,  // A# -> A
    11: 6,  // B
  };
  
  const diatonicNote = chromaticToDiatonic[noteInOctave];
  const diatonicPosition = octave * 7 + diatonicNote; // Absolute diatonic position
  
  if (staff === 'treble') {
    // E4 (MIDI 64) is on bottom line (position 0)
    // E4 = octave 4, note E = diatonic 2
    const e4Position = 4 * 7 + 2; // = 30
    return diatonicPosition - e4Position;
  } else {
    // G2 (MIDI 43) is on bottom line (position 0)
    // G2 = octave 2, note G = diatonic 4
    const g2Position = 2 * 7 + 4; // = 18
    return diatonicPosition - g2Position;
  }
}

export function needsLedgerLines(position: number): number[] {
  const ledgerLines: number[] = [];
  
  if (position < 0) {
    // Below staff - draw ledger lines at even positions (lines)
    for (let i = -2; i >= position; i -= 2) {
      ledgerLines.push(i);
    }
  } else if (position > 8) {
    // Above staff - draw ledger lines at even positions (lines)
    for (let i = 10; i <= position; i += 2) {
      ledgerLines.push(i);
    }
  }
  
  return ledgerLines;
}

export function getAccidentalForPitch(midiPitch: number, keySignature: KeySignature): string | null {
  if (midiPitch === 0) return null; // Rest
  
  const noteInOctave = midiPitch % 12;
  const isBlackKey = [1, 3, 6, 8, 10].includes(noteInOctave);
  
  if (!isBlackKey) return null;
  
  // Simplified: show sharp for black keys
  return '♯';
}

export const KEY_SIGNATURES: KeySignature[] = [
  { name: 'C Major', sharps: 0 },
  { name: 'G Major', sharps: 1 },
  { name: 'D Major', sharps: 2 },
  { name: 'A Major', sharps: 3 },
  { name: 'E Major', sharps: 4 },
  { name: 'B Major', sharps: 5 },
  { name: 'F♯ Major', sharps: 6 },
  { name: 'F Major', sharps: -1 },
  { name: 'B♭ Major', sharps: -2 },
  { name: 'E♭ Major', sharps: -3 },
  { name: 'A♭ Major', sharps: -4 },
  { name: 'D♭ Major', sharps: -5 },
];
