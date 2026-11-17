import { useCallback, useEffect, useRef, useState } from "react";

export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isStartingRef = useRef(false);

  const [cameraError, setCameraError] = useState(null);
  const [cameraStatus, setCameraStatus] = useState("idle");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraStatus("idle");
  }, []);

  const startCamera = useCallback(async () => {
    if (isStartingRef.current || cameraStatus === "active") return true;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Bu tarayıcı kamera erişimini desteklemiyor.");
      setCameraStatus("error");
      return false;
    }

    isStartingRef.current = true;
    setCameraError(null);
    setCameraStatus("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        throw new Error("Kamera görüntüsü bağlanamadı.");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraStatus("active");
      return true;
    } catch (error) {
      console.error(error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraStatus("error");
      setCameraError(
        "Kamera açılamadı. Tarayıcıdaki kamera iznini ve başka bir uygulamanın kamerayı kullanıp kullanmadığını kontrol et.",
      );
      return false;
    } finally {
      isStartingRef.current = false;
    }
  }, [cameraStatus]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return {
    videoRef,
    cameraStatus,
    cameraError,
    startCamera,
    stopCamera,
  };
}
