import React, { useMemo } from 'react';

interface PianoKeyboardProps {
  pressedKeys: Set<number>; // Set of MIDI note numbers (21-108 for 88 keys)
}

export const PianoKeyboard: React.FC<PianoKeyboardProps> = ({ pressedKeys }) => {
  const keys = useMemo(() => {
    const allKeys = [];
    // 88 keys: A0 (MIDI 21) to C8 (MIDI 108)
    const whiteKeyPattern = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
    
    for (let midi = 21; midi <= 108; midi++) {
      const noteInOctave = midi % 12;
      const isWhite = [0, 2, 4, 5, 7, 9, 11].includes(noteInOctave);
      allKeys.push({ midi, isWhite, pressed: pressedKeys.has(midi) });
    }
    
    return allKeys;
  }, [pressedKeys]);

  const whiteKeys = keys.filter(k => k.isWhite);
  const blackKeys = keys.filter(k => !k.isWhite);
  
  const whiteKeyWidth = 100 / whiteKeys.length;

  return (
    <div className="relative h-32 bg-gray-800 rounded-lg overflow-hidden">
      {/* White keys */}
      <div className="absolute inset-0 flex">
        {whiteKeys.map((key, index) => (
          <div
            key={key.midi}
            className={`flex-shrink-0 border-r border-gray-400 transition-colors duration-75 ${
              key.pressed
                ? 'bg-blue-400'
                : 'bg-white hover:bg-gray-100'
            }`}
            style={{ width: `${whiteKeyWidth}%` }}
          >
            {/* Optional: show note name on key */}
          </div>
        ))}
      </div>

      {/* Black keys */}
      <div className="absolute inset-0 flex pointer-events-none">
        {keys.map((key, index) => {
          if (key.isWhite) return null;
          
          // Calculate position based on surrounding white keys
          const whiteKeysBefore = keys.slice(0, index).filter(k => k.isWhite).length;
          const leftPosition = (whiteKeysBefore - 0.3) * whiteKeyWidth;
          
          return (
            <div
              key={key.midi}
              className={`absolute top-0 transition-colors duration-75 rounded-b ${
                key.pressed
                  ? 'bg-blue-600'
                  : 'bg-gray-900'
              }`}
              style={{
                left: `${leftPosition}%`,
                width: `${whiteKeyWidth * 0.6}%`,
                height: '60%',
                zIndex: 10,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
