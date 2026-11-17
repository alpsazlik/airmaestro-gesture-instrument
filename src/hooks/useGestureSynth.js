import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

export const INSTRUMENTS = [
  { id: "synth", label: "Synth", detail: "Geniş ve modern" },
  { id: "piano", label: "Piyano", detail: "Gerçek piyano kayıtları" },
  { id: "sax", label: "Saksafon", detail: "Gerçek saksafon kayıtları" },
];

const PIANO_SAMPLE_BASE_URL = "https://tonejs.github.io/audio/salamander/";
const SAX_SAMPLE_BASE_URL =
  "https://cdn.jsdelivr.net/npm/tonejs-instrument-saxophone-mp3@1.1.2/";

const PIANO_SAMPLE_URLS = {
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
  A5: "A5.mp3",
};

const SAX_SAMPLE_URLS = {
  C4: "C4.mp3",
  D4: "D4.mp3",
  E4: "E4.mp3",
  G4: "G4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  D5: "D5.mp3",
  E5: "E5.mp3",
  G5: "G5.mp3",
  A5: "A5.mp3",
};

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function ramp(parameter, value, seconds) {
  if (!parameter) return;
  parameter.rampTo?.(value, seconds);
}

function disposeNode(node) {
  try {
    node?.dispose?.();
  } catch (error) {
    console.warn("Ses düğümü kapatılamadı.", error);
  }
}

function createSampledVoice(
  {
    baseUrl,
    urls,
    volume,
    release,
    minimumCutoff,
    maximumCutoff,
  },
  destination,
) {
  const color = new Tone.Filter({
    frequency: maximumCutoff,
    type: "lowpass",
    rolloff: -24,
    Q: 0.25,
  });

  const compressor = new Tone.Compressor({
    threshold: -20,
    ratio: 2.4,
    attack: 0.008,
    release: 0.15,
  });

  const expressionGain = new Tone.Gain(1);

  let settled = false;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const finishLoading = () => {
    if (settled) return;
    settled = true;
    resolveReady();
  };

  const failLoading = (error) => {
    if (settled) return;
    settled = true;

    rejectReady(
      error instanceof Error
        ? error
        : new Error("Ses örnekleri indirilemedi."),
    );
  };

  const sampler = new Tone.Sampler({
    urls,
    baseUrl,
    attack: 0.008,
    release,
    onload: finishLoading,
    onerror: failLoading,
  });

  sampler.chain(color, compressor, expressionGain, destination);
  sampler.volume.value = volume;

  return {
    ready,

    attack(note, time, velocity) {
      if (!sampler.loaded) return;
      sampler.triggerAttack(note, time, clamp(velocity + 0.16, 0.1, 1));
    },

    release(note, time) {
      if (!sampler.loaded || !note) return;
      sampler.triggerRelease(note, time);
    },

    changeNote(previousNote, nextNote, time, velocity) {
      if (!sampler.loaded) return;

      if (previousNote) {
        sampler.triggerRelease(previousNote, time);
      }

      sampler.triggerAttack(
        nextNote,
        time + 0.018,
        clamp(velocity + 0.16, 0.1, 1),
      );
    },

    setExpression(brightness) {
      const safeBrightness = clamp(brightness, 0, 1);

      ramp(
        color.frequency,
        minimumCutoff + safeBrightness * (maximumCutoff - minimumCutoff),
        0.08,
      );

      ramp(expressionGain.gain, 0.9 + safeBrightness * 0.16, 0.08);
    },

    dispose() {
      [sampler, color, compressor, expressionGain].forEach(disposeNode);
    },
  };
}

