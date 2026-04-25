/**
 * Rolling chunked recorder.
 *
 *
 * One MediaStream (one permission prompt, stable input
 * device) and spawn a fresh MediaRecorder every `chunkSeconds`. Each
 * blob it produces is a complete, self-contained WebM file. The swap
 * takes single-digit milliseconds.
 *
 * **Chunk end timing has 3 independent fallbacks**, in order of
 * preference, because some deploy contexts (Replit Autoscale HTTPS,
 * embedded iframes, idle/background tabs) throttle main-thread
 * setTimeout/setInterval enough that a 30s wall-clock check can fail
 * to ever fire until the user clicks Stop:
 *
 *   1. **Web Worker timer** (separate thread, not throttled the same way
 *      as the page's main-thread timers — this is the reliable one).
 *   2. **MediaRecorder timeslice `dataavailable`** (media subsystem ticks).
 *   3. **Main-thread setInterval** (works on any healthy tab; backup).
 *
 * Whichever fires first calls `requestEnd()`, which is idempotent.
 *
 * We also measure per-chunk RMS from the *same* mic stream. Whisper
 * often hallucinates on near-silence; skipping sub-threshold chunks
 * avoids bogus transcript lines (and extra API cost).
 */

/** Bumped whenever the chunking logic materially changes. Debugging:
 *  in DevTools console which build is actually running on a deployed URL. */
export const RECORDER_BUILD = "chunked-recorder/2026-04-24-worker-tick";

/**
 * If RMS is at or above this, we send the chunk to Whisper. Float 0–0.3 for speech.
 * Auto-gain (see getUserMedia) is off so silence stays quiet; 0.02+ is typical for actual talk.
 */
export const CHUNK_RMS_MIN_FOR_TRANSCRIBE = 0.02;

export type ChunkLevelMeta = { rms: number };

class ChunkRmsMonitor {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private sumSq = 0;
  private sampleCount = 0;


  constructor() {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
  }

  attachStream(stream: MediaStream): void {
    this.detachSource();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
  }

  private detachSource(): void {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
  }

  async ensureRunning(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  async beginWindow(): Promise<void> {
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.sumSq = 0;
    this.sampleCount = 0;
    const floatBuf = new Float32Array(this.analyser.fftSize);
    this.interval = setInterval(() => {
      this.analyser.getFloatTimeDomainData(floatBuf);
      for (let i = 0; i < floatBuf.length; i++) {
        const x = floatBuf[i];
        this.sumSq += x * x;
        this.sampleCount += 1;
      }
    }, 20);
  }

  /**
   * Root mean square (0 = silence, ~0.02+ quiet speech, -1 = unknown / no samples).
   */
  endWindow(): number {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.ctx.state !== "running") return -1;
    if (this.sampleCount === 0) return -1;
    return Math.sqrt(this.sumSq / this.sampleCount);
  }

  dispose(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.detachSource();
    this.ctx.close().catch(() => {});
  }
}

export interface ChunkedRecorderOptions {
  chunkSeconds: number;
  onChunk: (blob: Blob, startedAt: number, endedAt: number, level: ChunkLevelMeta) => void;
  onError?: (err: Error) => void;
  mimeType?: string;
}

/**
 * Inline Web Worker source. Runs `setInterval` on its OWN thread, which
 * browsers do not throttle the way they throttle background/iframe main-
 * thread timers. The worker just postMessages a tick every 250ms; the
 * main thread checks the chunk-boundary on each tick.
 */
const TIMER_WORKER_SRC = `
let id = null;
self.onmessage = (e) => {
  if (e && e.data === 'start') {
    if (id != null) return;
    id = setInterval(() => self.postMessage('tick'), 250);
  } else if (e && e.data === 'stop') {
    if (id != null) { clearInterval(id); id = null; }
  }
};
`;

