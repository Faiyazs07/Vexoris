'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AlertTriangle, Activity, CheckCircle, ShieldAlert, FileText, Cpu } from 'lucide-react';

export default function VexorisWorkspace() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [timestamp, setTimestamp] = useState<number>(14.00);
  const [isAnomaly, setIsAnomaly] = useState<boolean>(false);

  const targetMeshRef = useRef<THREE.Mesh | null>(null);
  const targetMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    // 1. Setup Scene, Camera, and WebGL Renderer
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

    // 2. Generate Simulated LiDAR Point Cloud
    const pointCount = 4000;
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);

    for (let i = 0; i < pointCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 14;
      positions[i + 1] = (Math.random() - 0.5) * 4;
      positions[i + 2] = (Math.random() - 0.5) * 14;

      // Cyan-tinted spatial points (#00F0FF)
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

    // 3. Grid Floor Representation
    const gridHelper = new THREE.GridHelper(20, 20, 0x00f0ff, 0x111622);
    gridHelper.position.y = -1;
    scene.add(gridHelper);

    // 4. Target Autonomous Machine Bounding Box
    const boxGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
    const targetMesh = new THREE.Mesh(boxGeo, boxMat);
    scene.add(targetMesh);

    targetMeshRef.current = targetMesh;
    targetMaterialRef.current = boxMat;

    // 5. Render Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      pointCloud.rotation.y += 0.0005;
      renderer.render(scene, camera);
    };
    animate();

    // 6. Responsive Resize Handling
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

  // Update 3D viewport state when timeline slider moves
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setTimestamp(val);

    const anomalyState = val >= 14.02;
    setIsAnomaly(anomalyState);

    if (targetMeshRef.current && targetMaterialRef.current) {
      targetMeshRef.current.position.x = (val - 14.00) * 12;
      targetMaterialRef.current.color.setHex(anomalyState ? 0xff0055 : 0x00ff88);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#05070a] text-white font-mono overflow-hidden">
      {/* Top Console Navigation */}
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
        <div className="flex items-center space-x-2">
          {isAnomaly ? (
            <div className="flex items-center space-x-2 bg-[#ff00551a] border border-[#ff0055] text-[#ff0055] px-3 py-1 rounded text-xs font-bold animate-pulse">
              <AlertTriangle className="w-4 h-4" />
              <span>CRITICAL ANOMALY DETECTED [t={timestamp.toFixed(2)}s]</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 bg-[#00ff881a] border border-[#00ff88] text-[#00ff88] px-3 py-1 rounded text-xs font-bold">
              <CheckCircle className="w-4 h-4" />
              <span>NOMINAL TELEMETRY STREAM</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Spatial Studio Viewport */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* 3D WebGL Canvas */}
        <div ref={mountRef} className="flex-1 h-full w-full relative">
          {/* Timeline Overlay Control Bar */}
          <div className="absolute bottom-6 left-6 right-6 bg-[#0c1017ee] border border-[#00f0ff33] backdrop-blur p-4 rounded-lg flex items-center space-x-6 z-20">
            <span className="text-xs font-bold text-[#00f0ff] uppercase whitespace-nowrap">
              MICROSECOND REPLAY:
            </span>
            <input
              type="range"
              min="14.00"
              max="14.10"
              step="0.005"
              value={timestamp}
              onChange={handleScrub}
              className="w-full accent-[#00f0ff] cursor-pointer"
            />
            <span className="text-xs font-bold text-white bg-[#111622] px-3 py-1 rounded border border-[#00f0ff22]">
              t = {timestamp.toFixed(3)}s
            </span>
          </div>
        </div>

        {/* Right Forensic Diagnostic Inspector */}
        <aside className="w-96 bg-[#090d14] border-l border-[#00f0ff22] p-5 flex flex-col space-y-4 overflow-y-auto">
          <div className="bg-[#0f1522] p-4 rounded border border-[#00f0ff22]">
            <h3 className="text-xs font-bold text-[#8a2be2] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Log Stream Ingestion
            </h3>
            <p className="text-xs text-gray-400">Node ID: MCAP_ROS2_EDGE_8802</p>
            <p className="text-xs text-[#00f0ff] mt-1">LiDAR Horizon: 100 Hz | CAN Bus: Active</p>
          </div>

          <div className="bg-[#0f1522] p-4 rounded border border-[#00f0ff22]">
            <h3 className="text-xs font-bold text-[#8a2be2] uppercase tracking-wider mb-2">
              Neural Weight Confidence
            </h3>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Vision Model Weight</span>
                  <span className={isAnomaly ? "text-[#ff0055] font-bold" : "text-[#00ff88]"}>
                    {isAnomaly ? "08%" : "98%"}
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${isAnomaly ? "bg-[#ff0055]" : "bg-[#00ff88]"}`}
                    style={{ width: isAnomaly ? "8%" : "98%" }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Optical Glare Index</span>
                  <span className={isAnomaly ? "text-[#ff0055] font-bold" : "text-gray-400"}>
                    {isAnomaly ? "0.94 [SATURATED]" : "0.05"}
                  </span>
                </div>
                <div className="w-full bg-[#1b2333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${isAnomaly ? "bg-[#ff0055]" : "bg-[#00f0ff]"}`}
                    style={{ width: isAnomaly ? "94%" : "5%" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Root Cause Panel */}
          <div className={`p-4 rounded border transition-all ${isAnomaly ? "bg-[#ff005511] border-[#ff0055]" : "bg-[#0f1522] border-[#00f0ff22]"}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2 text-[#ff0055]">
              <ShieldAlert className="w-4 h-4" /> Root-Cause Diagnostic
            </h3>
            {isAnomaly ? (
              <p className="text-xs text-gray-200 leading-relaxed">
                <strong className="text-[#ff0055]">Optical Sensor Saturation:</strong> High-contrast exposure spike at t=14.02s reduced neural detection confidence below execution thresholds, forcing immediate safety halt.
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                All physical trajectories and neural decision weights match standard operational parameters.
              </p>
            )}
          </div>

          {/* Remediation Specs */}
          <div className="bg-[#0f1522] p-4 rounded border border-[#8a2be255]">
            <h3 className="text-xs font-bold text-[#00f0ff] uppercase tracking-wider mb-2">
              Remediation Playbook
            </h3>
            {isAnomaly ? (
              <ul className="text-xs text-gray-300 space-y-2 list-disc list-inside">
                <li>Enforce 12ms hard exposure cap on Camera Node #2.</li>
                <li>Inject glare profile weights into model retrain queue.</li>
              </ul>
            ) : (
              <p className="text-xs text-gray-500">No remediation actions needed.</p>
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