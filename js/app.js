import { AudioEngine } from "./audio-engine.js";
import { AudioRecorder } from "./recorder.js";
import { SpeechTools } from "./speech.js";

const $ = selector => document.querySelector(selector);

const ui = {
  systemDot: $("#systemDot"),
  systemStatus: $("#systemStatus"),
  fatalError: $("#fatalError"),
  notice: $("#notice"),
  deviceSelect: $("#deviceSelect"),
  sampleRate: $("#sampleRate"),
  startMic: $("#startMic"),
  stopMic: $("#stopMic"),
  refreshDevices: $("#refreshDevices"),
  micBadge: $("#micBadge"),
  levelValue: $("#levelValue"),
  levelBar: $("#levelBar"),
  actualRate: $("#actualRate"),
  channels: $("#channels"),
  contextState: $("#contextState"),
  waveState: $("#waveState"),
  fftState: $("#fftState"),
  startRecord: $("#startRecord"),
  stopRecord: $("#stopRecord"),
  downloadRecord: $("#downloadRecord"),
  recordBadge: $("#recordBadge"),
  recordDuration: $("#recordDuration"),
  recordSize: $("#recordSize"),
  recordFormat: $("#recordFormat"),
  playback: $("#playback"),
  recognitionBadge: $("#recognitionBadge"),
  startRecognition: $("#startRecognition"),
  stopRecognition: $("#stopRecognition"),
  clearTranscript: $("#clearTranscript"),
  copyTranscript: $("#copyTranscript"),
  speechLanguage: $("#speechLanguage"),
  transcript: $("#transcript"),
  recognitionMessage: $("#recognitionMessage"),
  synthesisBadge: $("#synthesisBadge"),
  speakText: $("#speakText"),
  voiceSelect: $("#voiceSelect"),
  speechRate: $("#speechRate"),
  speechPitch: $("#speechPitch"),
  rateOutput: $("#rateOutput"),
  pitchOutput: $("#pitchOutput"),
  speakButton: $("#speakButton"),
  cancelSpeech: $("#cancelSpeech"),
  synthesisMessage: $("#synthesisMessage"),
  runDiagnostics: $("#runDiagnostics"),
  diagnostics: $("#diagnostics"),
  eventLog: $("#eventLog"),
  exportLog: $("#exportLog"),
  clearLog: $("#clearLog")
};

const logEntries = [];
let noticeTimer = 0;
let transcriptFinal = "";
let recognitionRunning = false;

function log(message, type = "info") {
  const timestamp = new Date();
  const entry = {
    time: timestamp.toISOString(),
    message: String(message),
    type
  };
  logEntries.push(entry);
  if (logEntries.length > 250) logEntries.shift();

  const item = document.createElement("li");
  const time = document.createElement("time");
  const text = document.createElement("span");

  time.textContent = timestamp.toLocaleTimeString();
  text.textContent = entry.message;
  item.append(time, text);
  item.dataset.type = type;
  ui.eventLog.prepend(item);

  while (ui.eventLog.children.length > 100) {
    ui.eventLog.lastElementChild.remove();
  }

  console[type === "error" ? "error" : "log"]("[Audio Lab]", entry.message);
}

function showNotice(message, isError = false) {
  clearTimeout(noticeTimer);
  ui.notice.textContent = message;
  ui.notice.classList.toggle("error", isError);
  ui.notice.classList.remove("hidden");
  noticeTimer = window.setTimeout(() => ui.notice.classList.add("hidden"), 6500);
}

function reportError(error, prefix = "") {
  const message = `${prefix}${error?.message || String(error)}`;
  log(message, "error");
  showNotice(message, true);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const remainder = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setSystemStatus(message, state = "") {
  ui.systemStatus.textContent = message;
  ui.systemDot.classList.toggle("good", state === "good");
  ui.systemDot.classList.toggle("bad", state === "bad");
}

function renderDevices(devices) {
  const previous = ui.deviceSelect.value;
  ui.deviceSelect.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default microphone";
  ui.deviceSelect.append(defaultOption);

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    ui.deviceSelect.append(option);
  });

  if ([...ui.deviceSelect.options].some(option => option.value === previous)) {
    ui.deviceSelect.value = previous;
  }

  log(`Found ${devices.length} audio input device(s).`);
}

