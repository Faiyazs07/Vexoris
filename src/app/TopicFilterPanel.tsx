'use client';

import { Activity, AlertTriangle, Cpu, Eye, EyeOff, Layers, Radio } from 'lucide-react';

interface TopicChannel {
  id: string;
  schema: string;
  type: 'sensor' | 'can' | 'model' | 'diag';
  rate: string;
}

export const AVAILABLE_TOPICS: TopicChannel[] = [
  { id: '/lidar/points', schema: 'sensor_msgs/msg/PointCloud2', type: 'sensor', rate: '20 Hz' },
  { id: '/sensors/camera_fl/glare', schema: 'std_msgs/msg/Float32', type: 'sensor', rate: '30 Hz' },
  { id: '/camera/front_left/image_raw', schema: 'sensor_msgs/msg/CompressedImage', type: 'sensor', rate: '100 Hz' },
  { id: '/can/chassis/brake_pressure', schema: 'can_msgs/msg/Frame', type: 'can', rate: '100 Hz' },
  { id: '/model/fusion_weight', schema: 'geometry_msgs/msg/Vector3', type: 'model', rate: '50 Hz' },
  { id: '/diagnostics/status', schema: 'diagnostic_msgs/msg/DiagnosticStatus', type: 'diag', rate: '10 Hz' },
];

interface TopicFilterPanelProps {
  ws: WebSocket | null;
  enabledChannels: string[];
}

export function TopicFilterPanel({ ws, enabledChannels }: TopicFilterPanelProps) {
  const send = (message: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const icon = (type: TopicChannel['type']) => {
    if (type === 'can') return <Activity className="h-3.5 w-3.5 text-[#00ff88]" />;
    if (type === 'model') return <Cpu className="h-3.5 w-3.5 text-[#ffb700]" />;
    if (type === 'diag') return <AlertTriangle className="h-3.5 w-3.5 text-[#ff0055]" />;
    return <Radio className="h-3.5 w-3.5 text-[#00f0ff]" />;
  };

  return (
    <aside className="flex h-full w-80 shrink-0 select-none flex-col border-r border-[#00f0ff22] bg-[#090d14] font-mono text-xs text-white">
      <div className="flex items-center justify-between border-b border-[#00f0ff22] p-3">
        <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[#00f0ff]">
          <Layers className="h-4 w-4" />
          <span>ROS2 Channels ({enabledChannels.length}/{AVAILABLE_TOPICS.length})</span>
        </div>
        <div className="flex gap-2 text-[10px]">
          <button type="button" onClick={() => send({ action: 'SET_CHANNELS', channels: AVAILABLE_TOPICS.map(({ id }) => id) })} className="uppercase text-gray-400 hover:text-[#00f0ff]">All</button>
          <span className="text-gray-600">|</span>
          <button type="button" onClick={() => send({ action: 'SET_CHANNELS', channels: [] })} className="uppercase text-gray-400 hover:text-[#ff0055]">Mute</button>
        </div>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {AVAILABLE_TOPICS.map((channel) => {
          const enabled = enabledChannels.includes(channel.id);
          return (
            <button
              type="button"
              key={channel.id}
              onClick={() => send({ action: 'TOGGLE_CHANNEL', channel: channel.id })}
              className={`flex w-full cursor-pointer items-center justify-between rounded border p-2.5 text-left transition-all ${enabled ? 'border-[#00f0ff44] bg-[#0f1724] text-gray-200 shadow-[0_0_10px_rgba(0,240,255,0.05)]' : 'border-transparent bg-[#070a0f] text-gray-600 hover:border-gray-800'}`}
            >
              <span className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5">{icon(channel.type)}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate font-bold ${enabled ? 'text-white' : 'text-gray-500'}`}>{channel.id}</span>
                  <span className="truncate text-[10px] text-gray-500">{channel.schema}</span>
                </span>
              </span>
              <span className="ml-2 flex shrink-0 items-center gap-2">
                <span className="rounded bg-[#151c28] px-1.5 py-0.5 text-[9px] text-gray-400">{channel.rate}</span>
                {enabled ? <Eye className="h-3.5 w-3.5 text-[#00f0ff]" /> : <EyeOff className="h-3.5 w-3.5 text-gray-600" />}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
