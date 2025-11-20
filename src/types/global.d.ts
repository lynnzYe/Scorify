// global.d.ts or src/types/global.d.ts
export { };

declare global {
  interface Window {
    my?: {
      BeatTracker?: any
      MidiBeatLSTM?: any;
      MidiBeatSS?: any;
      testMidiBeat?: (...args: any[]) => Promise<any>;
      testBeatSS?: (...args: any[]) => Promise<any>;
      [key: string]: any;
    };
    _midiTestRan?: boolean;
  }
}
