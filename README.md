# AirMaestro

AirMaestro is a browser-based gesture instrument that enables users to create music through hand movements detected by a webcam.

It combines computer vision, gesture recognition, and interactive audio design in a real-time browser experience.

## Features

- Real-time hand tracking with MediaPipe
- Pinch gesture for melody playback
- Horizontal hand movement for note selection
- Right-hand finger count for chord selection
- Right-hand height for chord volume control
- Wrist tilt for live filter and reverb effects
- Synth, piano, and saxophone melody presets
- Browser-based audio engine powered by Tone.js
- Local camera processing for privacy

## Tech Stack

- React
- Vite
- JavaScript
- MediaPipe Tasks Vision
- Tone.js
- Web Audio API
- CSS

## Gesture Controls

| Gesture | Action |
|---|---|
| Left-hand pinch | Play melody |
| Move melody hand left/right | Change note |
| Right-hand finger count | Select chord |
| Raise/lower right hand | Change chord level |
| Tilt right wrist | Control filter and reverb effect |

## Getting Started

### Prerequisites

- Node.js 18 or newer
- A webcam
- Google Chrome or Microsoft Edge

### Installation

```bash
npm install
npm run dev