const engine = new AudioEngine({
  onLevel: ({ db, rms }) => {
    ui.levelValue.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : "−∞ dBFS";
    ui.levelBar.style.width = `${Math.min(100, Math.max(0, rms * 300))}%`;
  },
  onState: state => {
    const running = state.running;
    ui.startMic.disabled = running;
    ui.stopMic.disabled = !running;
    ui.startRecord.disabled = !running || !window.MediaRecorder;
    ui.micBadge.textContent = running ? "Microphone active" : "Microphone stopped";
    ui.waveState.textContent = running ? "Receiving audio" : "Waiting for input";
    ui.fftState.textContent = running ? "Analyzing spectrum" : "Waiting for input";
    ui.contextState.textContent = state.contextState || "Not started";
    ui.actualRate.textContent = state.sampleRate ? `${state.sampleRate.toLocaleString()} Hz` : "—";
    ui.channels.textContent = state.channels ?? "—";
    setSystemStatus(running ? "Audio active" : "Ready", running ? "good" : "");

    if (running) {
      ui.startMic.textContent = "Microphone running";
      log(`Audio started at ${state.sampleRate} Hz.`);
    } else {
      ui.startMic.textContent = "Start microphone";
      log("Microphone stopped.");
    }
  },
  onError: error => reportError(error, "Audio: "),
  onDevices: renderDevices
});

const recorder = new AudioRecorder({
  onState: state => {
    ui.recordDuration.textContent = formatDuration(state.duration);
    ui.recordSize.textContent = formatBytes(state.size);
    ui.recordFormat.textContent = state.mimeType || "Not selected";
    ui.recordBadge.textContent = state.recording ? "Recording…" : state.ready ? "Recording ready" : "Idle";
    ui.startRecord.disabled = state.recording || !engine.stream || !window.MediaRecorder;
    ui.stopRecord.disabled = !state.recording;
    ui.downloadRecord.disabled = !state.ready;

    if (!state.recording && state.ready) {
      ui.playback.src = state.url;
      ui.playback.load();
      log(`Recording completed (${formatBytes(state.size)}, ${state.mimeType}).`);
    }
  },
  onError: error => reportError(error, "Recorder: ")
});

const speech = new SpeechTools({ onLog: log });

async function refreshDevices() {
  try {
    await engine.enumerateDevices();
  } catch (error) {
    reportError(error, "Device list: ");
  }
}

ui.startMic.addEventListener("click", async () => {
  ui.startMic.disabled = true;
  ui.startMic.textContent = "Requesting access…";
  try {
    await engine.start({
      deviceId: ui.deviceSelect.value,
      sampleRate: ui.sampleRate.value
    });
    showNotice("Microphone started. Speak or make a sound to test the visualizers.");
  } catch (error) {
    reportError(error, "Could not start microphone: ");
    ui.startMic.disabled = false;
    ui.startMic.textContent = "Start microphone";
  }
});

ui.stopMic.addEventListener("click", async () => {
  if (recorder.isRecording) {
    try { recorder.stop(); }
    catch (error) { reportError(error, "Could not stop recording: "); }
  }
  await engine.stop();
});

ui.refreshDevices.addEventListener("click", refreshDevices);

ui.deviceSelect.addEventListener("change", async () => {
  if (!engine.running) return;

  try {
    await engine.stop();
    await engine.start({
      deviceId: ui.deviceSelect.value,
      sampleRate: ui.sampleRate.value
    });
  } catch (error) {
    reportError(error, "Could not switch microphone: ");
  }
});

