'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AlertTriangle, Activity, CheckCircle, ShieldAlert, FileText, Cpu, Radio, Gauge, Upload } from 'lucide-react';
import { PlaybackScrubber } from './PlaybackScrubber';
import { AVAILABLE_TOPICS, TopicFilterPanel } from './TopicFilterPanel';
import { CameraViewportOverlay } from './CameraViewportOverlay';

interface TelemetryPacket {
  timestamp: number;
  node_id: string;
  lidar_points: number | null;
  model_weight: number | null;
  glare_index: number | null;
  can_bus_brake_pressure_psi?: number | null;
  status: string;
  anomaly_detail: string | null;
  duration: number;
  start_time: number;
  end_time: number;
  is_playing: boolean;
  speed: number;
  enabled_channels: string[];
  camera_frame_b64?: string | null;
  camera_frame_mime?: string | null;
}

export default function VexorisWorkspace() {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [telemetry, setTelemetry] = useState<TelemetryPacket>({
    timestamp: 14.00,
    node_id: 'MCAP_ROS2_EDGE_8802',
    lidar_points: 4000,
    model_weight: 0.98,
    glare_index: 0.05,
    can_bus_brake_pressure_psi: 0,
    status: 'NOMINAL',
    anomaly_detail: null,
    duration: 8,
    start_time: 14,
    end_time: 22,
    is_playing: true,
    speed: 1,
    enabled_channels: AVAILABLE_TOPICS.map(({ id }) => id),
    camera_frame_b64: null,
    camera_frame_mime: 'image/jpeg',
  });

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [playbackRevision, setPlaybackRevision] = useState<number>(0);

  const targetMeshRef = useRef<THREE.Mesh | null>(null);
  const targetMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const pointCloudRef = useRef<THREE.Points | null>(null);

  // 1. WebSocket Live Stream Connection
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8000/ws/telemetry');

    socket.onopen = () => {
      setWs(socket);
      setIsConnected(true);
    };
    socket.onclose = () => {
      setWs(null);
      setIsConnected(false);
    };
    socket.onerror = () => setIsConnected(false);

    socket.onmessage = (event) => {
      const packet: TelemetryPacket = JSON.parse(event.data);
      setTelemetry(packet);
      if (pointCloudRef.current) pointCloudRef.current.visible = packet.lidar_points !== null;

      if (targetMeshRef.current && targetMaterialRef.current) {
        targetMeshRef.current.position.set(0, 0, 0);
        const isAnomaly = packet.status === 'CRITICAL_ANOMALY';
        targetMaterialRef.current.color.setHex(isAnomaly ? 0xff0055 : 0x00ff88);
        const targetScale = isAnomaly ? 1.35 : 1.0;
        targetMeshRef.current.scale.set(targetScale, targetScale, targetScale);
      }
    };

    return () => {
      setWs(null);
      socket.close();
    };
  }, [playbackRevision]);

  // 2. Three.js WebGL Scene Initialization
  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);

    const camera = new THREE.PerspectiveCamera(
      60,
      currentMount.clientWidth / currentMount.clientHeight,
      0.1,
      1000
    );
    camera.position.set(4, 5, 7);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    currentMount.appendChild(renderer.domElement);

    // 3D Point Cloud setup
    const pointCount = 4000;
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);

    for (let i = 0; i < pointCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 14;
      positions[i + 1] = (Math.random() - 0.5) * 4;
      positions[i + 2] = (Math.random() - 0.5) * 14;

      colors[i] = 0.0;
      colors[i + 1] = 0.94;
      colors[i + 2] = 1.0;
    }

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointMaterial = new THREE.PointsMaterial({
      size: 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
    });

    const pointCloud = new THREE.Points(pointGeometry, pointMaterial);
    pointCloudRef.current = pointCloud;
    scene.add(pointCloud);

    const gridHelper = new THREE.GridHelper(20, 20, 0x00f0ff, 0x111622);
    gridHelper.position.y = -1;
    scene.add(gridHelper);

    // Target Machine Wireframe
    const boxGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
    const targetMesh = new THREE.Mesh(boxGeo, boxMat);
    targetMesh.position.set(0, 0, 0);
    scene.add(targetMesh);

    targetMeshRef.current = targetMesh;
    targetMaterialRef.current = boxMat;

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      pointCloud.rotation.y += 0.0005;
      targetMesh.rotation.y += 0.005;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!currentMount) return;
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleExportPDF = async () => {
    setIsExporting(true);

    try {
      const response = await fetch('http://localhost:8000/api/v1/export-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telemetry),
      });

      if (!response.ok) throw new Error('PDF export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Vexoris_Incident_Audit_${telemetry.node_id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to generate audit PDF. Ensure Python backend is running on port 8000.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleLogUpload = async (file: File) => {
    if (!file.name.toLowerCase().match(/\.(mcap|db3)$/)) {
      setUploadError('Select an .mcap or .db3 ROS bag file.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('http://localhost:8000/api/v1/upload-log', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail ?? 'Log upload failed');
      }

      setUploadedFilename(result.filename);
      setPlaybackRevision((revision) => revision + 1);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Log upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isAnomaly = telemetry.status === 'CRITICAL_ANOMALY';
  const brakePsi = telemetry.can_bus_brake_pressure_psi ?? 0;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#05070a] text-white font-mono overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 bg-[#0c1017] border-b border-[#00f0ff22] flex items-center justify-between px-6 z-10">
        <div className="flex items-center space-x-3">
          <Cpu className="w-5 h-5 text-[#00f0ff]" />
          <span className="text-sm font-bold tracking-widest uppercase text-white">
            VEXORIS // Spatial Forensics Engine
          </span>
          <span className="text-xs bg-[#111622] text-[#00f0ff] px-2 py-0.5 rounded border border-[#00f0ff33]">
            v1.0.4-DEV
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-xs">
            <Radio className={`w-4 h-4 ${isConnected ? 'text-[#00ff88] animate-pulse' : 'text-gray-500'}`} />
            <span className={isConnected ? 'text-gray-300' : 'text-gray-500'}>
              {isConnected ? 'LIVE WEBSOCKET STREAM' : 'ENGINE DISCONNECTED'}
            </span>
          </div>

          {telemetry.status === 'FILTERED' ? (
            <div className="flex items-center space-x-2 rounded border border-gray-600 bg-gray-800 px-3 py-1 text-xs font-bold text-gray-400">
              <Radio className="h-4 w-4" />
              <span>DIAGNOSTICS CHANNEL FILTERED</span>
            </div>
          ) : isAnomaly ? (
            <div className="flex items-center space-x-2 bg-[#ff00551a] border border-[#ff0055] text-[#ff0055] px-3 py-1 rounded text-xs font-bold animate-pulse">
              <AlertTriangle className="w-4 h-4" />
              <span>CRITICAL ANOMALY [t={telemetry.timestamp.toFixed(3)}s]</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 bg-[#00ff881a] border border-[#00ff88] text-[#00ff88] px-3 py-1 rounded text-xs font-bold">
              <CheckCircle className="w-4 h-4" />
              <span>NOMINAL TELEMETRY STREAM</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Studio Viewport */}
      <div className="flex flex-1 relative overflow-hidden">
        <TopicFilterPanel ws={ws} enabledChannels={telemetry.enabled_channels} />

        <div ref={mountRef} className="flex-1 h-full w-full relative">
          <CameraViewportOverlay
            frameBase64={telemetry.camera_frame_b64}
            frameMime={telemetry.camera_frame_mime}
            glareIndex={telemetry.glare_index}
            timestamp={telemetry.timestamp}
          />

          <div className="absolute bottom-6 left-6 rounded border border-[#00f0ff33] bg-[#0c1017ee] px-3 py-2 text-xs font-bold uppercase text-[#00f0ff] backdrop-blur">
            Active frequency: 100 Hz
          </div>
        </div>

        {/* Diagnostic Sidebar */}
        <aside className="w-96 bg-[#090d14] border-l border-[#00f0ff22] p-5 flex flex-col space-y-4 overflow-y-auto">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void handleLogUpload(file);
            }}
            className="rounded border border-dashed border-[#00f0ff55] bg-[#00f0ff0a] p-4 text-center transition-colors hover:bg-[#00f0ff12]"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mcap,.db3"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleLogUpload(file);
              }}
            />
            <Upload className="mx-auto mb-2 h-5 w-5 text-[#00f0ff]" />
            <p className="text-xs font-bold uppercase tracking-wider text-[#00f0ff]">
              {isUploading ? 'Ingesting telemetry log...' : 'Drop MCAP or DB3 log'}
            </p>
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 text-[11px] text-gray-400 underline decoration-[#00f0ff55] underline-offset-2 hover:text-white disabled:opacity-50"
            >
              or browse files
            </button>
            {uploadedFilename && !uploadError && (
              <p className="mt-2 truncate text-[11px] text-[#00ff88]">
                Playing: {uploadedFilename}
              </p>
            )}
            {uploadError && <p className="mt-2 text-[11px] text-[#ff0055]">{uploadError}</p>}
          </div>

          <div className="bg-[#0f1522] p-4 rounded border border-[#00f0ff22]">
            <h3 className="text-xs font-bold text-[#8a2be2] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Log Stream Ingestion
            </h3>
            <p className="text-xs text-gray-400">Node ID: {telemetry.node_id}</p>
            <p className="text-xs text-[#00f0ff] mt-1">
              Points: {telemetry.lidar_points ?? 'FILTERED'} | Stream: {isConnected ? 'ACTIVE' : 'OFFLINE'}
            </p>
          </div>

          <div className="bg-[#0f1522] p-4 rounded border border-[#00f0ff22]">
            <h3 className="text-xs font-bold text-[#8a2be2] uppercase tracking-wider mb-2">
              Neural Decision Weights
            </h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Vision Model Weight</span>
                  <span className={telemetry.model_weight === null ? 'text-gray-500' : isAnomaly ? 'text-[#ff0055] font-bold' : 'text-[#00ff88]'}>
                    {telemetry.model_weight === null ? 'FILTERED' : `${(telemetry.model_weight * 100).toFixed(0)}%`}
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${isAnomaly ? 'bg-[#ff0055]' : 'bg-[#00ff88]'}`}
                    style={{ width: `${(telemetry.model_weight ?? 0) * 100}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Optical Glare Index</span>
                  <span className={telemetry.glare_index === null ? 'text-gray-500' : isAnomaly ? 'text-[#ff0055] font-bold' : 'text-gray-400'}>
                    {telemetry.glare_index === null ? 'FILTERED' : `${telemetry.glare_index.toFixed(2)} ${isAnomaly ? '[SATURATED]' : ''}`}
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${isAnomaly ? 'bg-[#ff0055]' : 'bg-[#00f0ff]'}`}
                    style={{ width: `${(telemetry.glare_index ?? 0) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* CAN Bus Chassis Telemetry Card */}
          <div className="bg-[#0f1522] p-4 rounded border border-[#00f0ff22]">
            <h3 className="text-xs font-bold text-[#00f0ff] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Gauge className="w-4 h-4" /> CAN Bus Chassis Telemetry
            </h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">Brake Hydraulic Pressure</span>
                  <span className={brakePsi > 0 ? 'text-[#ff0055] font-bold' : 'text-[#00ff88]'}>
                    {telemetry.can_bus_brake_pressure_psi === null ? 'FILTERED' : `${brakePsi} PSI ${brakePsi > 0 ? '[EMERGENCY TRIGGER]' : ''}`}
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${brakePsi > 0 ? 'bg-[#ff0055]' : 'bg-[#00ff88]'}`}
                    style={{ width: `${Math.min((brakePsi / 1200) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className={`p-4 rounded border transition-all ${isAnomaly ? 'bg-[#ff005511] border-[#ff0055]' : 'bg-[#0f1522] border-[#00f0ff22]'}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2 text-[#ff0055]">
              <ShieldAlert className="w-4 h-4" /> Deterministic Diagnosis
            </h3>
            {telemetry.status === 'FILTERED' ? (
              <p className="text-xs text-gray-500">
                Diagnostic status channel is filtered. Fault isolation is unavailable.
              </p>
            ) : isAnomaly ? (
              <p className="text-xs text-gray-200 leading-relaxed">
                <strong className="text-[#ff0055]">Hardware Fault Isolated:</strong> {telemetry.anomaly_detail}
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                System operating within nominal telemetry tolerances.
              </p>
            )}
          </div>

          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="w-full py-2.5 bg-[#00f0ff1a] hover:bg-[#00f0ff33] text-[#00f0ff] border border-[#00f0ff55] rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>{isExporting ? 'Generating Audit PDF...' : 'Export Incident Audit PDF'}</span>
          </button>
        </aside>
      </div>
      <PlaybackScrubber
        ws={ws}
        currentTime={telemetry.timestamp}
        startTime={telemetry.start_time}
        endTime={telemetry.end_time}
        isPlaying={telemetry.is_playing}
        speed={telemetry.speed}
      />
    </div>
  );
}