function createSynthVoice(destination) {
  const color = new Tone.Filter({
    frequency: 1650,
    type: "lowpass",
    rolloff: -24,
    Q: 0.45,
  });

  const chorus = new Tone.Chorus({
    frequency: 0.18,
    delayTime: 3.6,
    depth: 0.32,
    wet: 0.24,
  }).start();

  const synth = new Tone.Synth({
    portamento: 0.085,
    oscillator: { type: "triangle" },
    envelope: {
      attack: 0.08,
      decay: 0.22,
      sustain: 0.62,
      release: 0.72,
    },
  });

  synth.chain(color, chorus, destination);
  synth.volume.value = -8;

  return {
    ready: Promise.resolve(),

    attack(note, time, velocity) {
      synth.triggerAttack(note, time, velocity);
    },

    release(_note, time) {
      synth.triggerRelease(time);
    },

    changeNote(_previousNote, nextNote, time, velocity) {
      synth.triggerRelease(time);
      synth.triggerAttack(nextNote, time + 0.018, velocity);
    },

    setExpression(brightness) {
      ramp(color.frequency, 800 + brightness * 3000, 0.1);
    },

    dispose() {
      [synth, color, chorus].forEach(disposeNode);
    },
  };
}

function createPianoVoice(destination) {
  return createSampledVoice(
    {
      baseUrl: PIANO_SAMPLE_BASE_URL,
      urls: PIANO_SAMPLE_URLS,
      volume: 3,
      release: 1.45,
      minimumCutoff: 2300,
      maximumCutoff: 10400,
    },
    destination,
  );
}

function createSaxVoice(destination) {
  return createSampledVoice(
    {
      baseUrl: SAX_SAMPLE_BASE_URL,
      urls: SAX_SAMPLE_URLS,
      volume: 4,
      release: 0.32,
      minimumCutoff: 1800,
      maximumCutoff: 7600,
    },
    destination,
  );
}

function createMelodyVoice(instrumentId, destination) {
  if (instrumentId === "piano") return createPianoVoice(destination);
  if (instrumentId === "sax") return createSaxVoice(destination);

  return createSynthVoice(destination);
}

function createHarmonyVoice(instrumentId, destination) {
  const settings = {
    synth: {
      oscillator: { type: "sawtooth" },
      envelope: {
        attack: 0.045,
        decay: 0.28,
        sustain: 0.58,
        release: 1.15,
      },
      filterFrequency: 3150,
      volume: -4,
    },

    piano: {
      oscillator: { type: "triangle8" },
      envelope: {
        attack: 0.012,
        decay: 0.72,
        sustain: 0.16,
        release: 1.35,
      },
      filterFrequency: 4300,
      volume: -11,
    },

    sax: {
      oscillator: { type: "triangle4" },
      envelope: {
        attack: 0.16,
        decay: 0.48,
        sustain: 0.52,
        release: 1.7,
      },
      filterFrequency: 2250,
      volume: -12,
    },
  }[instrumentId] ?? {
    oscillator: { type: "sawtooth" },
    envelope: {
      attack: 0.045,
      decay: 0.28,
      sustain: 0.58,
      release: 1.15,
    },
    filterFrequency: 3150,
    volume: -4,
  };

  const color = new Tone.Filter({
    frequency: settings.filterFrequency,
    type: "lowpass",
    rolloff: -24,
    Q: 0.55,
  });

  const harmony = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 10,
    oscillator: settings.oscillator,
    envelope: settings.envelope,
  });

  harmony.chain(color, destination);
  harmony.volume.value = settings.volume;

  return {
    synth: harmony,

    dispose() {
      [harmony, color].forEach(disposeNode);
    },
  };
}

