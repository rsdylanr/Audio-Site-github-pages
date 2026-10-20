export class AudioRecorder {
  constructor({ onState, onError }) {
    this.onState = onState;
    this.onError = onError;
    this.recorder = null;
    this.chunks = [];
    this.blob = null;
    this.startedAt = 0;
    this.timer = 0;
    this.mimeType = "";
    this.url = "";
  }

  static supportedMimeType() {
    if (!window.MediaRecorder) return "";

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4"
    ];

    return candidates.find(type => {
      try { return MediaRecorder.isTypeSupported(type); }
      catch { return false; }
    }) || "";
  }

  get isRecording() {
    return this.recorder?.state === "recording";
  }

  start(stream) {
    if (!stream?.getAudioTracks().some(track => track.readyState === "live")) {
      throw new Error("Start a working microphone before recording.");
    }

    if (!window.MediaRecorder) {
      throw new Error("MediaRecorder is not supported by this browser.");
    }

    if (this.isRecording) return;

    this.releaseUrl();
    this.chunks = [];
    this.blob = null;

    const mimeType = AudioRecorder.supportedMimeType();
    let recorder;

    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (error) {
      throw new Error(`The browser could not create a recorder: ${error.message}`);
    }

    this.recorder = recorder;
    this.mimeType = recorder.mimeType || mimeType || "browser default";
    this.startedAt = performance.now();

    recorder.addEventListener("dataavailable", event => {
      if (event.data?.size) this.chunks.push(event.data);
    });

    recorder.addEventListener("error", event => {
      this.onError(event.error || new Error("An unknown recording error occurred."));
    });

    recorder.addEventListener("stop", () => {
      this.blob = new Blob(this.chunks, {
        type: recorder.mimeType || this.mimeType || "application/octet-stream"
      });
      this.releaseUrl();
      this.url = URL.createObjectURL(this.blob);
      this.stopTimer();
      this.onState({
        recording: false,
        duration: this.durationSeconds(),
        size: this.blob.size,
        mimeType: this.blob.type,
        ready: this.blob.size > 0,
        blob: this.blob,
        url: this.url
      });
    });

    recorder.start(250);
    this.timer = window.setInterval(() => {
      this.onState({
        recording: true,
        duration: this.durationSeconds(),
        size: this.chunks.reduce((sum, chunk) => sum + chunk.size, 0),
        mimeType: this.mimeType,
        ready: false
      });
    }, 250);

    this.onState({
      recording: true,
      duration: 0,
      size: 0,
      mimeType: this.mimeType,
      ready: false
    });
  }

  stop() {
    if (!this.recorder || this.recorder.state === "inactive") return;
    this.recorder.stop();
  }

  durationSeconds() {
    if (!this.startedAt) return 0;
    const end = this.isRecording ? performance.now() : this.stoppedAt || performance.now();
    return Math.max(0, (end - this.startedAt) / 1000);
  }

  stopTimer() {
    this.stoppedAt = performance.now();
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }

  download() {
    if (!this.blob?.size) throw new Error("There is no completed recording to download.");

    const extension = this.blob.type.includes("ogg") ? "ogg"
      : this.blob.type.includes("mp4") ? "m4a"
      : this.blob.type.includes("webm") ? "webm"
      : "audio";

    const anchor = document.createElement("a");
    anchor.href = this.url;
    anchor.download = `audio-lab-${new Date().toISOString().replaceAll(":", "-")}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  releaseUrl() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
  }

  destroy() {
    try {
      if (this.isRecording) this.recorder.stop();
    } catch {}

    this.stopTimer();
    this.releaseUrl();
  }
}
