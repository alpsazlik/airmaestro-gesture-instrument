import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

const NOTES = [
  "C4", "D4", "E4", "G4", "A4",
  "C5", "D5", "E5", "G5", "A5",
];

const CHORDS = [
  { name: "Cmaj7", notes: ["C3", "E3", "G3", "B3"] },
  { name: "Am7", notes: ["A2", "C3", "E3", "G3"] },
  { name: "Fmaj7", notes: ["F2", "A2", "C3", "E3"] },
  { name: "Gsus2", notes: ["G2", "A2", "D3", "G3"] },
  { name: "Dm7", notes: ["D3", "F3", "A3", "C4"] },
];

const PINCH_CLOSE_THRESHOLD = 0.42;
const PINCH_OPEN_THRESHOLD = 0.58;
const PINCH_CLOSE_FRAMES = 3;
const PINCH_OPEN_FRAMES = 4;
const FINGER_STABLE_FRAMES = 3;
const MUTE_STABLE_FRAMES = 4;
const MISSING_HAND_FRAME_LIMIT = 10;
const TILT_MAX_RADIANS = Math.PI / 4;
const CALIBRATION_SAMPLE_COUNT = 24;

const DEFAULT_CALIBRATION = {
  centerX: 0.5,
  centerY: 0.5,
  spanX: 0.92,
  spanY: 0.88,
};

