import { useState, useEffect, useCallback, useRef } from 'react';

export interface MIDINoteEvent {
    pitch: number;
    velocity: number;
}

interface UseMIDIReturn {
    isConnected: boolean;
    isSupported: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
    onNoteOn: (callback: (event: MIDINoteEvent) => void) => void;
    onNoteOff: (callback: (event: MIDINoteEvent) => void) => void;
    error: string | null;
}

export const useMIDI = (): UseMIDIReturn => {
    const [isConnected, setIsConnected] = useState(false);
    const [isSupported, setIsSupported] = useState(false);
    const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
    const [error, setError] = useState<string | null>(null);

    const noteOnCallbacksRef = useRef<((event: MIDINoteEvent) => void)[]>([]);
    const noteOffCallbacksRef = useRef<((event: MIDINoteEvent) => void)[]>([]);

    // Check MIDI support
    useEffect(() => {
        setIsSupported(!!navigator.requestMIDIAccess);
    }, []);

    // Handle MIDI messages
    const handleMIDIMessage = useCallback((message: MIDIMessageEvent) => {
        if (!message.data) {
            console.log("Empty MIDI Message!")
            return
        }
        const [status, pitch, velocity] = message.data;

        const command = status & 0xf0;

        // Note On (0x90) with velocity > 0
        if (command === 0x90 && velocity > 0) {
            noteOnCallbacksRef.current.forEach(callback => {
                callback({ pitch, velocity });
            });
        }
        // Note Off (0x80) or Note On with velocity 0
        else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            noteOffCallbacksRef.current.forEach(callback => {
                callback({ pitch, velocity: 0 });
            });
        }
    }, []);

    // Connect to MIDI
    const connect = useCallback(async () => {
        if (!navigator.requestMIDIAccess) {
            setError('Web MIDI API is not supported in this browser');
            return;
        }

        try {
            setError(null);
            const access = await navigator.requestMIDIAccess();
            setMidiAccess(access);
            console.log("DEBUG: Set midi connected to true")
            setIsConnected(true);

            // Listen to all MIDI inputs
            access.inputs.forEach((input) => {
                input.onmidimessage = handleMIDIMessage;
            });

            // Handle device connections/disconnections
            access.onstatechange = (event) => {
                const port = event.port as MIDIInput;
                if (port.type === 'input') {
                    if (port.state === 'connected') {
                        port.onmidimessage = handleMIDIMessage;
                    }
                }
            };
        } catch (err) {
            setError('Failed to access MIDI devices. Permission denied or no devices found.');
            setIsConnected(false);
            console.error('MIDI connection error:', err);
        }
    }, [handleMIDIMessage]);

    // Disconnect from MIDI
    const disconnect = useCallback(() => {
        console.log("DEBUG: disconnect MIDI")
        if (midiAccess) {
            midiAccess.inputs.forEach((input) => {
                input.onmidimessage = null;
            });
            midiAccess.onstatechange = null;
        }
        setMidiAccess(null);
        setIsConnected(false);
    }, [midiAccess]);

    // Register callbacks
    const onNoteOn = useCallback((callback: (event: MIDINoteEvent) => void) => {
        noteOnCallbacksRef.current.push(callback);
        return () => {
            noteOnCallbacksRef.current = noteOnCallbacksRef.current.filter(cb => cb !== callback);
        };
    }, []);


    const onNoteOff = useCallback((callback: (event: MIDINoteEvent) => void) => {
        noteOffCallbacksRef.current.push(callback);
        return () => {
            noteOffCallbacksRef.current = noteOffCallbacksRef.current.filter(cb => cb !== callback);
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        console.debug("MIDI disconnect")
        return () => {
            disconnect();
        };
    }, []);

    return {
        isConnected,
        isSupported,
        connect,
        disconnect,
        onNoteOn,
        onNoteOff,
        error,
    };
};