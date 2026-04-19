'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@klaro/ui/cn';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const KYC_SELFIE_KEY = 'klaro.kyc.selfie';
const MAX_ATTEMPTS = 3;
const COUNTDOWN_SECS = 3;

// Time-based steps wait this long
const TIMED_STEP_MS = 2200;
// Blink step waits up to this long for a real blink
const BLINK_MAX_WAIT_MS = 8000;
// Movement steps wait up to this long, then auto-advance
const MAX_MOVE_WAIT_MS = 12000;
// Recovery between turn steps — wait for face to return to ~straight
const RECENTER_MAX_MS = 2500;
// Show the bouncing-arrow hint after this much idle time
const HINT_DELAY_MS = 1500;
// Capture a frame for the backend at this cadence
const CAPTURE_INTERVAL_MS = 700;

// Yaw thresholds (degrees) — using absolute angles from the FaceLandmarker
// transformation matrix. Convention: positive yaw = user turned to their RIGHT.
const YAW_TURN_THRESHOLD = 15;   // degrees, must reach this absolute value
const YAW_NEUTRAL_THRESHOLD = 8; // re-center step considers <8° "straight"

// Pitch threshold — positive pitch = looking up (chin raised)
// How many degrees ABOVE the user's neutral resting pitch they must raise their
// chin to complete the tilt step. Baseline is sampled from the first 600ms.
const PITCH_DELTA_THRESHOLD = 12;

// Blink — eyeBlink blendshape score is 0..1; >0.5 = eye largely closed
const BLINK_CLOSED_THRESHOLD = 0.5;
const BLINK_OPEN_THRESHOLD = 0.2;

const MP_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
// FaceLandmarker model — gives us 478 landmarks + blendshapes + transform matrix
const MP_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const INSTRUCTIONS = [
  { id: 0, kind: 'straight' as const, text: 'Look straight at the camera' },
  { id: 1, kind: 'turn'     as const, text: 'Turn your head to the right',     hintDir: 'right' as const, expectedSign: +1 as const },
  { id: 2, kind: 'recenter' as const, text: 'Look straight again' },
  { id: 3, kind: 'turn'     as const, text: 'Now turn your head to the left',  hintDir: 'left'  as const, expectedSign: -1 as const },
  { id: 4, kind: 'tilt'     as const, text: 'Raise your head up',              hintDir: 'up'    as const },
  { id: 5, kind: 'blink'    as const, text: 'Blink naturally' },
];

// Steps that should appear in the visible "progress" UI (collapses recenters)
const VISIBLE_STEP_IDS = [0, 1, 3, 4, 5];

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | { name: 'loading_model' }
  | { name: 'permission' }
  | { name: 'permission_denied' }
  | { name: 'countdown'; remaining: number }
  | { name: 'steps'; stepIndex: number; stepProgress: number }
  | { name: 'processing' }
  | { name: 'success' }
  | { name: 'error'; message: string; attempts: number };

interface LivenessResult { passed: boolean; confidence: number }

interface ClientSignals {
  blink_detected: boolean;
  yaw_right_reached: boolean;
  yaw_left_reached: boolean;
  pitch_up_reached: boolean;
  max_yaw_deg: number;
}

// ── Frame capture (mirrored, jpeg) ────────────────────────────────────────────

function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, quality = 0.6): string {
  const ctx = canvas.getContext('2d')!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0); ctx.restore();
  return canvas.toDataURL('image/jpeg', quality).split(',')[1]!;
}

// ── Yaw extraction from facial transformation matrix ─────────────────────────
//
// MediaPipe returns a 4x4 column-major matrix that rotates the canonical
// face mesh into the camera frame. For Y-X-Z Euler decomposition:
//   yaw = atan2(m02, m22)   — rotation around the (vertical) Y axis
//
// The detection runs on the RAW (un-mirrored) video. We negate the result
// so positive yaw = user turned to their RIGHT (matches mirrored display).

function yawFromMatrix(data: Float32Array): number {
  // Column-major: m[r + 4*c]
  const m02 = data[8];   // row 0, col 2
  const m22 = data[10];  // row 2, col 2
  if (m02 === undefined || m22 === undefined) return 0;
  const yawRadRaw = Math.atan2(m02, m22);
  return -(yawRadRaw * 180) / Math.PI; // mirror flip → user's perspective
}

// Pitch (nodding): positive = looking UP (chin raised).
// MediaPipe's camera frame has Y pointing down, so we negate the raw angle
// so that raising your chin gives a positive value and lowering gives negative.
function pitchFromMatrix(data: Float32Array): number {
  const m12 = data[9];   // row 1, col 2
  const m22 = data[10];  // row 2, col 2
  if (m12 === undefined || m22 === undefined) return 0;
  return -(Math.atan2(-m12, m22) * 180) / Math.PI;
}

