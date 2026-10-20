export class AudioEngine {
  constructor({ onLevel, onState, onError, onDevices }) {
    this.onLevel = onLevel;
    this.onState = onState;
    this.onError = onError;
    this.onDevices = onDevices;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.frame = 0;
    this.running = false;
    this.waveCanvas = document.querySelector("#waveCanvas");
    this.spectrumCanvas = document.querySelector("#spectrumCanvas");
    this.waveData = null;
    this.frequencyData = null;
    this.lastLevelUpdate = 0;
    this.drawIdle();
  }

  async enumerateDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error("This browser does not expose media device enumeration.");
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(device => device.kind === "audioinput");
    this.onDevices(inputs);
    return inputs;
  }

  async start({ deviceId = "", sampleRate = "default" } = {}) {
    if (this.running) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access is unavailable. Open this page on HTTPS or localhost in a supported browser."
      );
    }

    let newStream;

    try {
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      };

      if (deviceId) audioConstraints.deviceId = { exact: deviceId };

      const constraints = { audio: audioConstraints, video: false };

      if (sampleRate !== "default") {
        audioConstraints.sampleRate = { ideal: Number(sampleRate) };
      }

      newStream = await navigator.mediaDevices.getUserMedia(constraints);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("The Web Audio API is not supported in this browser.");
      }

      const options = {};
      if (sampleRate !== "default") {
        options.sampleRate = Number(sampleRate);
      }

      const newContext = new AudioContextClass(options);
      await newContext.resume();

      const newSource = newContext.createMediaStreamSource(newStream);
      const newAnalyser = newContext.createAnalyser();
      newAnalyser.fftSize = 2048;
      newAnalyser.smoothingTimeConstant = 0.78;
      newSource.connect(newAnalyser);

      this.stream = newStream;
      this.context = newContext;
      this.source = newSource;
      this.analyser = newAnalyser;
      this.waveData = new Uint8Array(newAnalyser.fftSize);
      this.frequencyData = new Uint8Array(newAnalyser.frequencyBinCount);
      this.running = true;

      this.onState({
        running: true,
        contextState: newContext.state,
        sampleRate: newContext.sampleRate,
        channels: newStream.getAudioTracks()[0]?.getSettings().channelCount ?? "Unknown",
        trackSettings: newStream.getAudioTracks()[0]?.getSettings() ?? {}
      });

      this.logTrackEvents(newStream);
      this.draw();
      await this.enumerateDevices();
    } catch (error) {
      if (newStream) newStream.getTracks().forEach(track => track.stop());
      await this.disposeAudioNodes();
      this.onError(error);
      throw error;
    }
  }

  logTrackEvents(stream) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;

    track.addEventListener("ended", () => {
      if (this.stream === stream) {
        this.onError(new Error("The microphone track ended unexpectedly."));
        this.stop().catch(() => {});
      }
    });
  }

  async disposeAudioNodes() {
    try { this.source?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}

    const context = this.context;
    this.source = null;
    this.analyser = null;
    this.context = null;

    if (context && context.state !== "closed") {
      try { await context.close(); } catch {}
    }
  }

  async stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;

    const stream = this.stream;
    this.stream = null;

    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }

    await this.disposeAudioNodes();
    this.onLevel({ db: null, rms: 0 });
    this.onState({ running: false, contextState: "Not started", sampleRate: null, channels: null });
    this.drawIdle();
  }

  draw() {
    if (!this.running || !this.analyser) return;

    this.frame = requestAnimationFrame(() => this.draw());

    this.analyser.getByteTimeDomainData(this.waveData);
    this.analyser.getByteFrequencyData(this.frequencyData);

    this.drawWaveform(this.waveCanvas, this.waveData);
    this.drawSpectrum(this.spectrumCanvas, this.frequencyData);

    const now = performance.now();
    if (now - this.lastLevelUpdate > 80) {
      let sum = 0;
      for (let i = 0; i < this.waveData.length; i++) {
        const value = (this.waveData[i] - 128) / 128;
        sum += value * value;
      }

      const rms = Math.sqrt(sum / this.waveData.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      this.onLevel({ db, rms });
      this.lastLevelUpdate = now;
    }
  }

  prepareCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  drawGrid(ctx, width, height) {
    ctx.fillStyle = "#080d17";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1b2639";
    ctx.lineWidth = 1;

    for (let i = 1; i < 8; i++) {
      const x = (width * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let i = 1; i < 5; i++) {
      const y = (height * i) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  drawWaveform(canvas, data) {
    const surface = this.prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width, height } = surface;

    this.drawGrid(ctx, width, height);
    ctx.strokeStyle = "#73e6d0";
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * width;
      const y = (data[i] / 255) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }

  drawSpectrum(canvas, data) {
    const surface = this.prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width, height } = surface;

    this.drawGrid(ctx, width, height);
    const bars = Math.min(100, Math.floor(width / 4));
    const step = Math.max(1, Math.floor(data.length / bars));
    const gap = 2;
    const barWidth = Math.max(1, width / bars - gap);

    for (let bar = 0; bar < bars; bar++) {
      const index = Math.min(data.length - 1, bar * step);
      const value = data[index] / 255;
      const barHeight = Math.max(2, value * height * 0.92);
      const x = bar * (width / bars);
      const y = height - barHeight;
      const gradient = ctx.createLinearGradient(0, y, 0, height);
      gradient.addColorStop(0, "#9ba7ff");
      gradient.addColorStop(1, "#50d9c5");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  drawIdle() {
    for (const canvas of [this.waveCanvas, this.spectrumCanvas]) {
      const surface = this.prepareCanvas(canvas);
      if (!surface) continue;
      const { ctx, width, height } = surface;
      this.drawGrid(ctx, width, height);
      ctx.fillStyle = "#8290aa";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Start the microphone to visualize audio", width / 2, height / 2);
    }
  }

  async destroy() {
    await this.stop();
  }
}
