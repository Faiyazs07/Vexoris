'use client';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

interface PlaybackScrubberProps {
  ws: WebSocket | null;
  currentTime: number;
  startTime: number;
  endTime: number;
  isPlaying: boolean;
  speed: number;
}

export function PlaybackScrubber({
  ws,
  currentTime,
  startTime,
  endTime,
  isPlaying,
  speed,
}: PlaybackScrubberProps) {
  const sendControl = (action: string, payload: Record<string, number> = {}) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, ...payload }));
    }
  };

  const seek = (timestamp: number) => {
    sendControl('SEEK', { timestamp: Math.min(Math.max(timestamp, startTime), endTime) });
  };

  const duration = Math.max(endTime - startTime, 0.001);
  const anomalyStart = Math.min(Math.max(14.45, startTime), endTime);
  const anomalyEnd = Math.min(Math.max(17.95, startTime), endTime);

  return (
    <div className="w-full shrink-0 border-t border-[#00f0ff33] bg-[#0c1017] p-3 font-mono text-white">
      <div className="flex items-center gap-3">
        <span className="w-20 text-xs font-bold text-[#00f0ff]">{currentTime.toFixed(3)}s</span>
        <div className="relative flex flex-1 items-center">
          <div
            className="pointer-events-none absolute z-20 h-1.5 rounded bg-[#ff0055] opacity-50"
            style={{
              left: `${((anomalyStart - startTime) / duration) * 100}%`,
              width: `${((anomalyEnd - anomalyStart) / duration) * 100}%`,
            }}
            title="Critical anomaly window"
          />
          <input
            aria-label="Playback position"
            type="range"
            min={startTime}
            max={endTime}
            step={0.01}
            value={Math.min(Math.max(currentTime, startTime), endTime)}
            onChange={(event) => seek(Number(event.target.value))}
            className="relative z-10 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[#1b2333] accent-[#00f0ff]"
          />
        </div>
        <span className="w-20 text-right text-xs text-gray-400">{endTime.toFixed(3)}s</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => seek(currentTime - 0.01)} title="Step back 10ms" className="rounded border border-[#00f0ff33] bg-[#111622] p-1.5 text-gray-300 hover:bg-[#1b2333]">
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => sendControl(isPlaying ? 'PAUSE' : 'PLAY')} className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-bold uppercase ${isPlaying ? 'border-[#00f0ff] bg-[#00f0ff22] text-[#00f0ff]' : 'border-[#ff0055] bg-[#ff005522] text-[#ff0055]'}`}>
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button type="button" onClick={() => seek(currentTime + 0.01)} title="Step forward 10ms" className="rounded border border-[#00f0ff33] bg-[#111622] p-1.5 text-gray-300 hover:bg-[#1b2333]">
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => seek(14.45)} className="rounded border border-[#ff005555] bg-[#ff005522] px-2 py-1 text-[10px] font-bold uppercase text-[#ff0055] hover:border-[#ff0055]">
            Jump to anomaly (14.45s)
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase text-gray-400">Speed:</span>
          {[0.5, 1, 2].map((option) => (
            <button key={option} type="button" onClick={() => sendControl('SET_SPEED', { speed: option })} className={`rounded border px-2 py-0.5 text-[10px] font-bold ${speed === option ? 'border-[#00f0ff] bg-[#00f0ff] text-black' : 'border-[#00f0ff22] bg-[#111622] text-gray-400 hover:text-white'}`}>
              {option}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
