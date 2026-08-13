'use client';

import { AlertCircle, Camera } from 'lucide-react';

interface CameraViewportOverlayProps {
  frameBase64?: string | null;
  frameMime?: string | null;
  glareIndex?: number | null;
  timestamp: number;
}

export function CameraViewportOverlay({
  frameBase64,
  frameMime = 'image/jpeg',
  glareIndex,
  timestamp,
}: CameraViewportOverlayProps) {
  const isSaturated = glareIndex !== null && glareIndex !== undefined && glareIndex > 0.3;

  return (
    <div className="absolute left-4 top-4 z-20 w-72 overflow-hidden rounded-lg border border-[#00f0ff33] bg-[#0c1017ee] font-mono text-white shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-[#00f0ff22] bg-[#111622] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-[#00f0ff]" />
          <span className="text-[11px] font-bold uppercase text-gray-200">
            /camera/front_left/image_raw
          </span>
        </div>
        <span className="text-[10px] font-bold text-[#00f0ff]">100 FPS</span>
      </div>

      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-[#05070a]">
        {frameBase64 ? (
          // The source is an ephemeral WebSocket data URI, not an optimizable asset URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:${frameMime ?? 'image/jpeg'};base64,${frameBase64}`}
            alt={`Front-left ROS2 camera at ${timestamp.toFixed(3)} seconds`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs text-gray-600">CAMERA CHANNEL FILTERED</span>
        )}

        {isSaturated && (
          <div className="absolute inset-x-0 bottom-0 flex animate-pulse items-center justify-center gap-1 bg-[#ff0055dd] p-1">
            <AlertCircle className="h-3.5 w-3.5 text-white" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white">
              Optical glare saturation ({glareIndex.toFixed(2)})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