// ── Accessory detection ───────────────────────────────────────────────────────
//
// Landmark indices (canonical 478-point face mesh, raw / un-mirrored space):
//   33  = left eye outer corner  (right side of camera image)
//   263 = right eye outer corner (left side of camera image)
//   159 = left eye top (lid)
//   386 = right eye top (lid)
//   145 = left eye bottom (lid)
//   374 = right eye bottom (lid)
//   10  = forehead centre (skin tone reference)
//   234 = left face boundary  (right side of image)
//   454 = right face boundary (left side of image)
//   2   = nose bridge (between eyes)

type Pt = { x: number; y: number };

function avgBrightness(data: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
  return sum / (data.length / 4);
}

function detectAccessories(
  video: HTMLVideoElement,
  offscreen: HTMLCanvasElement,
  lm: Pt[],
  // Live blendshape blink scores at REST (from the RAF loop)
  restBlinkL: number,
  restBlinkR: number,
): { glasses: boolean; headphones: boolean } {
  if (lm.length < 468) return { glasses: false, headphones: false };
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return { glasses: false, headphones: false };

  offscreen.width  = W;
  offscreen.height = H;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0);

  const px = (p: Pt) => ({ x: Math.floor(p.x * W), y: Math.floor(p.y * H) });
  const safe = (x: number, y: number, w: number, h: number) =>
    x >= 0 && y >= 0 && x + w <= W && y + h <= H && w > 0 && h > 0;

  // ── Skin / face brightness reference (forehead, lm 10) ───────────────────
  const fore  = px(lm[10]!);
  const sSize = 24;
  const foreData = safe(fore.x - sSize / 2, fore.y, sSize, sSize)
    ? ctx.getImageData(Math.floor(fore.x - sSize / 2), fore.y, sSize, sSize).data
    : null;
  const faceBrightness = foreData ? avgBrightness(foreData) : 128;
  let sR = 128, sG = 100, sB = 90; // fallback skin colour
  if (foreData) {
    for (let i = 0; i < foreData.length; i += 4) { sR += foreData[i]!; sG += foreData[i+1]!; sB += foreData[i+2]!; }
    const n = foreData.length / 4 + 1;
    sR /= n; sG /= n; sB /= n;
  }

  // ── GLASSES — composite score from three independent signals ─────────────

  const lOut = px(lm[33]!);
  const rOut = px(lm[263]!);
  const lTop = px(lm[159]!);
  const rTop = px(lm[386]!);
  const lBot = px(lm[145]!);
  const rBot = px(lm[374]!);
  const faceW = Math.max(1, Math.abs(rOut.x - lOut.x));

  // Signal 1: eye-region darkness ratio vs forehead brightness.
  // Score 0..1 — higher = darker eye region (sunglasses).
  let darkScore = 0;
  const eyeX = Math.min(lOut.x, rOut.x);
  const eyeY = Math.floor((Math.min(lTop.y, rTop.y) + Math.max(lBot.y, rBot.y)) / 2) - Math.floor(faceW * 0.08);
  const eyeW = faceW;
  const eyeH = Math.max(4, Math.floor(faceW * 0.22));
  if (safe(eyeX, eyeY, eyeW, eyeH)) {
    const eyeData = ctx.getImageData(eyeX, eyeY, eyeW, eyeH).data;
    const eyeBrightness = avgBrightness(eyeData);
    if (faceBrightness > 40) {
      const ratio = eyeBrightness / faceBrightness;
      // ratio 0.95+ = clear/no glasses (0), ratio 0.50- = dark glasses (1)
      darkScore = Math.max(0, Math.min(1, (0.85 - ratio) / 0.35));
    }
  }

  // Signal 2: horizontal-edge density in the frame band.
  // Score 0..1 — frame edges concentrate near the top of the eye sockets.
  let edgeScore = 0;
  const frameY = Math.floor((lTop.y + rTop.y) / 2) - Math.floor(faceW * 0.06);
  const frameH = Math.max(6, Math.floor(faceW * 0.16));
  if (safe(eyeX, frameY, eyeW, frameH) && eyeW > 12) {
    const d  = ctx.getImageData(eyeX, frameY, eyeW, frameH).data;
    const rW = eyeW * 4;
    let edges = 0;
    for (let y = 1; y < frameH - 1; y++) {
      for (let x = 0; x < eyeW; x++) {
        const i     = y * rW + x * 4;
        const above = (d[i - rW]! + d[i - rW + 1]! + d[i - rW + 2]!) / 3;
        const curr  = (d[i]!       + d[i + 1]!       + d[i + 2]!)       / 3;
        const below = (d[i + rW]! + d[i + rW + 1]! + d[i + rW + 2]!) / 3;
        if (Math.abs(curr - above) > 25 || Math.abs(curr - below) > 25) edges++;
      }
    }
    const density = edges / (eyeW * (frameH - 2));
    // density 0.05 = bare face (0), density 0.25+ = clear visible frames (1)
    edgeScore = Math.max(0, Math.min(1, (density - 0.07) / 0.18));
  }

  // Signal 3: MediaPipe eye-blink blendshape — dark lenses fool the model.
  // Score 0..1 — typical at-rest is < 0.10; dark glasses push both eyes to 0.6+.
  const blinkAvg = (restBlinkL + restBlinkR) / 2;
  const blinkScore = Math.max(0, Math.min(1, (blinkAvg - 0.20) / 0.30));

  // Composite: weighted sum where the strongest single signal carries the day.
  // Trigger if any signal is very high OR two are moderately high.
  const maxSignal = Math.max(darkScore, edgeScore, blinkScore);
  const sumSignal = darkScore + edgeScore + blinkScore;
  const glasses = maxSignal > 0.65 || sumSignal > 1.05;

  // ── HEADPHONES — non-skin coverage on both sides (color-agnostic) ────────
  // Headphones add a sustained foreign object on both temples. We don't care
  // what colour they are — we only care that the temple region is consistently
  // NOT skin-coloured. This catches white, pink, silver, dark headphones.
  const leftBound  = px(lm[234]!);
  const rightBound = px(lm[454]!);
  const tW = Math.max(14, Math.floor(faceW * 0.16));
  const tH = Math.max(14, Math.floor(faceW * 0.42));

  const templeNonSkinRatio = (bx: number, by: number, side: 'right' | 'left'): number => {
    const offset = Math.floor(faceW * 0.02);
    const sx = side === 'right'
      ? Math.min(W - tW, bx + offset)
      : Math.max(0, bx - tW - offset);
    const sy = Math.max(0, by - Math.floor(tH / 2));
    if (!safe(sx, sy, tW, tH)) return 0;
    const td = ctx.getImageData(sx, sy, tW, tH).data;
    let nonSkin = 0;
    for (let i = 0; i < td.length; i += 4) {
      const r = td[i]!, g = td[i + 1]!, b = td[i + 2]!;
      const diff = (Math.abs(r - sR) + Math.abs(g - sG) + Math.abs(b - sB)) / 3;
      // Pixel is "non-skin" if it differs from the forehead reference by > 30
      if (diff > 30) nonSkin++;
    }
    return nonSkin / (td.length / 4);
  };

  const leftRatio  = templeNonSkinRatio(leftBound.x, leftBound.y, 'right');
  const rightRatio = templeNonSkinRatio(rightBound.x, rightBound.y, 'left');

  // Both temples must have a high non-skin ratio. Threshold 0.55 distinguishes
  // headphones from background showing through hair (which is patchy).
  const headphones = leftRatio > 0.55 && rightRatio > 0.55;

  return { glasses, headphones };
}

