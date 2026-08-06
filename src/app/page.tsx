'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AlertTriangle, Activity, CheckCircle, ShieldAlert, FileText, Cpu, Radio } from 'lucide-react';

interface TelemetryPacket {
  timestamp: number;
  node_id: string;
  lidar_points: number;
  model_weight: number;
  glare_index: number;
  status: string;
  anomaly_detail: string | null;
}

export default function VexorisWorkspace() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [telemetry, setTelemetry] = useState<TelemetryPacket>({
    timestamp: 14.00,
    node_id: 'MCAP_ROS2_EDGE_8802',
    lidar_points: 4000,
    model_weight: 0.98,
    glare_index: 0.05,
    status: 'NOMINAL',
    anomaly_detail: null,
  });

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLive, setIsLive] = useState<boolean>(true);

  const targetMeshRef = useRef<THREE.Mesh | null>(null);
  const targetMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  // 1. WebSocket Live Stream Connection
  useEffect(() => {
    if (!isLive) return;

    const ws = new WebSocket('ws://localhost:8000/ws/telemetry');

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);

    ws.onmessage = (event) => {
      const packet: TelemetryPacket = JSON.parse(event.data);
      setTelemetry(packet);

      if (targetMeshRef.current && targetMaterialRef.current) {
        targetMeshRef.current.position.x = (packet.timestamp - 14.00) * 12;
        const isAnomaly = packet.status === 'CRITICAL_ANOMALY';
        targetMaterialRef.current.color.setHex(isAnomaly ? 0xff0055 : 0x00ff88);
      }
    };

    return () => {
      ws.close();
    };
  }, [isLive]);

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
    scene.add(pointCloud);

    const gridHelper = new THREE.GridHelper(20, 20, 0x00f0ff, 0x111622);
    gridHelper.position.y = -1;
    scene.add(gridHelper);

    // Target Machine Wireframe
    const boxGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
    const targetMesh = new THREE.Mesh(boxGeo, boxMat);
    scene.add(targetMesh);

    targetMeshRef.current = targetMesh;
    targetMaterialRef.current = boxMat;

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      pointCloud.rotation.y += 0.0005;
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

  const isAnomaly = telemetry.status === 'CRITICAL_ANOMALY';

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

          {isAnomaly ? (
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
        <div ref={mountRef} className="flex-1 h-full w-full relative">
          <div className="absolute bottom-6 left-6 right-6 bg-[#0c1017ee] border border-[#00f0ff33] backdrop-blur p-4 rounded-lg flex items-center justify-between z-20">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsLive(!isLive)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${
                  isLive
                    ? 'bg-[#00f0ff22] border border-[#00f0ff] text-[#00f0ff]'
                    : 'bg-[#1b2333] border border-gray-600 text-gray-400'
                }`}
              >
                {isLive ? 'Pause Stream' : 'Resume Live'}
              </button>
              <span className="text-xs font-bold text-[#00f0ff] uppercase">
                ACTIVE FREQUENCY: 100 Hz
              </span>
            </div>
            <span className="text-xs font-bold text-white bg-[#111622] px-3 py-1 rounded border border-[#00f0ff22]">
              t = {telemetry.timestamp.toFixed(3)}s
            </span>
          </div>
        </div>

        {/* Diagnostic Sidebar */}
        <aside className="w-96 bg-[#090d14] border-l border-[#00f0ff22] p-5 flex flex-col space-y-4 overflow-y-auto">
          <div className="bg-[#0f1522] p-4 rounded border border-[#00f0ff22]">
            <h3 className="text-xs font-bold text-[#8a2be2] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Log Stream Ingestion
            </h3>
            <p className="text-xs text-gray-400">Node ID: {telemetry.node_id}</p>
            <p className="text-xs text-[#00f0ff] mt-1">
              Points: {telemetry.lidar_points} | Stream: {isConnected ? 'ACTIVE' : 'OFFLINE'}
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
                  <span className={isAnomaly ? 'text-[#ff0055] font-bold' : 'text-[#00ff88]'}>
                    {((telemetry?.model_weight ?? 0.98) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${isAnomaly ? 'bg-[#ff0055]' : 'bg-[#00ff88]'}`}
                    style={{ width: `${(telemetry?.model_weight ?? 0.98) * 100}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Optical Glare Index</span>
                  <span className={isAnomaly ? 'text-[#ff0055] font-bold' : 'text-gray-400'}>
                    {(telemetry?.glare_index ?? 0.05).toFixed(2)} {isAnomaly ? '[SATURATED]' : ''}
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${isAnomaly ? 'bg-[#ff0055]' : 'bg-[#00f0ff]'}`}
                    style={{ width: `${(telemetry?.glare_index ?? 0.05) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className={`p-4 rounded border transition-all ${isAnomaly ? 'bg-[#ff005511] border-[#ff0055]' : 'bg-[#0f1522] border-[#00f0ff22]'}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2 text-[#ff0055]">
              <ShieldAlert className="w-4 h-4" /> Deterministic Diagnosis
            </h3>
            {isAnomaly ? (
              <p className="text-xs text-gray-200 leading-relaxed">
                <strong className="text-[#ff0055]">Hardware Fault Isolated:</strong> {telemetry.anomaly_detail}
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                System operating within nominal telemetry tolerances.
              </p>
            )}
          </div>

          <button className="w-full py-2.5 bg-[#00f0ff1a] hover:bg-[#00f0ff33] text-[#00f0ff] border border-[#00f0ff55] rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-2 transition-all">
            <FileText className="w-4 h-4" />
            <span>Export Incident Audit PDF</span>
          </button>
        </aside>
      </div>
    </div>
  );
}