export function useGestureSynth() {
  const melodyVoiceRef = useRef(null);
  const harmonyVoiceRef = useRef(null);
  const harmonySynthRef = useRef(null);
  const performanceFilterRef = useRef(null);
  const harmonyGainRef = useRef(null);
  const reverbRef = useRef(null);
  const masterRef = useRef(null);

  const audioReadyRef = useRef(false);
  const melodyPinchingRef = useRef(false);
  const currentMelodyNoteRef = useRef(null);
  const currentChordNotesRef = useRef([]);
  const currentChordKeyRef = useRef(null);
  const selectedInstrumentRef = useRef("synth");
  const activePresetIdRef = useRef(null);
  const presetRequestRef = useRef(0);

  const lastEffectRef = useRef({
    cutoff: 3750,
    wet: 0.16,
    volume: 0.72,
  });

  const [isAudioReady, setIsAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [playingNote, setPlayingNote] = useState(null);
  const [playingChord, setPlayingChord] = useState(null);
  const [instrumentId, setInstrumentId] = useState("synth");
  const [isInstrumentChanging, setIsInstrumentChanging] = useState(false);

  const releaseMelody = useCallback(() => {
    const melody = melodyVoiceRef.current;
    const note = currentMelodyNoteRef.current;

    if (melodyPinchingRef.current && melody) {
      melody.release(note, Tone.now());
    }

    melodyPinchingRef.current = false;
    currentMelodyNoteRef.current = null;
    setPlayingNote(null);
  }, []);

  const releaseHarmony = useCallback(() => {
    const harmony = harmonySynthRef.current;
    const now = Tone.now();

    currentChordNotesRef.current.forEach((note) => {
      harmony?.triggerRelease(note, now);
    });

    currentChordNotesRef.current = [];
    currentChordKeyRef.current = null;
    setPlayingChord(null);
  }, []);

  const disposeActivePreset = useCallback(() => {
    melodyVoiceRef.current?.dispose();
    harmonyVoiceRef.current?.dispose();

    melodyVoiceRef.current = null;
    harmonyVoiceRef.current = null;
    harmonySynthRef.current = null;
    activePresetIdRef.current = null;
  }, []);

  const buildPreset = useCallback((nextInstrumentId) => {
    const melodyDestination = performanceFilterRef.current;
    const harmonyDestination = harmonyGainRef.current;

    if (!melodyDestination || !harmonyDestination) {
      throw new Error("Ses çıkışı henüz hazır değil.");
    }

    const melody = createMelodyVoice(nextInstrumentId, melodyDestination);
    const harmony = createHarmonyVoice(nextInstrumentId, harmonyDestination);

    return {
      id: nextInstrumentId,
      melody,
      harmony,
      ready: melody.ready ?? Promise.resolve(),
    };
  }, []);

  const activatePreset = useCallback(
    (preset) => {
      const previousMelody = melodyVoiceRef.current;
      const previousHarmony = harmonyVoiceRef.current;

      releaseMelody();
      releaseHarmony();

      melodyVoiceRef.current = preset.melody;
      harmonyVoiceRef.current = preset.harmony;
      harmonySynthRef.current = preset.harmony.synth;
      activePresetIdRef.current = preset.id;

      previousMelody?.dispose();
      previousHarmony?.dispose();
    },
    [releaseHarmony, releaseMelody],
  );

  const resetEffects = useCallback(() => {
    ramp(performanceFilterRef.current?.frequency, 3750, 0.16);
    ramp(reverbRef.current?.wet, 0.16, 0.2);
    ramp(harmonyGainRef.current?.gain, 0.72, 0.12);

    lastEffectRef.current = {
      cutoff: 3750,
      wet: 0.16,
      volume: 0.72,
    };
  }, []);

  const startAudio = useCallback(async () => {
    setAudioError(null);
    let loadingPreset = null;

    try {
      await Tone.start();

      if (!masterRef.current) {
        const master = new Tone.Gain(0.68).toDestination();

        const reverb = new Tone.Reverb({
          decay: 2.7,
          preDelay: 0.02,
          wet: 0.18,
        });

        await reverb.ready;

        const performanceFilter = new Tone.Filter({
          frequency: 3750,
          type: "lowpass",
          rolloff: -24,
          Q: 0.75,
        });

        const harmonyGain = new Tone.Gain(0.72);

        performanceFilter.connect(reverb);
        reverb.connect(master);
        harmonyGain.connect(performanceFilter);

        masterRef.current = master;
        reverbRef.current = reverb;
        performanceFilterRef.current = performanceFilter;
        harmonyGainRef.current = harmonyGain;
      }

      const selectedInstrument = selectedInstrumentRef.current;

      const needsNewPreset =
        !melodyVoiceRef.current ||
        !harmonySynthRef.current ||
        activePresetIdRef.current !== selectedInstrument;

      if (needsNewPreset) {
        releaseMelody();
        releaseHarmony();
        disposeActivePreset();

        loadingPreset = buildPreset(selectedInstrument);
        await loadingPreset.ready;
        activatePreset(loadingPreset);
        loadingPreset = null;
      }

      audioReadyRef.current = true;
      setIsAudioReady(true);
      return true;
    } catch (error) {
      console.error(error);

      loadingPreset?.melody?.dispose();
      loadingPreset?.harmony?.dispose();

      audioReadyRef.current = false;
      setIsAudioReady(false);

      setAudioError(
        "Gerçek enstrüman kayıtları yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.",
      );

      return false;
    }
  }, [
    activatePreset,
    buildPreset,
    disposeActivePreset,
    releaseHarmony,
    releaseMelody,
  ]);

  const setInstrument = useCallback(
    async (nextInstrumentId) => {
      const isKnownInstrument = INSTRUMENTS.some(
        (instrument) => instrument.id === nextInstrumentId,
      );

      if (
        !isKnownInstrument ||
        (nextInstrumentId === selectedInstrumentRef.current &&
          activePresetIdRef.current === nextInstrumentId)
      ) {
        return;
      }

      setAudioError(null);

      if (!audioReadyRef.current) {
        selectedInstrumentRef.current = nextInstrumentId;
        setInstrumentId(nextInstrumentId);
        return;
      }

      const requestId = presetRequestRef.current + 1;
      presetRequestRef.current = requestId;
      setIsInstrumentChanging(true);

      let preset = null;

      try {
        preset = buildPreset(nextInstrumentId);
        await preset.ready;

        if (requestId !== presetRequestRef.current) {
          preset.melody.dispose();
          preset.harmony.dispose();
          return;
        }

        activatePreset(preset);
        selectedInstrumentRef.current = nextInstrumentId;
        setInstrumentId(nextInstrumentId);
        resetEffects();
      } catch (error) {
        console.error(error);

        preset?.melody?.dispose();
        preset?.harmony?.dispose();

        setAudioError(
          "Seçilen enstrümanın kayıtları yüklenemedi. Tekrar dene.",
        );
      } finally {
        if (requestId === presetRequestRef.current) {
          setIsInstrumentChanging(false);
        }
      }
    },
    [activatePreset, buildPreset, resetEffects],
  );

  const stopAudio = useCallback(() => {
    releaseMelody();
    releaseHarmony();
    resetEffects();

    audioReadyRef.current = false;
    setIsAudioReady(false);
  }, [releaseHarmony, releaseMelody, resetEffects]);

  const applyRightHandEffects = useCallback((harmonyGesture) => {
    const isHandPresent = Boolean(harmonyGesture?.present);

    const tilt = isHandPresent
      ? clamp(harmonyGesture.wristTilt ?? 0, -1, 1)
      : 0;

    const cutoff = clamp(3750 + tilt * 3200, 550, 6950);
    const wet = 0.16 + Math.abs(tilt) * 0.22;

    const volume = isHandPresent
      ? clamp(harmonyGesture.volume ?? 0.72, 0.42, 0.92)
      : 0.72;

    if (Math.abs(cutoff - lastEffectRef.current.cutoff) > 18) {
      ramp(performanceFilterRef.current?.frequency, cutoff, 0.12);
      lastEffectRef.current.cutoff = cutoff;
    }

    if (Math.abs(wet - lastEffectRef.current.wet) > 0.008) {
      ramp(reverbRef.current?.wet, wet, 0.16);
      lastEffectRef.current.wet = wet;
    }

    if (Math.abs(volume - lastEffectRef.current.volume) > 0.012) {
      ramp(harmonyGainRef.current?.gain, volume, 0.08);
      lastEffectRef.current.volume = volume;
    }
  }, []);

  const updateMelody = useCallback(
    (melodyGesture) => {
      const melody = melodyVoiceRef.current;
      if (!melody) return;

      if (melodyGesture?.present) {
        melody.setExpression(
          clamp(melodyGesture.brightness ?? 0.5, 0, 1),
        );
      }

      const isPinching = Boolean(
        melodyGesture?.present &&
          melodyGesture?.isPinching &&
          melodyGesture?.note,
      );

      const nextNote = melodyGesture?.note ?? null;
      const now = Tone.now();

      if (isPinching && !melodyPinchingRef.current) {
        melody.attack(nextNote, now, 0.8);
        melodyPinchingRef.current = true;
        currentMelodyNoteRef.current = nextNote;
        setPlayingNote(nextNote);
        return;
      }

      if (
        isPinching &&
        melodyPinchingRef.current &&
        nextNote !== currentMelodyNoteRef.current
      ) {
        melody.changeNote(
          currentMelodyNoteRef.current,
          nextNote,
          now,
          0.8,
        );

        currentMelodyNoteRef.current = nextNote;
        setPlayingNote(nextNote);
        return;
      }

      if (!isPinching && melodyPinchingRef.current) {
        releaseMelody();
      }
    },
    [releaseMelody],
  );

  const updateHarmony = useCallback(
    (harmonyGesture) => {
      const harmony = harmonySynthRef.current;
      if (!harmony) return;

      const isActive = Boolean(
        harmonyGesture?.present &&
          harmonyGesture?.isChordActive &&
          harmonyGesture?.fingerCount > 0,
      );

      if (!isActive) {
        if (currentChordNotesRef.current.length > 0) {
          releaseHarmony();
        }

        return;
      }

      const nextNotes = harmonyGesture.chordNotes ?? [];

      const nextKey =
        String(harmonyGesture.chordIndex) + ":" + nextNotes.join(",");

      if (!nextNotes.length || nextKey === currentChordKeyRef.current) {
        return;
      }

      const now = Tone.now();
      const previousNotes = currentChordNotesRef.current;

      const notesToRelease = previousNotes.filter(
        (note) => !nextNotes.includes(note),
      );

      const notesToAttack = nextNotes.filter(
        (note) => !previousNotes.includes(note),
      );

      notesToRelease.forEach((note) => {
        harmony.triggerRelease(note, now);
      });

      notesToAttack.forEach((note) => {
        harmony.triggerAttack(note, now + 0.015, 0.8);
      });

      currentChordNotesRef.current = [...nextNotes];
      currentChordKeyRef.current = nextKey;
      setPlayingChord(harmonyGesture.chordName ?? "Akor");
    },
    [releaseHarmony],
  );

  const applyGestures = useCallback(
    (melodyGesture, harmonyGesture) => {
      if (!audioReadyRef.current) return;

      applyRightHandEffects(harmonyGesture);
      updateMelody(melodyGesture);
      updateHarmony(harmonyGesture);
    },
    [applyRightHandEffects, updateHarmony, updateMelody],
  );

  useEffect(
    () => () => {
      const now = Tone.now();

      if (melodyPinchingRef.current) {
        melodyVoiceRef.current?.release(currentMelodyNoteRef.current, now);
      }

      currentChordNotesRef.current.forEach((note) => {
        harmonySynthRef.current?.triggerRelease(note, now);
      });

      disposeActivePreset();

      [
        performanceFilterRef.current,
        harmonyGainRef.current,
        reverbRef.current,
        masterRef.current,
      ].forEach(disposeNode);
    },
    [disposeActivePreset],
  );

  return {
    isAudioReady,
    audioError,
    playingNote,
    playingChord,
    instrumentId,
    isInstrumentChanging,
    startAudio,
    stopAudio,
    setInstrument,
    applyGestures,
  };
}