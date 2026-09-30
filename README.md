# Vexoris

Vexoris is a browser-based workspace for reviewing robotics telemetry and replaying recorded ROS 2 sessions. The interface combines a Three.js point-cloud view with topic filters, playback controls, anomaly status, camera frames, log upload, and incident-report export.

## Components

- **Web workspace** — Next.js, React, TypeScript, and Three.js
- **Telemetry engine** — Python service in `engine/`
- **Live updates** — WebSocket stream from the local engine
- **Log replay** — upload support for MCAP and ROS 2 DB3 files
- **Reporting** — incident-audit PDF export through the engine API

## Run locally

Requirements: Node.js 20+, npm, and a supported Python environment.

Start the web app:

```bash
git clone https://github.com/Faiyazs07/Vexoris.git
cd Vexoris
npm install
npm run dev
```

Review the engine instructions and dependencies in `engine/`, then start it on port `8000`. The web workspace runs at [http://localhost:3000](http://localhost:3000).

## Useful commands

```bash
npm run dev
npm run lint
npm run build
npm start
```

## Local architecture

The browser connects to `ws://localhost:8000/ws/telemetry` for live playback and uses the engine’s HTTP endpoints for uploads and report export.

## Status

Vexoris is a functional prototype for telemetry investigation workflows. It is designed for local evaluation and should be reviewed and hardened before use with safety-critical systems or sensitive operational logs.