ui.sampleRate.addEventListener("change", async () => {
  if (!engine.running) return;

  try {
    await engine.stop();
    await engine.start({
      deviceId: ui.deviceSelect.value,
      sampleRate: ui.sampleRate.value
    });
  } catch (error) {
    reportError(error, "Could not restart audio: ");
  }
});

ui.startRecord.addEventListener("click", () => {
  try {
    recorder.start(engine.stream);
    log("Recording started.");
  } catch (error) {
    reportError(error, "Could not start recording: ");
  }
});

ui.stopRecord.addEventListener("click", () => {
  try {
    recorder.stop();
    log("Recording stop requested.");
  } catch (error) {
    reportError(error, "Could not stop recording: ");
  }
});

ui.downloadRecord.addEventListener("click", () => {
  try {
    recorder.download();
    log("Recording download requested.");
  } catch (error) {
    reportError(error, "Could not download recording: ");
  }
});

function updateTranscript({ interim, finalText }) {
  if (finalText) {
    transcriptFinal += `${transcriptFinal && !transcriptFinal.endsWith(" ") ? " " : ""}${finalText.trim()}`;
  }

  ui.transcript.value = `${transcriptFinal}${interim ? `${transcriptFinal ? " " : ""}${interim}` : ""}`;
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

ui.startRecognition.addEventListener("click", () => {
  try {
    speech.startRecognition({
      language: ui.speechLanguage.value,
      onResult: updateTranscript,
      onState: state => {
        recognitionRunning = state.running;
        ui.recognitionBadge.textContent = state.running ? "Listening" : "Stopped";
        ui.startRecognition.disabled = state.running;
        ui.stopRecognition.disabled = !state.running;
        ui.recognitionMessage.textContent = state.message;
      },
      onError: error => {
        ui.recognitionMessage.textContent = error.message;
        reportError(error, "Speech recognition: ");
      }
    });
    ui.recognitionMessage.textContent = "Starting speech recognition…";
  } catch (error) {
    reportError(error, "Speech recognition: ");
    ui.recognitionMessage.textContent = error.message;
  }
});

ui.stopRecognition.addEventListener("click", () => {
  speech.stopRecognition();
  recognitionRunning = false;
  ui.recognitionBadge.textContent = "Stopped";
  ui.startRecognition.disabled = false;
  ui.stopRecognition.disabled = true;
  ui.recognitionMessage.textContent = "Recognition stopped.";
});

ui.clearTranscript.addEventListener("click", () => {
  transcriptFinal = "";
  ui.transcript.value = "";
  log("Transcript cleared.");
});

ui.transcript.addEventListener("input", () => {
  transcriptFinal = ui.transcript.value;
});

ui.copyTranscript.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.transcript.value);
    showNotice("Transcript copied.");
  } catch {
    ui.transcript.focus();
    ui.transcript.select();
    try {
      const copied = document.execCommand("copy");
      if (!copied) throw new Error("Copy command was not accepted.");
      showNotice("Transcript copied.");
    } catch (error) {
      reportError(error, "Copy failed: ");
    }
  }
});

