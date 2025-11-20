// global.d.ts or src/types/global.d.ts
interface Window {
  my?: {
    BeatTracker?: any
    // testMidiBeat?: (...args: any[]) => Promise<any>;
    [key: string]: any;
  };
}
