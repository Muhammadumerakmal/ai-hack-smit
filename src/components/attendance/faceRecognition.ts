// Face descriptors for enrolment and matching (Section 5 extra bonus), computed on this device with face-api.js.
// Only the 128 numbers are sent; the server compares them. Loaded on demand (the recognition model is ~6 MB).

const FACE_API_VERSION = "1.7.15"; // keep in step with @vladmandic/face-api in package.json
const MODEL_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/model/`;

type FaceApi = typeof import("@vladmandic/face-api/dist/face-api.esm.js");

let loading: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  loading ??= (async () => {
    const faceapi = await import("@vladmandic/face-api/dist/face-api.esm.js");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    return faceapi;
  })().catch((e) => {
    loading = null; // allow a retry after a network error
    throw e;
  });
  return loading;
}

/** Descriptor of the single face in the frame, or null when there is no face or more than one. */
export async function describeFace(video: HTMLVideoElement): Promise<number[] | null> {
  const faceapi = await loadFaceApi();
  const found = await faceapi
    .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return found.length === 1 ? Array.from(found[0].descriptor) : null;
}

/** Average of a few descriptors taken a moment apart: steadier than a single frame. */
export async function describeFaceSteady(video: HTMLVideoElement, samples = 3, gapMs = 250): Promise<number[] | null> {
  const all: number[][] = [];
  for (let i = 0; i < samples; i++) {
    const d = await describeFace(video);
    if (d) all.push(d);
    if (i < samples - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  if (!all.length) return null;
  return all[0].map((_, k) => all.reduce((n, d) => n + d[k], 0) / all.length);
}
