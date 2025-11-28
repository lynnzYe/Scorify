// metronome.ts
// metronome.ts
export function clickMetronome(
    audioContext: AudioContext,
    frequency: number = 1000 // default 1kHz
) {
    const metronomeOsc: OscillatorNode = audioContext.createOscillator();
    const gainNode: GainNode = audioContext.createGain();

    gainNode.gain.value = 0.2;          // volume
    metronomeOsc.frequency.value = frequency; // set click pitch

    metronomeOsc.connect(gainNode).connect(audioContext.destination);

    // short click
    // console.debug("DEBUG: synthesize metronome")
    metronomeOsc.start();
    metronomeOsc.stop(audioContext.currentTime + 0.05); // 50ms
}