function renderVoices(voices) {
  const previous = ui.voiceSelect.value;
  ui.voiceSelect.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Browser default voice";
  ui.voiceSelect.append(defaultOption);

  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})${voice.default ? " — default" : ""}`;
    ui.voiceSelect.append(option);
  }

  if ([...ui.voiceSelect.options].some(option => option.value === previous)) {
    ui.voiceSelect.value = previous;
  }
}

speech.loadVoices(renderVoices);

ui.speechRate.addEventListener("input", () => {
  ui.rateOutput.value = Number(ui.speechRate.value).toFixed(1);
});
ui.speechPitch.addEventListener("input", () => {
  ui.pitchOutput.value = Number(ui.speechPitch.value).toFixed(1);
});

ui.speakButton.addEventListener("click", () => {
  try {
    speech.speak({
      text: ui.speakText.value,
      voiceURI: ui.voiceSelect.value,
      rate: ui.speechRate.value,
      pitch: ui.speechPitch.value,
      onState: message => { ui.synthesisMessage.textContent = message; },
      onError: error => reportError(error, "Text to speech: ")
    });
  } catch (error) {
    reportError(error, "Text to speech: ");
    ui.synthesisMessage.textContent = error.message;
  }
});

ui.cancelSpeech.addEventListener("click", () => {
  speech.cancelSpeech();
  ui.synthesisMessage.textContent = "Speech cancelled.";
});

function diagnosticRow(label, value) {
  const row = document.createElement("div");
  row.className = "diagnostic-row";
  const name = document.createElement("span");
  const result = document.createElement("strong");
  name.textContent = label;
  result.textContent = value;
  row.append(name, result);
  return row;
}

function runDiagnostics() {
  ui.diagnostics.replaceChildren();

  const secure = window.isSecureContext;
  const media = Boolean(navigator.mediaDevices?.getUserMedia);
  const audioContext = Boolean(window.AudioContext || window.webkitAudioContext);
  const recorderAvailable = Boolean(window.MediaRecorder);
  const speechRecognition = speech.recognitionSupported;
  const speechSynthesis = speech.synthesisSupported;
  const moduleSupport = "noModule" in HTMLScriptElement.prototype;
  const checks = [
    ["Secure context", secure ? "Yes" : "No — use HTTPS or localhost"],
    ["Microphone API", media ? "Available" : "Unavailable"],
    ["Web Audio API", audioContext ? "Available" : "Unavailable"],
    ["MediaRecorder", recorderAvailable ? "Available" : "Unavailable"],
    ["Speech recognition", speechRecognition ? "Available" : "Not detected"],
    ["Speech synthesis", speechSynthesis ? "Available" : "Not detected"],
    ["ES module support", moduleSupport ? "Available" : "Not detected"],
    ["Page origin", location.origin],
    ["Browser", navigator.userAgent],
    ["Audio input currently active", engine.running ? "Yes" : "No"]
  ];

  for (const [label, value] of checks) {
    ui.diagnostics.append(diagnosticRow(label, value));
  }

  log("Browser diagnostics completed.");
}

ui.runDiagnostics.addEventListener("click", runDiagnostics);

ui.exportLog.addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    page: location.href,
    userAgent: navigator.userAgent,
    entries: logEntries
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audio-lab-log-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  log("Diagnostic log exported.");
});

ui.clearLog.addEventListener("click", () => {
  logEntries.length = 0;
  ui.eventLog.replaceChildren();
  log("Event log cleared.");
});

window.addEventListener("error", event => {
  reportError(event.error || new Error(event.message || "Unknown JavaScript error"), "Page error: ");
});

window.addEventListener("unhandledrejection", event => {
  reportError(event.reason || new Error("Unknown rejected promise"), "Unhandled async error: ");
});

window.addEventListener("beforeunload", () => {
  if (recognitionRunning) speech.stopRecognition();
  speech.destroy();
  recorder.destroy();
  engine.destroy();
});

async function initialize() {
  setSystemStatus("Checking browser…");
  log("Application module loaded.");

  ui.recognitionBadge.textContent = speech.recognitionSupported ? "Available" : "Not supported";
  ui.synthesisBadge.textContent = speech.synthesisSupported ? "Available" : "Not supported";

  if (!window.MediaRecorder) {
    ui.startRecord.disabled = true;
    log("MediaRecorder is not supported in this browser.");
  }

  runDiagnostics();

  try {
    await refreshDevices();
  } catch (error) {
    reportError(error, "Initialization: ");
  }

  setSystemStatus("Ready", "good");
  log("Initialization complete.");
}

initialize().catch(error => {
  ui.fatalError.textContent = `The application could not initialize: ${error.message || error}`;
  ui.fatalError.classList.remove("hidden");
  setSystemStatus("Initialization failed", "bad");
  reportError(error, "Initialization failed: ");
});
