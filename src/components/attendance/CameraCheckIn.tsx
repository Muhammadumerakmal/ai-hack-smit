"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { OpsIcon, type OpsIconName } from "@/components/ops/icons";
import { cx } from "@/components/ops/primitives";
import { Button, Modal, Notice } from "@/components/ui";
import { api } from "@/lib/client";

// Camera check-in (Section 5, bonus). Everything visual happens on this device: MediaPipe's face landmarker
// counts faces and watches for a blink in the live preview. Only the face count, the blink result and the
// GPS fix are sent; the server measures the distance to the office and decides. No photo leaves the browser.

const MP_VERSION = "0.10.21"; // keep in step with @mediapipe/tasks-vision in package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Blendshape scores: eyes count as open below this and as closed above BLINK_CLOSED. */
const EYES_OPEN = 0.25;
const BLINK_CLOSED = 0.55;

interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "Camera permission was denied. Allow camera access for this site and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  return (e as Error)?.message || "The camera could not be started.";
}

async function createLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  let files;
  try {
    files = await FilesetResolver.forVisionTasks(WASM_URL);
  } catch {
    throw new Error("Face detection could not be loaded. Check the internet connection and try again.");
  }
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO" as const,
    numFaces: 2, // two is enough to tell "exactly one" from "more than one"
    outputFaceBlendshapes: true,
  });
  try {
    return await FaceLandmarker.createFromOptions(files, options("GPU"));
  } catch {
    return FaceLandmarker.createFromOptions(files, options("CPU")); // no WebGL: slower, still fine
  }
}

export function CameraCheckIn({
  maxAccuracyMeters,
  radiusMeters,
  onClose,
  onDone,
}: {
  maxAccuracyMeters: number;
  radiusMeters: number;
  onClose: () => void;
  onDone: (distanceMeters: number | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // The detection loop runs every frame; it writes here and copies to state a few times a second.
  const live = useRef({ faces: 0, sawOpen: false, blinked: false });
  const [phase, setPhase] = useState<"starting" | "live" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState(0);
  const [blinked, setBlinked] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let watchId: number | null = null;
    let raf = 0;
    let landmarker: FaceLandmarker | null = null;

    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
          setGeoError(null);
        },
        (err) =>
          setGeoError(
            err.code === err.PERMISSION_DENIED ? "Location permission was denied. Allow location for this site and try again." : "Your location is not available yet.",
          ),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    } else {
      queueMicrotask(() => setGeoError("This browser cannot share its location."));
    }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera (it needs HTTPS).");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        const video = videoRef.current;
        if (cancelled || !video) return;
        video.srcObject = stream;
        await video.play();
        landmarker = await createLandmarker();
        if (cancelled) return;
        setPhase("live");

        let lastFrame = -1;
        let lastUi = 0;
        const tick = () => {
          if (cancelled || !landmarker) return;
          if (video.readyState >= 2 && video.currentTime !== lastFrame) {
            lastFrame = video.currentTime;
            const now = performance.now();
            const res = landmarker.detectForVideo(video, now);
            const n = res.faceLandmarks.length;
            const state = live.current;
            state.faces = n;
            if (n === 1) {
              const cats = res.faceBlendshapes[0]?.categories ?? [];
              const score = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
              const closed = Math.min(score("eyeBlinkLeft"), score("eyeBlinkRight"));
              // A blink is eyes seen open, then both eyes closed: a printed photo cannot do that.
              if (closed < EYES_OPEN) state.sawOpen = true;
              else if (closed > BLINK_CLOSED && state.sawOpen) state.blinked = true;
            }
            if (now - lastUi > 150) {
              lastUi = now;
              setFaces(n);
              setBlinked(state.blinked);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        if (!cancelled) {
          setPhase("error");
          setError(cameraError(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      landmarker?.close();
    };
  }, []);

  const accuracyOk = !!fix && fix.accuracy <= maxAccuracyMeters;
  const ready = phase === "live" && faces === 1 && blinked && accuracyOk;

  async function submit() {
    if (!fix) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await api<{ record: { distanceMeters: number | null } }>("/api/attendance/check-in", {
        method: "POST",
        body: { method: "camera", lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, faces: live.current.faces, liveness: live.current.blinked },
      });
      onDone(r.record.distanceMeters);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Camera check-in"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ready}>
            {!busy && <OpsIcon name="camera" className="h-4 w-4" />}
            Check in
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-zinc-900">
          {/* Mirrored like a selfie camera. Frames are analysed here and never uploaded. */}
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Live camera preview" />
          {phase === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-zinc-200">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              Starting the camera and face detection…
            </div>
          )}
          {phase === "live" && (
            <div
              className={cx(
                "pointer-events-none absolute inset-6 rounded-[40%] border-2 transition-colors",
                faces === 1 ? (blinked ? "border-teal-400" : "border-amber-300") : "border-white/40",
              )}
              aria-hidden
            />
          )}
        </div>

        {phase === "error" && error && <Notice tone="error">{error}</Notice>}

        <ul className="space-y-2" aria-live="polite">
          <Check
            icon="eye"
            ok={phase === "live" && faces === 1}
            label={phase !== "live" ? "Face" : faces === 0 ? "No face found: look at the camera" : faces > 1 ? "More than one face: only you should be in the frame" : "One face found"}
          />
          <Check icon="check" ok={blinked} label={blinked ? "Blink detected" : "Blink once to show it's really you"} />
          <Check
            icon="pin"
            ok={accuracyOk}
            label={
              geoError ??
              (!fix
                ? "Finding your location…"
                : accuracyOk
                  ? `Location found (±${Math.round(fix.accuracy)} m)`
                  : `Location too imprecise (±${Math.round(fix.accuracy)} m, needs ${maxAccuracyMeters} m or better). Try near a window.`)
            }
          />
        </ul>

        {submitError && <Notice tone="error">{submitError}</Notice>}

        <p className="text-xs leading-relaxed text-zinc-500">
          The picture stays on this device. Only the face count, the blink result and your location are sent. The server checks that you are within{" "}
          {radiusMeters} m of the office and stores the distance, not a photo. If it fails, ask HR for an attendance correction.
        </p>
      </div>
    </Modal>
  );
}

function Check({ ok, label, icon }: { ok: boolean; label: ReactNode; icon: OpsIconName }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={cx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800",
        )}
      >
        <OpsIcon name={ok ? "check" : icon} className="h-3.5 w-3.5" />
      </span>
      <span className={ok ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}>{label}</span>
    </li>
  );
}