function spawnTimerWorker(): Worker | null {
  try {
    const blob = new Blob([TIMER_WORKER_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    // Revoke immediately; the Worker keeps its own reference to the URL.
    URL.revokeObjectURL(url);
    return w;
  } catch (e) {
    console.warn("[recorder] Worker timer unavailable, falling back to main-thread only", e);
    return null;
  }
}

export class ChunkedRecorder {
  private stream: MediaStream | null = null;
  private rms: ChunkRmsMonitor | null = null;
  private recorder: MediaRecorder | null = null;
  /** Backup main-thread timer. Primary chunk-boundary trigger is the Worker tick. */
  private chunkInterval: ReturnType<typeof setInterval> | null = null;
  /** Off-main-thread timer — fires reliably even when the page is throttled. */
  private timerWorker: Worker | null = null;
  /** Bound handler so we can detach on stop. */
  private onWorkerMessage: ((e: MessageEvent) => void) | null = null;
  private running = false;
  private currentStartedAt = 0;
  private currentParts: Blob[] = [];
  private mimeType: string;
  private onVisibility: (() => void) | null = null;

  constructor(private opts: ChunkedRecorderOptions) {
    this.mimeType = opts.mimeType ?? pickMime();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      throw new Error(
        "Microphone API unavailable (browser requires a secure context). Use https://, " +
          "or open the app as http://localhost:<port> from this machine. Plain http:// " +
          "to a hostname or LAN IP (e.g. 192.168.x.x) usually cannot use the mic."
      );
    }
    this.rms = new ChunkRmsMonitor();
    await this.rms.ensureRunning();
    this.stream = await md.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        // AGC can crank up room tone so RMS passes our gate; Whisper then hallucinates on it.
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.rms.attachStream(this.stream);
    await this.rms.ensureRunning();
    this.onVisibility = () => {
      void this.rms?.ensureRunning();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.timerWorker = spawnTimerWorker();
    if (this.timerWorker) {
      this.timerWorker.postMessage("start");
    }
    console.info(
      `[recorder] start build=${RECORDER_BUILD} mime=${this.mimeType} ` +
        `chunkSec=${this.opts.chunkSeconds} worker=${this.timerWorker ? "on" : "off"}`
    );
    this.running = true;
    this.spawn();
  }

  stop(): void {
    this.running = false;
    if (this.onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.onVisibility = null;
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }
    if (this.timerWorker) {
      try {
        this.timerWorker.postMessage("stop");
        this.timerWorker.terminate();
      } catch {}
      this.timerWorker = null;
    }
    this.onWorkerMessage = null;
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {}
    if (this.rms) {
      this.rms.dispose();
      this.rms = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  /**
   * Force-flush the current chunk so transcription can start immediately,
   * then respawn a fresh recorder — used by the manual Refresh button.
   * The underlying MediaStream is kept alive so no new mic permission
   * prompt fires.
   */
  flushAndRestart(): void {
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {}
  }

  isRunning(): boolean {
    return this.running;
  }

  private spawn(): void {
    if (!this.stream) return;
    // beginWindow is async (resumes AudioContext if suspended). Fire-and-forget
    // here — spawn() stays sync, but ctx.resume() resolves as a microtask,
    // which is faster than the first 20ms setInterval tick. So the first RMS
    // sample is always taken with a running AudioContext.
    this.rms?.beginWindow().catch(() => {});
    const rec = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder = rec;
    this.currentParts = [];
    this.currentStartedAt = Date.now();

    const chunkMs = this.opts.chunkSeconds * 1000;
    let stopRequested = false;
    const requestEnd = (source: string) => {
      if (stopRequested) return;
      if (Date.now() - this.currentStartedAt < chunkMs) return;
      stopRequested = true;
      console.info(
        `[recorder] flushing chunk via=${source} elapsedMs=${Date.now() - this.currentStartedAt}`
      );
      if (this.chunkInterval) {
        clearInterval(this.chunkInterval);
        this.chunkInterval = null;
      }
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {}
    };

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.currentParts.push(e.data);
      // Media-thread tick (1s, see rec.start(1000) below). Survives most
      // throttling because it's produced by the browser's media pipeline,
      // not the JS timer queue. Concatenating accumulated fragments yields
      // a valid WebM (first fragment carries the container header).
      requestEnd("mediaTimeslice");
    };
    rec.onstop = () => {
      const endedAt = Date.now();
      const rms = this.rms?.endWindow() ?? -1;
      console.info(
        `[recorder] onstop parts=${this.currentParts.length} ` +
          `durationMs=${endedAt - this.currentStartedAt} rms=${rms.toFixed(4)}`
      );
      if (this.currentParts.length > 0) {
        const blob = new Blob(this.currentParts, { type: this.mimeType });
        try {
          this.opts.onChunk(blob, this.currentStartedAt, endedAt, { rms });
        } catch (err) {
          this.opts.onError?.(err as Error);
        }
      }
      if (this.running) this.spawn();
    };
    rec.onerror = (e) => {
      this.opts.onError?.(new Error(`MediaRecorder error: ${String(e)}`));
    };

    // 1 s timeslice = steady media-driven `dataavailable` wakeups. We do
    // not transcribe each 1 s slice — we just use them as a clock and
    // accumulate the fragments until the chunk window is full.
    rec.start(1000);

    // Off-main-thread Worker tick — the most reliable signal in throttled
    // HTTPS deploys (Replit Autoscale, embedded iframes, hidden tabs).
    // Workers run on their own thread and are not subject to the same
    // setInterval clamping the page sees.
    if (this.onWorkerMessage && this.timerWorker) {
      this.timerWorker.removeEventListener("message", this.onWorkerMessage);
    }
    this.onWorkerMessage = () => requestEnd("worker");
    if (this.timerWorker) {
      this.timerWorker.addEventListener("message", this.onWorkerMessage);
    }

    // Final fallback: main-thread setInterval. Fires fastest on a healthy,
    // unthrottled foreground tab.
    this.chunkInterval = setInterval(() => requestEnd("mainInterval"), 250);
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}