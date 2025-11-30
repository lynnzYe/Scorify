import { useState, useEffect, useCallback, useRef } from 'react';

export interface MIDINoteEvent {
    pitch: number;
    velocity: number;
}

export interface MIDIControllerEvent {
    controller: number;
    value: number;
}

interface UseMIDIReturn {
    isConnected: boolean;
    isSupported: boolean;
    connect: () => Promise<string | null>;
    disconnect: () => void;
    onNoteOn: (callback: (event: MIDINoteEvent) => void) => () => void;
    onNoteOff: (callback: (event: MIDINoteEvent) => void) => () => void;
    onController: (callback: (event: MIDIControllerEvent) => void) => () => void; // <-- new
    error: string | null;
}

export const useMIDI = (): UseMIDIReturn => {
    const [isConnected, setIsConnected] = useState(false);
    const [isSupported, setIsSupported] = useState(false);
    const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
    const [error, setError] = useState<string | null>(null);

    const noteOnCallbacksRef = useRef<((event: MIDINoteEvent) => void)[]>([]);
    const noteOffCallbacksRef = useRef<((event: MIDINoteEvent) => void)[]>([]);
    const controllerCallbacksRef = useRef<((event: { controller: number, value: number }) => void)[]>([]);

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
        const [status, data1, data2] = message.data;

        const command = status & 0xf0;

        // Note On (0x90) with velocity > 0
        if (command === 0x90 && data2 > 0) {
            noteOnCallbacksRef.current.forEach(callback => {
                callback({ pitch: data1, velocity: data2 });
            });
        }
        // Note Off (0x80) or Note On with velocity 0
        else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
            noteOffCallbacksRef.current.forEach(callback => {
                callback({ pitch: data1, velocity: 0 });
            });
        }
        // Control Change (0xB0)
        else if (command === 0xB0) {
            controllerCallbacksRef.current.forEach(cb => cb({ controller: data1, value: data2 }));
        }
    }, []);

    // Connect to MIDI
    const connect = useCallback(async () => {
        if (!navigator.requestMIDIAccess) {
            const err = 'Web MIDI API is not supported in this browser'
            setError(err);
            return err;
        }

        try {
            setError(null);
            const access = await navigator.requestMIDIAccess({ sysex: false });
            setMidiAccess(access);

            const updateConnectionState = () => {
                console.log("MIDI inputs:", Array.from(access.inputs.values()), 'size:', access.inputs.size)
                let hasPhysicalDevice = Array.from(access.inputs.values()).some(input =>
                    input.state === "connected" &&
                    // input.connection === "open" && 
                    input.manufacturer !== ""
                );
                console.log("Has physical device?:", hasPhysicalDevice)
                access.onstatechange = (e) => {
                    console.debug("Port updated:", e.port?.name, e.port?.connection);
                    hasPhysicalDevice = Array.from(access.inputs.values()).some(input =>
                        input.state === "connected" &&
                        input.connection === "open" &&
                        input.manufacturer !== ""
                    );
                    return true
                };
                if (access.inputs.size == 1 && Array.from(access.inputs.values())[0].name?.includes("IAC")) {
                    console.warn("Only IAC bus is found.")
                }
                if (!hasPhysicalDevice) {
                    return false
                }
                return true
            };

            // Attach listeners to existing devices
            access.inputs.forEach((input) => {
                input.onmidimessage = handleMIDIMessage;
            });

            // Update connected state now
            updateConnectionState();

            // Handle device connections/disconnections
            access.onstatechange = (event) => {
                const port = event.port as MIDIInput;
                if (port.type === 'input') {
                    if (port.state === 'connected') {
                        port.onmidimessage = handleMIDIMessage;
                    }
                    updateConnectionState();
                }
            };
            console.debug("DEBUG: Set midi connected to true")
            setIsConnected(true);
            return null
        } catch (err) {
            const errr = 'Failed to access MIDI devices. Permission denied or no devices found.';
            setError(errr);
            setIsConnected(false);
            console.error('MIDI connection error:', errr);
            return errr
        }
    }, [handleMIDIMessage]);

    // Disconnect from MIDI
    const disconnect = useCallback(() => {
        console.debug("DEBUG: disconnect MIDI")
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

    const onController = useCallback(
        (callback: (event: { controller: number, value: number }) => void) => {
            controllerCallbacksRef.current.push(callback);
            return () => {
                controllerCallbacksRef.current = controllerCallbacksRef.current.filter(cb => cb !== callback);
            };
        },
        []
    );


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
        onController,
        error,
    };
};