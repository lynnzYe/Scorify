import React from "react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { MinBeatLevel, KeySignature } from "../types/music";
import { KEY_SIGNATURES } from "../utils/musicNotation";
import { Plug, PlugZap } from "lucide-react";

interface ControlPanelProps {
  minBeatLevel: MinBeatLevel;
  onMinBeatLevelChange: (level: MinBeatLevel) => void;
  keySignature: KeySignature;
  onKeySignatureChange: (key: KeySignature) => void;
  onClear: () => void;
  midiConnected?: boolean;
  onMidiConnect?: () => void;
  onMidiDisconnect?: () => void;
  metronomeOn?: boolean;
  onMetronomeClick?: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  minBeatLevel,
  onMinBeatLevelChange,
  keySignature,
  onKeySignatureChange,
  onClear,
  midiConnected = false,
  onMidiConnect,
  onMidiDisconnect,
  metronomeOn = false,
  onMetronomeClick: onMetronomeToggle,
}) => {
  return (
    <div className="flex items-center gap-4 p-4 bg-gray-100 rounded-lg">
      <div className="flex items-center gap-2">
        <label className="text-sm">Min Beat Level:</label>
        <Select
          value={minBeatLevel.toString()}
          onValueChange={(value: string) =>
            onMinBeatLevelChange(parseInt(value) as MinBeatLevel)
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="4">Quarter (♩)</SelectItem>
            <SelectItem value="8">Eighth (♪)</SelectItem>
            <SelectItem value="16">Sixteenth (♬)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm">Key Signature:</label>
        <Select
          value={keySignature.name}
          onValueChange={(value: string) => {
            const key = KEY_SIGNATURES.find((k) => k.name === value);
            if (key) onKeySignatureChange(key);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KEY_SIGNATURES.map((key) => (
              <SelectItem key={key.name} value={key.name}>
                {key.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={onClear} variant="destructive">
        Clear Score
      </Button>

      {onMidiConnect && onMidiDisconnect && (
        <Button
          onClick={midiConnected ? onMidiDisconnect : onMidiConnect}
          variant={midiConnected ? "default" : "outline"}
          className={
            midiConnected
              ? "bg-green-600 hover:bg-green-700 text-blackƒ"
              : "hover:bg-green-700"
          }
        >
          {midiConnected ? (
            <>
              <PlugZap className="mr-2 h-4 w-4" />
              MIDI Connected
            </>
          ) : (
            <>
              <Plug className="mr-2 h-4 w-4" />
              Connect MIDI
            </>
          )}
        </Button>
      )}
      {onMetronomeToggle && (
        <Button
          onClick={onMetronomeToggle}
          variant={metronomeOn ? "default" : "outline"}
          className={
            metronomeOn
              ? "bg-green-600 hover:bg-green-700 text-blackƒ"
              : "hover:bg-green-700"
          }
        >
          {metronomeOn ? <>Mute beats</> : <>Play beats</>}
        </Button>
      )}
    </div>
  );
};