function LoadingModelPanel() {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <SpinnerIcon className="h-8 w-8 text-primary" />
      <p className="text-sm text-muted-foreground">Loading face model…</p>
    </div>
  );
}

function PermissionPanel({ onRequest }: { onRequest: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <CameraIcon className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h3 className="text-base font-semibold">Camera access needed</h3>
        <p className="text-sm text-muted-foreground">
          A short liveness check. Your video is never stored — only a few snapshots are
          analysed for anti-spoofing.
        </p>
      </div>
      <Button onClick={onRequest} className="gap-2">
        <CameraIcon className="h-4 w-4" /> Allow camera access
      </Button>
    </div>
  );
}

function PermissionDeniedPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <CameraOffIcon className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h3 className="text-base font-semibold">Camera access denied</h3>
        <p className="text-sm text-muted-foreground">
          Allow camera access in your browser settings, then try again.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}

// ── Circular progress ring ────────────────────────────────────────────────────

function ProgressRing({
  progress, isActive, isDone,
}: { progress: number; isActive: boolean; isDone: boolean }) {
  const r = 47;
  const c = 2 * Math.PI * r;
  const dash = c * Math.max(0, Math.min(1, progress));
  const color = isDone || isActive ? '#22c55e' : '#e2e8f0';
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90 pointer-events-none">
      <circle cx="50" cy="50" r={r} stroke="rgba(148,163,184,0.3)" strokeWidth="2.5" fill="none" />
      <circle
        cx="50" cy="50" r={r}
        stroke={color} strokeWidth="3" fill="none" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        style={{ transition: 'stroke-dasharray 0.15s ease-out, stroke 0.3s' }}
      />
    </svg>
  );
}

// ── Bouncing direction hint ───────────────────────────────────────────────────

