import { useCallback, useEffect, useState } from "react";
import { useCamera } from "./hooks/useCamera";
import { INSTRUMENTS, useGestureSynth } from "./hooks/useGestureSynth";
import { useHandTracker } from "./hooks/useHandTracker";
import "./App.css";

const NOTE_NAMES = ["C", "D", "E", "G", "A", "C", "D", "E", "G", "A"];

function App() {
  const {
    videoRef,
    cameraStatus,
    cameraError,
    startCamera,
    stopCamera,
  } = useCamera();

  const {
    canvasRef,
    handCount,
    gesture: melodyGesture,
    harmonyGesture,
    calibration,
    beginCalibration,
    resetCalibration,
    trackerStatus,
    trackerError,
  } = useHandTracker(videoRef, cameraStatus);

  const {
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
  } = useGestureSynth();

  const [isStarting, setIsStarting] = useState(false);
  const isLive = cameraStatus === "active";
  const isLoading = isStarting || cameraStatus === "requesting";
  const isCalibrating = calibration.mode === "sampling";

  const currentNote = playingNote ?? "—";
  const currentChord = playingChord ?? harmonyGesture?.chordName ?? "—";
  const effectPercent = Math.round((harmonyGesture?.effectAmount ?? 0) * 100);
  const volumePercent = Math.round((harmonyGesture?.volume ?? 0.45) * 100);
  const noteIndex = melodyGesture?.pitchIndex ?? 4;

  const activeInstrument = INSTRUMENTS.find(
    (instrument) => instrument.id === instrumentId,
  ) ?? INSTRUMENTS[0];

  const statusMessage =
    audioError ??
    cameraError ??
    trackerError ??
    (isLoading
      ? "Sahne hazırlanıyor…"
      : isLive
        ? trackerStatus === "tracking"
          ? "Canlı işleme cihazında gerçekleşiyor."
          : "El algılama modeli yükleniyor…"
        : "Kamera ve ses erişimi sadece tarayıcında kullanılır.");

  const startPerformance = useCallback(async () => {
    if (isLive || isStarting) return;

    setIsStarting(true);
    const audioStarted = await startAudio();

    if (audioStarted === false) {
      setIsStarting(false);
      return;
    }

    const cameraStarted = await startCamera();

    if (cameraStarted === false) {
      stopAudio();
    }

    setIsStarting(false);
  }, [isLive, isStarting, startAudio, startCamera, stopAudio]);

  const stopPerformance = useCallback(() => {
    stopCamera();
    stopAudio();
  }, [stopAudio, stopCamera]);

  useEffect(() => {
    if (isLive && isAudioReady) {
      applyGestures(melodyGesture, harmonyGesture);
    }
  }, [
    applyGestures,
    harmonyGesture,
    isAudioReady,
    isLive,
    melodyGesture,
  ]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  return (
    <main className="airmaestro">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <nav className="app-nav" aria-label="AirMaestro ana menüsü">
        <a className="brand" href="#stage" aria-label="AirMaestro ana sayfa">
          <span className="brand-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>airmaestro</span>
        </a>

        <div className="nav-center">
          <span>GESTURE INSTRUMENT</span>
          <b>•</b>
          <span>LOCAL SESSION</span>
        </div>

        <span
          className={
            "live-pill " + (isLive ? "live-pill--active" : "")
          }
        >
          <i />
          {isLive ? "LIVE" : "STANDBY"}
        </span>
      </nav>

      <section className="hero">
        <div>
          <p className="kicker">
            <span /> COMPUTER VISION × SOUND DESIGN
          </p>
          <h1>
            Hareket et.
            <br />
            <em>Sesini şekillendir.</em>
          </h1>
        </div>

        <p className="hero-copy">
          Kamera karşısında gerçek zamanlı, dokunmadan ve tamamen tarayıcı
          içinde müzik üret.
        </p>
      </section>

      <section className="studio" id="stage" aria-label="Performans sahnesi">
        <article className="stage-card">
          <header className="stage-topline">
            <div className="eyebrow-group">
              <span className="label-dot" />
              <span>PERFORMANCE FEED</span>
            </div>

            <div className="tracking-state">
              <i className={handCount ? "is-seeing" : ""} />
              {handCount
                ? handCount + " EL ALGILANDI"
                : isLive
                  ? "EL BEKLENİYOR"
                  : "KAMERA KAPALI"}
            </div>
          </header>

          <div className="camera-stage">
            <video ref={videoRef} autoPlay muted playsInline />
            <canvas ref={canvasRef} aria-label="El takip görselleştirmesi" />

            <div className="stage-reticle reticle--top-left" />
            <div className="stage-reticle reticle--bottom-right" />

            {!isLive && (
              <div className="stage-idle">
                <div className="stage-idle-orb">
                  <span />
                  <span />
                  <span />
                </div>

                <strong>Performans için hazır.</strong>
                <p>Kamerayı aç, ellerini çerçeveye getir ve müziği başlat.</p>
              </div>
            )}

            {isLive && (
              <div className="video-chip">
                <span className="pulse-dot" />
                ON-DEVICE TRACKING
              </div>
            )}
          </div>

          <footer className="stage-footer">
            <span>
              MODE <b>PENTATONIC / C</b>
            </span>
            <span>
              AUDIO <b>{isAudioReady ? "READY" : "ARMING"}</b>
            </span>
            <span>
              FPS <b>{trackerStatus === "tracking" ? "LIVE" : "—"}</b>
            </span>
          </footer>
        </article>

        <aside className="mixer-card" aria-label="Canlı ses kontrolü">
          <div className="mixer-heading">
            <div>
              <p className="section-label">LIVE MIXER</p>
              <h2>Kontrol yüzeyi</h2>
            </div>

            <span className="sound-ready">
              <i className={isAudioReady ? "is-ready" : ""} />
              {isAudioReady ? "AUDIO READY" : "AUDIO IDLE"}
            </span>
          </div>

          <section
            className="calibration-card"
            aria-label="Melodi enstrümanı seçimi"
          >
            <div className="calibration-head">
              <div>
                <span className="section-label">MELODY INSTRUMENT</span>
                <b>{activeInstrument.label}</b>
              </div>

              <span className="calibration-badge calibration-badge--ready">
                {isInstrumentChanging ? "YÜKLENİYOR" : "SEÇİLİ"}
              </span>
            </div>

            <p>
              {activeInstrument.detail}. Seçim, pinch ile çalınan melodi
              sesini değiştirir.
            </p>

            <div className="calibration-actions">
              {INSTRUMENTS.map((instrument) => (
                <button
                  className="quiet-button"
                  disabled={isInstrumentChanging}
                  key={instrument.id}
                  onClick={() => setInstrument(instrument.id)}
                  style={
                    instrument.id === instrumentId
                      ? {
                          borderColor: "rgba(128, 229, 255, 0.75)",
                          background: "rgba(128, 229, 255, 0.16)",
                          color: "#e8fbff",
                        }
                      : undefined
                  }
                  type="button"
                >
                  {instrument.label}
                </button>
              ))}
            </div>
          </section>

          <div className="sound-readout">
            <div className="readout-main">
              <span>MELODİ · {activeInstrument.label.toUpperCase()}</span>
              <strong>{currentNote}</strong>
              <small>
                {melodyGesture?.isPinching
                  ? "PINCH AKTİF"
                  : "PINCH İLE ÇAL"}
              </small>
            </div>

            <div className="readout-chord">
              <span>AKOR</span>
              <b>{currentChord}</b>
              <small>
                {harmonyGesture?.present
                  ? (harmonyGesture.fingerCount ?? 0) + " PARMAK"
                  : "SAĞ EL BEKLİYOR"}
              </small>
            </div>
          </div>

          <div className="pitch-strip">
            <div className="strip-heading">
              <span>PITCH LANE</span>
              <b>{NOTE_NAMES[noteIndex] ?? "—"}</b>
            </div>

            <div className="pitch-steps">
              {NOTE_NAMES.map((noteName, index) => (
                <span
                  className={
                    "pitch-step " +
                    (index === noteIndex ? "pitch-step--active" : "")
                  }
                  key={noteName + index}
                />
              ))}
            </div>
          </div>

          <div className="parameter-grid">
            <div className="parameter">
              <div
                className="dial"
                style={{ "--dial-value": String(effectPercent) + "%" }}
              >
                <div>
                  <b>{effectPercent}</b>
                  <small>%</small>
                </div>
              </div>

              <span>WRIST FX</span>
              <small>Bileği yatır</small>
            </div>

            <div className="parameter">
              <div
                className="dial dial--violet"
                style={{ "--dial-value": String(volumePercent) + "%" }}
              >
                <div>
                  <b>{volumePercent}</b>
                  <small>%</small>
                </div>
              </div>

              <span>CHORD LEVEL</span>
              <small>Sağ eli yükselt</small>
            </div>
          </div>

          <section
            className="calibration-card"
            aria-label="Kişisel kalibrasyon"
          >
            <div className="calibration-head">
              <div>
                <span className="section-label">COMFORT ZONE</span>
                <b>Kişisel kalibrasyon</b>
              </div>

              <span
                className={
                  "calibration-badge calibration-badge--" + calibration.mode
                }
              >
                {calibration.mode === "ready"
                  ? "AKTİF"
                  : calibration.mode === "sampling"
                    ? "ÖLÇÜLÜYOR"
                    : "OPSİYONEL"}
              </span>
            </div>

            <p>{calibration.message}</p>

            {isCalibrating && (
              <div
                className="calibration-progress"
                aria-label={"Kalibrasyon: %" + calibration.progress}
              >
                <i style={{ width: String(calibration.progress) + "%" }} />
              </div>
            )}

            <div className="calibration-actions">
              <button
                className="quiet-button"
                disabled={!isLive || isCalibrating}
                onClick={beginCalibration}
                type="button"
              >
                <span>⌖</span>
                {isCalibrating ? "Ölçülüyor…" : "Konumumu kalibre et"}
              </button>

              {calibration.isReady && (
                <button
                  className="icon-button"
                  onClick={resetCalibration}
                  title="Kalibrasyonu sıfırla"
                  type="button"
                >
                  ↺
                </button>
              )}
            </div>
          </section>

          <div className="gesture-map">
            <p className="section-label">GESTURE MAP</p>

            <div>
              <span className="gesture-icon">✦</span>
              <p>
                <b>Sol el</b> Pinch ile melodi; yatay hareket ile nota.
              </p>
            </div>

            <div>
              <span className="gesture-icon gesture-icon--violet">✧</span>
              <p>
                <b>Sağ el</b> Parmak sayısı akor; yükseklik ses seviyesi.
              </p>
            </div>

            <div>
              <span className="gesture-icon gesture-icon--pink">⌁</span>
              <p>
                <b>Bilek</b> Sesi koyulaştırır, açar ve derinlik verir.
              </p>
            </div>
          </div>

          <button
            className="performance-button"
            disabled={isLoading}
            onClick={isLive ? stopPerformance : startPerformance}
            type="button"
          >
            <span>{isLive ? "■" : "▶"}</span>
            {isLoading
              ? "Hazırlanıyor…"
              : isLive
                ? "Performansı durdur"
                : "Performansı başlat"}
          </button>

          <p
            className={
              "runtime-message " +
              (cameraError || trackerError || audioError
                ? "runtime-message--error"
                : "")
            }
          >
            {statusMessage}
          </p>
        </aside>
      </section>

      <footer className="trust-bar">
        <span className="trust-icon">⌾</span>
        <p>
          <b>Gizlilik önce gelir.</b> Kamera görüntüsü, el koordinatları ve
          üretilen ses bu tarayıcı oturumu dışına gönderilmez.
        </p>
        <span className="trust-status">BROWSER-ONLY</span>
      </footer>
    </main>
  );
}

export default App;