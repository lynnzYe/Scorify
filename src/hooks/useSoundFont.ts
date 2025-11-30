import { DessertIcon } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import Soundfont, { InstrumentName } from 'soundfont-player';

interface UseSoundFontReturn {
    isLoaded: boolean;
    playNote: (midiPitch: number, velocity?: number) => void;
    stopNote: (midiPitch: number) => void;
    stopAllNotes: () => void;
}

export const useSoundFont = (instrument: InstrumentName = 'acoustic_grand_piano'): UseSoundFontReturn => {
    const [isLoaded, setIsLoaded] = useState(false);
    const instrumentRef = useRef<any>(null);
    const activeNotesRef = useRef<Map<number, any>>(new Map());

    // Load soundfont
    useEffect(() => {
        let isMounted = true;

        const loadInstrument = async () => {
            try {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const masterGain = audioContext.createGain();
                masterGain.gain.value = 6.0;
                masterGain.connect(audioContext.destination);
                const player = await Soundfont.instrument(audioContext, instrument, {
                    destination: masterGain
                });

                if (isMounted) {
                    instrumentRef.current = player;
                    setIsLoaded(true);
                }
            } catch (error) {
                console.error('Failed to load soundfont:', error);
            }
        };

        loadInstrument();

        return () => {
            isMounted = false;
            // Stop all notes and cleanup
            if (instrumentRef.current) {
                activeNotesRef.current.forEach((note) => {
                    if (note && note.stop) {
                        note.stop();
                    }
                });
                activeNotesRef.current.clear();
            }
        };
    }, [instrument]);

    // Play a note
    const playNote = useCallback((midiPitch: number, velocity: number = 127) => {
        if (!instrumentRef.current) return;

        // Stop any existing note at this pitch first
        const existingNote = activeNotesRef.current.get(midiPitch);
        if (existingNote && existingNote.stop) {
            existingNote.stop();
        }

        // Play the note with velocity (0-127 maps to 0-1 gain)
        const gain = velocity / 127;
        const note = instrumentRef.current.play(midiPitch, undefined, { gain });
        activeNotesRef.current.set(midiPitch, note);

        // console.debug("DEBUG: played note", midiPitch, velocity)
    }, []);

    // Stop a note
    const stopNote = useCallback((midiPitch: number) => {
        const note = activeNotesRef.current.get(midiPitch);
        if (note && note.stop) {
            note.stop();
            activeNotesRef.current.delete(midiPitch);
        }
    }, []);

    // Stop all notes
    const stopAllNotes = useCallback(() => {
        activeNotesRef.current.forEach((note) => {
            if (note && note.stop) {
                note.stop();
            }
        });
        activeNotesRef.current.clear();
    }, []);

    return {
        isLoaded,
        playNote,
        stopNote,
        stopAllNotes,
    };
};