const CUSTOM_PLAY_AREA = {
  spanX: 0.74,
  spanY: 0.66,
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function createDefaultMelody() {
  return {
    present: false,
    isPinching: false,
    note: "A4",
    pitchIndex: 4,
    brightness: 0.5,
    pinchRatio: 1,
  };
}

function createDefaultHarmony() {
  return {
    present: false,
    isChordActive: false,
    fingerCount: 0,
    chordIndex: null,
    chordName: "—",
    chordNotes: [],
    isEffectPose: false,
    wristTilt: 0,
    effectAmount: 0,
    volume: 0.75,
  };
}

function createDefaultCalibration() {
  return {
    ...DEFAULT_CALIBRATION,
    mode: "default",
    samples: [],
  };
}

function createCalibrationInfo(calibration) {
  const progress = Math.round(
    (calibration.samples.length / CALIBRATION_SAMPLE_COUNT) * 100,
  );

  if (calibration.mode === "sampling") {
    return {
      mode: "sampling",
      progress,
      isReady: false,
      message: "Elini sabit tut… %" + progress,
    };
  }

  if (calibration.mode === "ready") {
    return {
      mode: "ready",
      progress: 100,
      isReady: true,
      message: "Kişisel çalma alanın aktif.",
    };
  }

  if (calibration.mode === "needs-hand") {
    return {
      mode: "needs-hand",
      progress: 0,
      isReady: false,
      message: "Önce melodi elini kamera içinde algılat.",
    };
  }

  return {
    mode: "default",
    progress: 0,
    isReady: false,
    message: "İstersen rahat çalma konumunu kalibre edebilirsin.",
  };
}

function createRoleState() {
  return {
    wrist: null,
    smoothedX: null,
    smoothedY: null,
    smoothedPinchRatio: null,
    closeFrameCount: 0,
    openFrameCount: 0,
    missingFrameCount: 0,
    candidateFingerCount: null,
    candidateFingerFrames: 0,
    stableFingerCount: 0,
    stablePitchIndex: null,
    neutralPalmRoll: null,
    smoothedWristTilt: 0,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function average(values) {
  if (!values.length) return 0.5;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function distance(pointA, pointB) {
  return Math.hypot(
    pointA.x - pointB.x,
    pointA.y - pointB.y,
    (pointA.z ?? 0) - (pointB.z ?? 0),
  );
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function getPalmRoll(landmarks) {
  const indexKnuckle = landmarks[5];
  const pinkyKnuckle = landmarks[17];

  return Math.atan2(
    pinkyKnuckle.y - indexKnuckle.y,
    pinkyKnuckle.x - indexKnuckle.x,
  );
}

function angleAt(pointA, vertex, pointC) {
  const firstX = pointA.x - vertex.x;
  const firstY = pointA.y - vertex.y;
  const firstZ = (pointA.z ?? 0) - (vertex.z ?? 0);
  const secondX = pointC.x - vertex.x;
  const secondY = pointC.y - vertex.y;
  const secondZ = (pointC.z ?? 0) - (vertex.z ?? 0);
  const firstLength = Math.hypot(firstX, firstY, firstZ);
  const secondLength = Math.hypot(secondX, secondY, secondZ);

  if (!firstLength || !secondLength) return 0;

  const cosine = clamp(
    (firstX * secondX + firstY * secondY + firstZ * secondZ) /
      (firstLength * secondLength),
    -1,
    1,
  );

  return (Math.acos(cosine) * 180) / Math.PI;
}

function isFingerExtended(landmarks, mcp, pip, dip, tip) {
  const pipAngle = angleAt(
    landmarks[mcp],
    landmarks[pip],
    landmarks[dip],
  );

  const dipAngle = angleAt(
    landmarks[pip],
    landmarks[dip],
    landmarks[tip],
  );

  const fullLength =
    distance(landmarks[mcp], landmarks[pip]) +
    distance(landmarks[pip], landmarks[dip]) +
    distance(landmarks[dip], landmarks[tip]);

  const straightness = fullLength
    ? distance(landmarks[mcp], landmarks[tip]) / fullLength
    : 0;

  return (
    pipAngle > 138 &&
    dipAngle > 130 &&
    straightness > 0.72
  );
}

function isThumbExtended(landmarks) {
  const thumbAngle = angleAt(
    landmarks[2],
    landmarks[3],
    landmarks[4],
  );

  const fullLength =
    distance(landmarks[2], landmarks[3]) +
    distance(landmarks[3], landmarks[4]);

  const straightness = fullLength
    ? distance(landmarks[2], landmarks[4]) / fullLength
    : 0;

  return thumbAngle > 128 && straightness > 0.62;
}

function getFingerCount(landmarks) {
  const thumb = isThumbExtended(landmarks);
  const index = isFingerExtended(landmarks, 5, 6, 7, 8);
  const middle = isFingerExtended(landmarks, 9, 10, 11, 12);
  const ring = isFingerExtended(landmarks, 13, 14, 15, 16);
  const pinky = isFingerExtended(landmarks, 17, 18, 19, 20);

  const nonThumbCount = [index, middle, ring, pinky]
    .filter(Boolean)
    .length;

  return nonThumbCount === 4 && thumb
    ? 5
    : nonThumbCount;
}

function getStablePitchIndex(mappedX, previousIndex) {
  const rawIndex = clamp(
    Math.floor(mappedX * NOTES.length),
    0,
    NOTES.length - 1,
  );

  if (previousIndex === null || previousIndex === rawIndex) {
    return rawIndex;
  }

  const cellWidth = 1 / NOTES.length;
  const lowerBoundary = previousIndex * cellWidth;
  const upperBoundary = (previousIndex + 1) * cellWidth;
  const hysteresis = 0.024;

  if (
    mappedX < lowerBoundary - hysteresis ||
    mappedX > upperBoundary + hysteresis
  ) {
    return rawIndex;
  }

  return previousIndex;
}

function createCandidates(landmarksList) {
  return landmarksList.map((landmarks) => ({
    landmarks,
    displayX: 1 - landmarks[0].x,
  }));
}

function getRoleAssignment(candidates, roleStates) {
  if (!candidates.length) {
    return { melody: null, harmony: null, isSolo: false };
  }

  if (candidates.length === 1) {
    const candidate = candidates[0];
    const melodyWrist = roleStates.melody.wrist;
    const harmonyWrist = roleStates.harmony.wrist;

    if (melodyWrist && harmonyWrist) {
      return distance(candidate.landmarks[0], melodyWrist) <=
        distance(candidate.landmarks[0], harmonyWrist)
        ? { melody: candidate, harmony: null, isSolo: true }
        : { melody: null, harmony: candidate, isSolo: true };
    }

    if (melodyWrist) {
      return { melody: candidate, harmony: null, isSolo: true };
    }

    if (harmonyWrist) {
      return { melody: null, harmony: candidate, isSolo: true };
    }

    return candidate.displayX < 0.5
      ? { melody: candidate, harmony: null, isSolo: true }
      : { melody: null, harmony: candidate, isSolo: true };
  }

  const melodyWrist = roleStates.melody.wrist;
  const harmonyWrist = roleStates.harmony.wrist;

  if (melodyWrist && harmonyWrist) {
    const [firstCandidate, secondCandidate] = candidates;

    const keepDistance =
      distance(firstCandidate.landmarks[0], melodyWrist) +
      distance(secondCandidate.landmarks[0], harmonyWrist);

    const swapDistance =
      distance(secondCandidate.landmarks[0], melodyWrist) +
      distance(firstCandidate.landmarks[0], harmonyWrist);

    return keepDistance <= swapDistance
      ? { melody: firstCandidate, harmony: secondCandidate, isSolo: false }
      : { melody: secondCandidate, harmony: firstCandidate, isSolo: false };
  }

  const [leftCandidate, rightCandidate] = [...candidates].sort(
    (firstCandidate, secondCandidate) =>
      firstCandidate.displayX - secondCandidate.displayX,
  );

  return {
    melody: leftCandidate,
    harmony: rightCandidate,
    isSolo: false,
  };
}

function drawHand(context, landmarks, canvas, options) {
  const { color, label, isActive } = options;

  context.save();
  context.lineWidth = 3;
  context.strokeStyle = color;
  context.shadowBlur = 10;
  context.shadowColor = color;

  HAND_CONNECTIONS.forEach(([start, end]) => {
    context.beginPath();
    context.moveTo(
      landmarks[start].x * canvas.width,
      landmarks[start].y * canvas.height,
    );
    context.lineTo(
      landmarks[end].x * canvas.width,
      landmarks[end].y * canvas.height,
    );
    context.stroke();
  });

  landmarks.forEach((landmark, index) => {
    context.beginPath();
    context.fillStyle =
      index === 4 || index === 8
        ? isActive
          ? "#fff2a8"
          : color
        : "#effff3";
    context.arc(
      landmark.x * canvas.width,
      landmark.y * canvas.height,
      index === 4 || index === 8 ? 6 : 3.5,
      0,
      Math.PI * 2,
    );
    context.fill();
  });

  context.restore();

  const wrist = landmarks[0];
  const labelX = wrist.x * canvas.width + 14;
  const labelY = Math.max(26, wrist.y * canvas.height - 16);

  context.save();
  context.translate(labelX, labelY);
  context.scale(-1, 1);
  context.font = "700 13px Arial";
  context.fillStyle = color;
  context.shadowBlur = 8;
  context.shadowColor = color;
  context.fillText(label, 0, 0);
  context.restore();
}

function drawCalibrationOverlay(context, canvas, calibration) {
  if (calibration.mode !== "sampling") return;

  const progress = Math.round(
    (calibration.samples.length / CALIBRATION_SAMPLE_COUNT) * 100,
  );

  const panelX = canvas.width - 248;

  context.save();
  context.fillStyle = "rgba(8, 10, 28, 0.72)";
  context.strokeStyle = "rgba(123, 215, 255, 0.72)";
  context.lineWidth = 1;
  context.fillRect(panelX, 22, 226, 68);
  context.strokeRect(panelX, 22, 226, 68);
  context.restore();

  context.save();
  context.translate(panelX + 16, 49);
  context.scale(-1, 1);
  context.fillStyle = "#eaf6ff";
  context.font = "700 13px ui-monospace, monospace";
  context.fillText("KALİBRASYON", 0, 0);
  context.restore();

  context.save();
  context.translate(panelX + 16, 73);
  context.scale(-1, 1);
  context.fillStyle = "#9fb3cf";
  context.font = "12px ui-monospace, monospace";
  context.fillText("Elini sabit tut  " + progress + "%", 0, 0);
  context.restore();
}

export function useHandTracker(videoRef, cameraStatus) {
  const canvasRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const runIdRef = useRef(0);
  const isLoadingRef = useRef(false);
  const isRunningRef = useRef(false);
  const handCountRef = useRef(0);

  const roleStatesRef = useRef({
    melody: createRoleState(),
    harmony: createRoleState(),
  });

  const calibrationRef = useRef(createDefaultCalibration());
  const melodyGestureRef = useRef(createDefaultMelody());
  const harmonyGestureRef = useRef(createDefaultHarmony());

  const [handCount, setHandCount] = useState(0);
  const [melodyGesture, setMelodyGesture] = useState(
    createDefaultMelody,
  );
  const [harmonyGesture, setHarmonyGesture] = useState(
    createDefaultHarmony,
  );
  const [calibration, setCalibration] = useState(() =>
    createCalibrationInfo(calibrationRef.current),
  );
  const [trackerStatus, setTrackerStatus] = useState("idle");
  const [trackerError, setTrackerError] = useState(null);

  const publishMelody = useCallback((nextGesture) => {
    const previousGesture = melodyGestureRef.current;

    const hasMeaningfulChange =
      previousGesture.present !== nextGesture.present ||
      previousGesture.isPinching !== nextGesture.isPinching ||
      previousGesture.note !== nextGesture.note ||
      previousGesture.pitchIndex !== nextGesture.pitchIndex ||
      Math.abs(previousGesture.brightness - nextGesture.brightness) > 0.03;

    melodyGestureRef.current = nextGesture;

    if (hasMeaningfulChange) {
      setMelodyGesture(nextGesture);
    }
  }, []);

  const publishHarmony = useCallback((nextGesture) => {
    const previousGesture = harmonyGestureRef.current;

    const hasMeaningfulChange =
      previousGesture.present !== nextGesture.present ||
      previousGesture.isChordActive !== nextGesture.isChordActive ||
      previousGesture.fingerCount !== nextGesture.fingerCount ||
      previousGesture.chordIndex !== nextGesture.chordIndex ||
      previousGesture.isEffectPose !== nextGesture.isEffectPose ||
      Math.abs(previousGesture.wristTilt - nextGesture.wristTilt) > 0.025 ||
      Math.abs(previousGesture.volume - nextGesture.volume) > 0.025;

    harmonyGestureRef.current = nextGesture;

    if (hasMeaningfulChange) {
      setHarmonyGesture(nextGesture);
    }
  }, []);

  const resetRoleTracking = useCallback((role) => {
    roleStatesRef.current[role] = createRoleState();
  }, []);

  const resetCalibration = useCallback(() => {
    calibrationRef.current = createDefaultCalibration();
    setCalibration(createCalibrationInfo(calibrationRef.current));
  }, []);

  const beginCalibration = useCallback(() => {
    if (!melodyGestureRef.current.present) {
      calibrationRef.current = {
        ...calibrationRef.current,
        mode: "needs-hand",
        samples: [],
      };
      setCalibration(createCalibrationInfo(calibrationRef.current));
      return false;
    }

    calibrationRef.current = {
      ...calibrationRef.current,
      mode: "sampling",
      samples: [],
    };
    setCalibration(createCalibrationInfo(calibrationRef.current));
    return true;
  }, []);

  const collectCalibrationSample = useCallback((displayX, controlY) => {
    const activeCalibration = calibrationRef.current;

    if (activeCalibration.mode !== "sampling") return;

    activeCalibration.samples.push({ x: displayX, y: controlY });

    if (activeCalibration.samples.length < CALIBRATION_SAMPLE_COUNT) {
      setCalibration(createCalibrationInfo(activeCalibration));
      return;
    }

    const centerX = clamp(
      average(activeCalibration.samples.map((sample) => sample.x)),
      CUSTOM_PLAY_AREA.spanX / 2,
      1 - CUSTOM_PLAY_AREA.spanX / 2,
    );
    const centerY = clamp(
      average(activeCalibration.samples.map((sample) => sample.y)),
      CUSTOM_PLAY_AREA.spanY / 2,
      1 - CUSTOM_PLAY_AREA.spanY / 2,
    );

    calibrationRef.current = {
      centerX,
      centerY,
      spanX: CUSTOM_PLAY_AREA.spanX,
      spanY: CUSTOM_PLAY_AREA.spanY,
      mode: "ready",
      samples: [],
    };
    setCalibration(createCalibrationInfo(calibrationRef.current));
  }, []);

  const releaseRole = useCallback((role) => {
    if (role === "melody") {
      publishMelody({
        ...melodyGestureRef.current,
        present: false,
        isPinching: false,
      });
      return;
    }

    publishHarmony({
      ...createDefaultHarmony(),
      present: false,
    });
  }, [publishHarmony, publishMelody]);

  const resetAllTracking = useCallback(() => {
    resetRoleTracking("melody");
    resetRoleTracking("harmony");
  }, [resetRoleTracking]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const stopTracking = useCallback(() => {
    runIdRef.current += 1;
    isRunningRef.current = false;

    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    clearCanvas();
    releaseRole("melody");
    releaseRole("harmony");
    resetAllTracking();
    resetCalibration();

    handCountRef.current = 0;
    setHandCount(0);
    setTrackerStatus("idle");
    setTrackerError(null);
  }, [clearCanvas, releaseRole, resetAllTracking, resetCalibration]);

  const updateMelodyRole = useCallback((candidate) => {
    const state = roleStatesRef.current.melody;
    const landmarks = candidate.landmarks;

    state.missingFrameCount = 0;
    state.wrist = {
      x: landmarks[0].x,
      y: landmarks[0].y,
    };

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const pinchCenterX = (thumbTip.x + indexTip.x) / 2;
    const pinchCenterY = (thumbTip.y + indexTip.y) / 2;

    const pinchAperture = Math.min(
      distance(landmarks[4], landmarks[8]),
      distance(landmarks[4], landmarks[7]),
      distance(landmarks[3], landmarks[8]),
    );

    const handScale = Math.max(
      distance(landmarks[0], landmarks[9]),
      distance(landmarks[5], landmarks[17]),
      0.01,
    );

    const rawPinchRatio = pinchAperture / handScale;

    if (state.smoothedPinchRatio === null) {
      state.smoothedPinchRatio = rawPinchRatio;
    } else {
      state.smoothedPinchRatio =
        state.smoothedPinchRatio * 0.67 + rawPinchRatio * 0.33;
    }

    const wasPinching = melodyGestureRef.current.isPinching;
    const pinchRatio = state.smoothedPinchRatio;
    let isPinching = wasPinching;

    if (!wasPinching) {
      state.openFrameCount = 0;
      state.closeFrameCount =
        pinchRatio <= PINCH_CLOSE_THRESHOLD
          ? state.closeFrameCount + 1
          : 0;

      if (state.closeFrameCount >= PINCH_CLOSE_FRAMES) {
        isPinching = true;
        state.closeFrameCount = 0;
      }
    } else {
      state.closeFrameCount = 0;
      state.openFrameCount =
        pinchRatio >= PINCH_OPEN_THRESHOLD
          ? state.openFrameCount + 1
          : 0;

      if (state.openFrameCount >= PINCH_OPEN_FRAMES) {
        isPinching = false;
        state.openFrameCount = 0;
      }
    }

    const rawDisplayX = 1 - pinchCenterX;
    const rawControlY = pinchCenterY;

    if (state.smoothedX === null) {
      state.smoothedX = rawDisplayX;
    } else {
      state.smoothedX = state.smoothedX * 0.76 + rawDisplayX * 0.24;
    }

    if (state.smoothedY === null) {
      state.smoothedY = rawControlY;
    } else {
      state.smoothedY = state.smoothedY * 0.76 + rawControlY * 0.24;
    }

    collectCalibrationSample(state.smoothedX, state.smoothedY);

    const activeCalibration = calibrationRef.current;
    const mappedX = clamp(
      (state.smoothedX -
        (activeCalibration.centerX - activeCalibration.spanX / 2)) /
        activeCalibration.spanX,
      0,
      1,
    );
    const mappedY = clamp(
      (state.smoothedY -
        (activeCalibration.centerY - activeCalibration.spanY / 2)) /
        activeCalibration.spanY,
      0,
      1,
    );

    state.stablePitchIndex = getStablePitchIndex(
      mappedX,
      state.stablePitchIndex,
    );
    const note = NOTES[state.stablePitchIndex];

    const nextGesture = {
      present: true,
      isPinching,
      note,
      pitchIndex: state.stablePitchIndex,
      brightness: 1 - mappedY,
      pinchRatio,
    };

    publishMelody(nextGesture);
    return nextGesture;
  }, [collectCalibrationSample, publishMelody]);

  const updateHarmonyRole = useCallback((candidate) => {
    const state = roleStatesRef.current.harmony;
    const landmarks = candidate.landmarks;

    state.missingFrameCount = 0;
    state.wrist = {
      x: landmarks[0].x,
      y: landmarks[0].y,
    };

    if (state.neutralPalmRoll === null) {
      state.neutralPalmRoll = getPalmRoll(landmarks);
    }

    const fingerCount = getFingerCount(landmarks);

    if (state.candidateFingerCount !== fingerCount) {
      state.candidateFingerCount = fingerCount;
      state.candidateFingerFrames = 1;
    } else {
      state.candidateFingerFrames += 1;
    }

    const stableFramesNeeded =
      fingerCount === 0
        ? MUTE_STABLE_FRAMES
        : FINGER_STABLE_FRAMES;

    if (state.candidateFingerFrames >= stableFramesNeeded) {
      state.stableFingerCount = fingerCount;
    }

    const rawTilt = clamp(
      normalizeAngle(
        getPalmRoll(landmarks) - state.neutralPalmRoll,
      ) / TILT_MAX_RADIANS,
      -1,
      1,
    );

    state.smoothedWristTilt =
      state.smoothedWristTilt * 0.62 + rawTilt * 0.38;

    const wristTilt = state.smoothedWristTilt;
    const handHeight = clamp(1 - landmarks[9].y, 0, 1);

    const chordIndex =
      state.stableFingerCount > 0
        ? state.stableFingerCount - 1
        : null;

    const chord = chordIndex === null
      ? null
      : CHORDS[chordIndex];

    const nextGesture = {
      present: true,
      isChordActive: chordIndex !== null,
      fingerCount: state.stableFingerCount,
      chordIndex,
      chordName: chord?.name ?? "—",
      chordNotes: chord?.notes ?? [],
      isEffectPose: Math.abs(wristTilt) > 0.08,
      wristTilt,
      effectAmount: Math.abs(wristTilt),
      volume: clamp(0.45 + handHeight * 0.55, 0.45, 1),
    };

    publishHarmony(nextGesture);
    return nextGesture;
  }, [publishHarmony]);

  const markRoleMissing = useCallback((role) => {
    const state = roleStatesRef.current[role];

    state.missingFrameCount += 1;

    if (state.missingFrameCount >= MISSING_HAND_FRAME_LIMIT) {
      releaseRole(role);
      resetRoleTracking(role);
    }
  }, [releaseRole, resetRoleTracking]);

  const startTracking = useCallback(async () => {
    const video = videoRef.current;

    if (
      cameraStatus !== "active" ||
      !video ||
      isLoadingRef.current ||
      isRunningRef.current
    ) {
      return;
    }

    isLoadingRef.current = true;

    const currentRunId = runIdRef.current + 1;
    runIdRef.current = currentRunId;

    setTrackerStatus("loading");
    setTrackerError(null);

    try {
      if (!handLandmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);

        handLandmarkerRef.current =
          await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
      }

      if (currentRunId !== runIdRef.current) return;

      isRunningRef.current = true;
      lastVideoTimeRef.current = -1;
      setTrackerStatus("tracking");

      const renderLoop = () => {
        if (
          currentRunId !== runIdRef.current ||
          !isRunningRef.current
        ) {
          return;
        }

        const currentVideo = videoRef.current;
        const canvas = canvasRef.current;

        if (
          !currentVideo ||
          !canvas ||
          currentVideo.readyState < 2 ||
          !handLandmarkerRef.current
        ) {
          animationFrameRef.current =
            window.requestAnimationFrame(renderLoop);
          return;
        }

        if (
          canvas.width !== currentVideo.videoWidth ||
          canvas.height !== currentVideo.videoHeight
        ) {
          canvas.width = currentVideo.videoWidth;
          canvas.height = currentVideo.videoHeight;
        }

        if (currentVideo.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = currentVideo.currentTime;

          const result = handLandmarkerRef.current.detectForVideo(
            currentVideo,
            performance.now(),
          );

          const context = canvas.getContext("2d");
          context.clearRect(0, 0, canvas.width, canvas.height);

          const candidates = createCandidates(result.landmarks ?? []);

          if (handCountRef.current !== candidates.length) {
            handCountRef.current = candidates.length;
            setHandCount(candidates.length);
          }

          const roles = getRoleAssignment(
            candidates,
            roleStatesRef.current,
          );

          if (roles.melody) {
            const gesture = updateMelodyRole(roles.melody);
            const label = roles.isSolo
              ? "TEK EL · MELODİ"
              : "SOL · MELODİ";

            drawHand(context, roles.melody.landmarks, canvas, {
              color: "#8fe7ff",
              label,
              isActive: gesture.isPinching,
            });
          } else {
            markRoleMissing("melody");
          }

          if (roles.harmony) {
            const gesture = updateHarmonyRole(roles.harmony);

            const effectPercent = Math.round(
              gesture.effectAmount * 100,
            );

            const label = gesture.isChordActive
              ? `SAĞ · ${gesture.fingerCount}P · FX ${effectPercent}%`
              : `SAĞ · AKOR · FX ${effectPercent}%`;

            drawHand(context, roles.harmony.landmarks, canvas, {
              color: "#ffc86b",
              label,
              isActive: gesture.isChordActive,
            });
          } else {
            markRoleMissing("harmony");
          }

          drawCalibrationOverlay(context, canvas, calibrationRef.current);
        }

        animationFrameRef.current =
          window.requestAnimationFrame(renderLoop);
      };

      renderLoop();
    } catch (error) {
      console.error(error);

      if (currentRunId === runIdRef.current) {
        setTrackerStatus("error");
        setTrackerError(
          "El algılama modeli başlatılamadı. İnternet bağlantını kontrol edip tekrar dene.",
        );
      }
    } finally {
      isLoadingRef.current = false;
    }
  }, [
    cameraStatus,
    markRoleMissing,
    updateHarmonyRole,
    updateMelodyRole,
    videoRef,
  ]);

  useEffect(() => {
    if (cameraStatus === "active") {
      startTracking();
    } else {
      stopTracking();
    }
  }, [cameraStatus, startTracking, stopTracking]);

  useEffect(() => {
    return () => {
      stopTracking();
      handLandmarkerRef.current?.close?.();
      handLandmarkerRef.current = null;
    };
  }, [stopTracking]);

  return {
    canvasRef,
    handCount,
    gesture: melodyGesture,
    melodyGesture,
    harmonyGesture,
    calibration,
    beginCalibration,
    resetCalibration,
    trackerStatus,
    trackerError,
  };
}
