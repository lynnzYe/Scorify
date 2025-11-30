// metronome.ts
// metronome.ts
let lastBeatClickTime = 0;  // module-level state
let lastDownbeatClickTime = 0;  // module-level state

export function clickMetronome(
    audioContext: AudioContext,
    frequency: number = 1000, // default 1kHz
    cooldownMs: number = 70, // defualt 70 ms cooldown
) {
    const now = audioContext.currentTime * 1000;
    if (frequency == 1000 && now - lastDownbeatClickTime < cooldownMs) {
        return; // 🚫 Block the click
    } else if (frequency == 500 && (now - lastBeatClickTime < cooldownMs || now - lastDownbeatClickTime < cooldownMs)) {
        return;
    }
    if (frequency == 1000) {
        lastDownbeatClickTime = now
    } else if (frequency == 500) {
        lastBeatClickTime = now
    }
    const metronomeOsc: OscillatorNode = audioContext.createOscillator();
    const gainNode: GainNode = audioContext.createGain();

    gainNode.gain.value = 1.0;          // volume
    metronomeOsc.frequency.value = frequency; // set click pitch

    metronomeOsc.connect(gainNode).connect(audioContext.destination);

    // short click
    // console.debug("DEBUG: synthesize metronome")
    metronomeOsc.start();
    metronomeOsc.stop(audioContext.currentTime + 0.05); // 50ms
}