function MoveHint({ dir }: { dir: 'left' | 'right' | 'up' }) {
  if (dir === 'up') {
    return (
      <div
        className="absolute left-1/2 -translate-x-1/2 -top-2 sm:-top-6 pointer-events-none z-10"
        style={{ animation: 'bounceU 0.85s ease-in-out infinite' }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg ring-4 ring-blue-100">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
          </svg>
        </div>
      </div>
    );
  }
  const isRight = dir === 'right';
  return (
    <div
      className={cn(
        'absolute top-1/2 -translate-y-1/2 pointer-events-none z-10',
        isRight ? '-right-2 sm:-right-6' : '-left-2 sm:-left-6',
      )}
      style={{ animation: isRight ? 'bounceR 0.85s ease-in-out infinite' : 'bounceL 0.85s ease-in-out infinite' }}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg ring-4 ring-blue-100">
        {isRight ? (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        ) : (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        )}
      </div>
    </div>
  );
}

// ── Step pills below the circle ───────────────────────────────────────────────

function StepPills({ doneIds, activeId }: { doneIds: Set<number>; activeId: number | null }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {VISIBLE_STEP_IDS.map((id) => {
        const done = doneIds.has(id);
        const active = activeId === id;
        return (
          <div
            key={id}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              done ? 'w-6 bg-green-500' : active ? 'w-6 bg-foreground' : 'w-3 bg-muted-foreground/30',
            )}
          />
        );
      })}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
    </svg>
  );
}

function CameraOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75S21.75 6.615 21.75 12 17.385 21.75 12 21.75 2.25 17.385 2.25 12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LivenessStep() {
  const router = useRouter();

  const videoRef     = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef    = React.useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = React.useRef<HTMLCanvasElement | null>(null); // for accessory checks
  const streamRef    = React.useRef<MediaStream | null>(null);
  const landmarkerRef = React.useRef<import('@mediapipe/tasks-vision').FaceLandmarker | null>(null);
  const rafRef       = React.useRef<number>(0);

  // Live measurements updated every frame
  const liveYawRef      = React.useRef<number>(0);
  const livePitchRef    = React.useRef<number>(0);
  const blinkOpenRef    = React.useRef<boolean>(true);
  const faceVisibleRef  = React.useRef<boolean>(false);
  const liveLandmarksRef = React.useRef<Pt[]>([]);
  // Live blink blendshape scores (for glasses detection)
  const liveBlinkLRef   = React.useRef<number>(0);
  const liveBlinkRRef   = React.useRef<number>(0);

  // Aggregated per-session signals
  const signalsRef = React.useRef<ClientSignals>({
    blink_detected: false,
    yaw_right_reached: false,
    yaw_left_reached: false,
    pitch_up_reached: false,
    max_yaw_deg: 0,
  });

  // Timer handles
  const captureRef       = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRunnerRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef     = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const accessoryCheckRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Debounce counters for accessory hints (require 2 consecutive hits to show,
  // 3 consecutive misses to hide)
  const glassesHitsRef      = React.useRef(0);
  const headphonesHitsRef   = React.useRef(0);
  const glassesMissesRef    = React.useRef(0);
  const headphonesMissesRef = React.useRef(0);

  const [phase, setPhase]               = React.useState<Phase>({ name: 'loading_model' });
  const [doneIds, setDoneIds]           = React.useState<Set<number>>(new Set());
  const [showMoveHint, setShowMoveHint] = React.useState(false);
  const [faceVisible, setFaceVisible]   = React.useState(false);
  const [glassesHint, setGlassesHint]   = React.useState(false);
  const [headphonesHint, setHeadphonesHint] = React.useState(false);

  // Live "accessory-free" gate read by step runners — when false the progress
  // ring freezes (no movement counts) until the user removes them.
  const accessoryFreeRef = React.useRef<boolean>(true);

  // Tracks the current step kind so the accessory check can skip detection
  // during turn / tilt / blink steps (head is rotated → temple sampling and
  // eye-region signals become noisy and produce false positives).
  const currentStepKindRef = React.useRef<'straight' | 'recenter' | 'turn' | 'tilt' | 'blink' | null>(null);

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  const clearTimers = React.useCallback(() => {
    if (captureRef.current)        clearInterval(captureRef.current);
    if (stepRunnerRef.current)     clearInterval(stepRunnerRef.current);
    if (countdownRef.current)      clearInterval(countdownRef.current);
    if (accessoryCheckRef.current) clearInterval(accessoryCheckRef.current);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => () => { clearTimers(); stopStream(); }, [clearTimers, stopStream]);

  // ── Load FaceLandmarker once ─────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // MediaPipe's WASM prints "INFO: Created TensorFlow Lite XNNPACK delegate
      // for CPU." to stderr on every cold init. That's benign, but Next.js dev
      // overlay treats stderr as console.error and shows it as a red error.
      // Suppress only that specific message during model load.
      const origError = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        if (msg.includes('XNNPACK') || msg.includes('TensorFlow Lite')) return;
        origError(...args);
      };

      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(MP_WASM_URL);
        const lm = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MP_MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (!cancelled) {
          landmarkerRef.current = lm;
          setPhase({ name: 'permission' });
        }
      } catch (err) {
        origError('FaceLandmarker init failed', err);
        if (!cancelled) setPhase({ name: 'permission' });
      } finally {
        // Always restore console.error after model init completes
        console.error = origError;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Video element ref callback ───────────────────────────────────────────────
  const videoCallbackRef = React.useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  // ── Detection loop — extracts yaw + blink each frame ─────────────────────────
  const startDetectionLoop = React.useCallback(() => {
    let lastTs = -1;
    const loop = () => {
      const video = videoRef.current;
      const lm = landmarkerRef.current;

      if (video && video.readyState >= 2 && lm) {
        const ts = performance.now();
        // FaceLandmarker requires monotonically increasing timestamps
        if (ts > lastTs) {
          lastTs = ts;
          try {
            const result = lm.detectForVideo(video, ts);
            const matrix = result.facialTransformationMatrixes?.[0];
            const blendshapes = result.faceBlendshapes?.[0];

            if (matrix && blendshapes) {
              if (!faceVisibleRef.current) setFaceVisible(true);
              faceVisibleRef.current = true;

              // Store landmarks for accessory detection
              liveLandmarksRef.current = (result.faceLandmarks?.[0] ?? []) as Pt[];

              // Yaw from transformation matrix
              const yaw = yawFromMatrix(matrix.data as unknown as Float32Array);
              liveYawRef.current = yaw;
              const absYaw = Math.abs(yaw);
              if (absYaw > signalsRef.current.max_yaw_deg) {
                signalsRef.current.max_yaw_deg = absYaw;
              }
              if (yaw >= YAW_TURN_THRESHOLD) signalsRef.current.yaw_right_reached = true;
              if (yaw <= -YAW_TURN_THRESHOLD) signalsRef.current.yaw_left_reached = true;

              // Pitch from transformation matrix
              const pitch = pitchFromMatrix(matrix.data as unknown as Float32Array);
              livePitchRef.current = pitch;
              if (pitch >= 8) signalsRef.current.pitch_up_reached = true;

              // Blink detection from blendshapes
              const cats = blendshapes.categories;
              const blL = cats.find((c) => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
              const blR = cats.find((c) => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
              // Keep live scores for accessory detection
              liveBlinkLRef.current = blL;
              liveBlinkRRef.current = blR;
              const avg = (blL + blR) / 2;
              // State machine: open → closed → open = blink
              if (blinkOpenRef.current && avg > BLINK_CLOSED_THRESHOLD) {
                blinkOpenRef.current = false;
              } else if (!blinkOpenRef.current && avg < BLINK_OPEN_THRESHOLD) {
                blinkOpenRef.current = true;
                signalsRef.current.blink_detected = true;
              }
            } else {
              if (faceVisibleRef.current) setFaceVisible(false);
              faceVisibleRef.current = false;
            }
          } catch {
            /* ignore mid-frame errors */
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // ── Submit frames to backend ─────────────────────────────────────────────────
  const submitFrames = React.useCallback(async (all: string[]) => {
    setPhase({ name: 'processing' });
    const frames = all.length >= 3
      ? [all[0]!, all[Math.floor(all.length / 2)]!, all[all.length - 1]!]
      : [...all];

    // Selfie for face-match is ideally captured at the end of the first
    // "Look straight" step (in runStep's finish()). Only write here as a
    // fallback in case that capture didn't fire.
    if (!sessionStorage.getItem(KYC_SELFIE_KEY)) {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        sessionStorage.setItem(KYC_SELFIE_KEY, captureFrame(video, canvas, 0.88));
      } else {
        const selfie = all[all.length - 1] ?? all[0];
        if (selfie) sessionStorage.setItem(KYC_SELFIE_KEY, selfie);
      }
    }

    try {
      const result = await api.post<LivenessResult>('/api/kyc/verify-liveness', {
        frames,
        client_signals: signalsRef.current,
      });
      if (result.passed) {
        stopStream();
        setPhase({ name: 'success' });
        setTimeout(() => router.push('/kyc/result'), 1500);
      } else {
        stopStream();
        setPhase((prev) => ({
          name: 'error',
          message: 'Liveness check failed. Make sure your face is well-lit and clearly visible.',
          attempts: prev.name === 'error' ? prev.attempts + 1 : 1,
        }));
      }
    } catch {
      stopStream();
      setPhase((prev) => ({
        name: 'error',
        message: 'Network error — check your connection and try again.',
        attempts: prev.name === 'error' ? prev.attempts + 1 : 1,
      }));
    }
  }, [stopStream, router]);

  // ── Step runner ──────────────────────────────────────────────────────────────
  const runStep = React.useCallback((index: number, allFrames: string[]) => {
    const inst = INSTRUCTIONS[index];
    if (!inst) { submitFrames(allFrames); return; }

    setShowMoveHint(false);
    setPhase({ name: 'steps', stepIndex: index, stepProgress: 0 });

    // Tell the accessory checker which kind of step we're in so it can decide
    // whether to run detection on this frame.
    currentStepKindRef.current = inst.kind;

    // Frame capture for backend
    if (!captureRef.current) {
      captureRef.current = setInterval(() => {
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas && video.readyState >= 2) {
          allFrames.push(captureFrame(video, canvas));
        }
      }, CAPTURE_INTERVAL_MS);
    }

    const finish = () => {
      if (stepRunnerRef.current) clearInterval(stepRunnerRef.current);
      setShowMoveHint(false);

      // Capture the face-match selfie at the END of the first "Look straight"
      // step — this is the single best moment in the entire flow: the user has
      // been looking directly at the camera, head centred, accessories cleared.
      if (inst.kind === 'straight' && index === 0) {
        const vid = videoRef.current;
        const cvs = canvasRef.current;
        if (vid && cvs && vid.readyState >= 2) {
          const selfie = captureFrame(vid, cvs, 0.92);
          sessionStorage.setItem(KYC_SELFIE_KEY, selfie);
        }
      }

      if (VISIBLE_STEP_IDS.includes(inst.id)) {
        setDoneIds((prev) => {
          const next = new Set(prev);
          next.add(inst.id);
          return next;
        });
      }

      if (index + 1 < INSTRUCTIONS.length) {
        setTimeout(() => runStep(index + 1, allFrames), 300);
      } else {
        if (captureRef.current) { clearInterval(captureRef.current); captureRef.current = null; }
        submitFrames(allFrames);
      }
    };

    const tickMs = 80;
    let elapsed = 0;

    if (inst.kind === 'straight') {
      // Only accumulate time while face is present AND head is roughly centred
      // AND no accessories are detected. If any condition fails, the timer
      // freezes and the user must remove glasses/headphones to continue.
      stepRunnerRef.current = setInterval(() => {
        const faceOk    = faceVisibleRef.current;
        const yawOk     = Math.abs(liveYawRef.current) < YAW_NEUTRAL_THRESHOLD;
        const noAccess  = accessoryFreeRef.current;
        if (faceOk && yawOk && noAccess) elapsed += tickMs;
        const p = Math.min(elapsed / TIMED_STEP_MS, 1);
        setPhase({ name: 'steps', stepIndex: index, stepProgress: p });
        if (elapsed >= TIMED_STEP_MS) finish();
      }, tickMs);
      return;
    }

    if (inst.kind === 'recenter') {
      stepRunnerRef.current = setInterval(() => {
        if (faceVisibleRef.current && accessoryFreeRef.current) elapsed += tickMs;
        const absYaw = Math.abs(liveYawRef.current);
        const p = Math.min(elapsed / RECENTER_MAX_MS, 1);
        setPhase({ name: 'steps', stepIndex: index, stepProgress: p });
        if ((faceVisibleRef.current && accessoryFreeRef.current && absYaw < YAW_NEUTRAL_THRESHOLD) || elapsed >= RECENTER_MAX_MS) finish();
      }, tickMs);
      return;
    }

    if (inst.kind === 'turn') {
      const expectedSign = inst.expectedSign;
      stepRunnerRef.current = setInterval(() => {
        const ready = faceVisibleRef.current;
        if (ready) elapsed += tickMs;

        const yaw = ready ? liveYawRef.current : 0;
        const signedYaw = yaw * expectedSign;
        const progress = Math.max(0, Math.min(1, signedYaw / YAW_TURN_THRESHOLD));

        setPhase({ name: 'steps', stepIndex: index, stepProgress: progress });

        if (elapsed > HINT_DELAY_MS && progress < 0.3) {
          setShowMoveHint(true);
        } else if (progress > 0.5) {
          setShowMoveHint(false);
        }

        if (progress >= 1 || elapsed >= MAX_MOVE_WAIT_MS) finish();
      }, tickMs);
      return;
    }

    if (inst.kind === 'tilt') {
      const BASELINE_SAMPLE_MS = 600;
      const baselineSamples: number[] = [];
      let baselinePitch = 0;
      let baselineLocked = false;

      stepRunnerRef.current = setInterval(() => {
        const ready = faceVisibleRef.current;
        if (ready) elapsed += tickMs;

        const pitch = ready ? livePitchRef.current : baselinePitch;

        if (!baselineLocked) {
          if (ready) baselineSamples.push(pitch);
          if (elapsed >= BASELINE_SAMPLE_MS || baselineSamples.length >= 8) {
            baselinePitch = baselineSamples.length > 0
              ? baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length
              : pitch;
            baselineLocked = true;
          }
        }

        const delta    = pitch - baselinePitch;
        const progress = baselineLocked
          ? Math.max(0, Math.min(1, delta / PITCH_DELTA_THRESHOLD))
          : 0;

        setPhase({ name: 'steps', stepIndex: index, stepProgress: progress });

        if (baselineLocked && elapsed > HINT_DELAY_MS && progress < 0.3) {
          setShowMoveHint(true);
        } else if (progress > 0.5) {
          setShowMoveHint(false);
        }

        if (progress >= 1 || elapsed >= MAX_MOVE_WAIT_MS) finish();
      }, tickMs);
      return;
    }

    if (inst.kind === 'blink') {
      const startBlinks = signalsRef.current.blink_detected ? 1 : 0;
      stepRunnerRef.current = setInterval(() => {
        elapsed += tickMs;
        const detected = signalsRef.current.blink_detected;
        const p = detected
          ? 1
          : Math.min(elapsed / 2000, 0.4);
        setPhase({ name: 'steps', stepIndex: index, stepProgress: p });
        if ((detected && (startBlinks === 1 || elapsed > 700)) || elapsed >= BLINK_MAX_WAIT_MS) {
          finish();
        }
      }, tickMs);
      return;
    }
  }, [submitFrames]);

  // ── Start camera + countdown ─────────────────────────────────────────────────
  const startCamera = React.useCallback(async () => {
    clearTimers();
    setDoneIds(new Set());
    setFaceVisible(false);
    setGlassesHint(false);
    setHeadphonesHint(false);
    accessoryFreeRef.current = true;
    // Clear any selfie from a previous attempt so it's always re-captured fresh
    sessionStorage.removeItem(KYC_SELFIE_KEY);
    signalsRef.current = {
      blink_detected: false,
      yaw_right_reached: false,
      yaw_left_reached: false,
      pitch_up_reached: false,
      max_yaw_deg: 0,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      let remaining = COUNTDOWN_SECS;
      setPhase({ name: 'countdown', remaining });
      startDetectionLoop();

      // Check for glasses / headphones every 1 second.
      // Create a persistent offscreen canvas for pixel sampling.
      if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
      glassesHitsRef.current = 0; headphonesHitsRef.current = 0;
      glassesMissesRef.current = 0; headphonesMissesRef.current = 0;
      accessoryCheckRef.current = setInterval(() => {
        const vid = videoRef.current;
        const os  = offscreenRef.current;
        if (!vid || !os || liveLandmarksRef.current.length < 468) return;

        // Only run pixel-based detection on forward-facing frames. During turn,
        // tilt or blink steps the temple regions and eye geometry are skewed,
        // which produces false positives for both glasses and headphones.
        const kind = currentStepKindRef.current;
        const isForwardFrame = kind === 'straight' || kind === 'recenter';
        if (!isForwardFrame) {
          // Open the gate and clear any stale hints so non-forward steps run
          // freely. Detection resumes the moment we re-enter a straight step.
          accessoryFreeRef.current = true;
          glassesHitsRef.current = 0;
          headphonesHitsRef.current = 0;
          glassesMissesRef.current = 0;
          headphonesMissesRef.current = 0;
          setGlassesHint(false);
          setHeadphonesHint(false);
          return;
        }

        const { glasses, headphones } = detectAccessories(vid, os, liveLandmarksRef.current, liveBlinkLRef.current, liveBlinkRRef.current);

        if (glasses) {
          glassesHitsRef.current++;
          glassesMissesRef.current = 0;
        } else {
          glassesHitsRef.current = 0;
          glassesMissesRef.current++;
        }
        // Hint waits 2 frames (~1s) so a single noisy frame can't flash a banner.
        if (glassesHitsRef.current >= 2)   setGlassesHint(true);
        if (glassesMissesRef.current >= 2) setGlassesHint(false);

        if (headphones) {
          headphonesHitsRef.current++;
          headphonesMissesRef.current = 0;
        } else {
          headphonesHitsRef.current = 0;
          headphonesMissesRef.current++;
        }
        if (headphonesHitsRef.current >= 2)   setHeadphonesHint(true);
        if (headphonesMissesRef.current >= 2) setHeadphonesHint(false);

        // Block gate is INSTANT — the very first detection halts liveness
        // progress so users can never sneak through wearing accessories.
        // The visible banner is the debounced version above; this is the gate.
        accessoryFreeRef.current =
          glassesHitsRef.current === 0 && headphonesHitsRef.current === 0;
      }, 500);

      countdownRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          setPhase({ name: 'countdown', remaining });
        } else {
          clearInterval(countdownRef.current!);
          runStep(0, []);
        }
      }, 1000);
    } catch {
      setPhase({ name: 'permission_denied' });
    }
  }, [clearTimers, startDetectionLoop, runStep]);

  const retry = React.useCallback(() => {
    clearTimers();
    stopStream();
    startCamera();
  }, [clearTimers, stopStream, startCamera]);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (phase.name === 'loading_model')     return <LoadingModelPanel />;
  if (phase.name === 'permission')        return <PermissionPanel onRequest={startCamera} />;
  if (phase.name === 'permission_denied') return <PermissionDeniedPanel onRetry={startCamera} />;

  const showViewfinder = ['countdown', 'steps', 'processing', 'success'].includes(phase.name);
  const attemptsUsed   = phase.name === 'error' ? phase.attempts : 0;
  const retriesLeft    = MAX_ATTEMPTS - attemptsUsed;

  let instructionText = '';
  if (phase.name === 'countdown')      instructionText = 'Get ready';
  else if (phase.name === 'steps')     instructionText = INSTRUCTIONS[phase.stepIndex]?.text ?? '';
  else if (phase.name === 'processing') instructionText = 'Verifying…';
  else if (phase.name === 'success')    instructionText = 'Liveness verified';

  const ringProgress =
    phase.name === 'steps'   ? phase.stepProgress
    : phase.name === 'success' ? 1
    : 0;
  const ringActive = phase.name === 'steps';
  const ringDone   = phase.name === 'success' || (phase.name === 'steps' && phase.stepProgress >= 1);

  const currentInst = phase.name === 'steps' ? INSTRUCTIONS[phase.stepIndex] : null;
  const showHint = phase.name === 'steps' && showMoveHint && currentInst?.kind === 'turn';
  const activePillId = currentInst && VISIBLE_STEP_IDS.includes(currentInst.id) ? currentInst.id : null;

  return (
    <div className="space-y-6 py-2">
      {/* Accessory blocker banner — appears above the circle when worn.
          Progress is FROZEN while this is visible; the user must remove the
          item before the check can complete. */}
      {showViewfinder && (glassesHint || headphonesHint) && (
        <div className="flex flex-col items-center gap-2">
          {glassesHint && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
              </svg>
              Remove your glasses to continue
            </div>
          )}
          {headphonesHint && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
              </svg>
              Remove your headphones to continue
            </div>
          )}
        </div>
      )}

      {showViewfinder && (
        <div className="relative mx-auto" style={{ width: 'min(320px, 80vw)', height: 'min(320px, 80vw)' }}>
          {/* Circular video crop */}
          <div className="absolute inset-2 overflow-hidden rounded-full bg-black ring-1 ring-border">
            <video
              ref={videoCallbackRef}
              autoPlay playsInline muted
              className="h-full w-full object-cover scale-x-[-1]"
            />
          </div>

          {/* Hidden capture canvas */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Animated progress ring */}
          <ProgressRing progress={ringProgress} isActive={ringActive} isDone={ringDone} />

          {/* Direction / tilt hint */}
          {showHint && currentInst && 'hintDir' in currentInst && (
            <MoveHint dir={(currentInst as { hintDir: 'left' | 'right' | 'up' }).hintDir} />
          )}

          {/* Countdown overlay */}
          {phase.name === 'countdown' && (
            <div className="absolute inset-2 flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
              <span
                key={phase.remaining}
                className="text-7xl font-bold text-white tabular-nums"
                style={{ animation: 'pop 0.35s ease-out' }}
              >
                {phase.remaining}
              </span>
            </div>
          )}

          {/* Processing overlay */}
          {phase.name === 'processing' && (
            <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-black/65 backdrop-blur-sm">
              <SpinnerIcon className="h-9 w-9 text-white" />
            </div>
          )}

          {/* Success overlay */}
          {phase.name === 'success' && (
            <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-green-500/15 backdrop-blur-sm">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 ring-4 ring-white">
                <svg className="h-9 w-9 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instruction text */}
      {showViewfinder && (
        <div className="text-center min-h-[3.5rem] space-y-3">
          <p className="text-lg font-semibold text-foreground">{instructionText}</p>
          {phase.name === 'steps' && !faceVisible && (
            <p className="text-xs text-muted-foreground">
              Position your face inside the circle
            </p>
          )}
          {phase.name === 'countdown' && (
            <p className="text-xs text-muted-foreground">
              The check will start automatically
            </p>
          )}
          <StepPills doneIds={doneIds} activeId={activePillId} />
        </div>
      )}

      {/* Error state */}
      {phase.name === 'error' && (
        <div className="space-y-4 py-2 max-w-sm mx-auto">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
            {retriesLeft <= 0
              ? 'Maximum attempts reached. Please try again in better lighting with your face clearly visible.'
              : phase.message}
          </div>
          {retriesLeft > 0 && (
            <Button onClick={retry} variant="outline" className="w-full">
              Try again ({retriesLeft} attempt{retriesLeft !== 1 ? 's' : ''} left)
            </Button>
          )}
          {retriesLeft <= 0 && (
            <p className="text-xs text-center text-muted-foreground">
              Need help?{' '}
              <a href="mailto:support@klaro.tn" className="underline underline-offset-2">Contact support</a>
            </p>
          )}
        </div>
      )}

      <style>{`
        @keyframes pop {
          from { transform: scale(0.6); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @keyframes bounceL {
          0%, 100% { transform: translateX(0)    translateY(-50%); }
          50%       { transform: translateX(-10px) translateY(-50%); }
        }
        @keyframes bounceR {
          0%, 100% { transform: translateX(0)   translateY(-50%); }
          50%       { transform: translateX(10px) translateY(-50%); }
        }
        @keyframes bounceU {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50%       { transform: translateX(-50%) translateY(-10px); }
        }
      `}</style>
    </div>
  );
}
