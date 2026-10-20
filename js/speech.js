export class SpeechTools {
  constructor({ onLog }) {
    this.onLog = onLog;
    this.recognition = null;
    this.recognitionSupported = Boolean(
      window.SpeechRecognition || window.webkitSpeechRecognition
    );
    this.synthesisSupported = Boolean(
      window.speechSynthesis && window.SpeechSynthesisUtterance
    );
    this.voices = [];
    this.voiceChangeHandler = null;
  }
te, onError }) {
    const Recognition = window.SpeechRecognition || window
  startRecognition({ language = "en-US", onResult, onSta.webkitSpeechRecognition;

    if (!Recognition) {
      throw new Error(
        "Speech recognition is not supported here. Try a browser that implements the Web Speech API."
      );
    }

    this.stopRecognition();

    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      onState?.({ running: true, message: "Listening…" });
      this.onLog("Speech recognition started.");
    };

    recognition.onresult = event => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || "";

        if (result.isFinal) finalText += text;
        else interim += text;
      }

      onResult?.({ interim, finalText });
    };

    recognition.onerror = event => {
      const message = this.describeRecognitionError(event.error);
      onError?.(new Error(message));
      this.onLog(`Speech recognition error: ${event.error || "unknown"}`);
    };

    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      onState?.({ running: false, message: "Recognition stopped." });
      this.onLog("Speech recognition ended.");
    };

    try {
      recognition.start();
    } catch (error) {
      if (this.recognition === recognition) this.recognition = null;
      throw error;
    }
  }

  describeRecognitionError(code) {
    const messages = {
      "not-allowed": "Microphone or speech permission was denied. Check browser site permissions.",
      "service-not-allowed": "The browser's speech service is unavailable or blocked.",
      "audio-capture": "No usable audio input was found.",
      "network": "The speech service reported a network error.",
      "no-speech": "No speech was detected.",
      "language-not-supported": "The selected language is not supported by this speech service.",
      "aborted": "Speech recognition was stopped."
    };

    return messages[code] || `Speech recognition failed (${code || "unknown error"}).`;
  }

  stopRecognition() {
    const recognition = this.recognition;
    this.recognition = null;

    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onstart = null;
      recognition.onend = null;

      try { recognition.stop(); }
      catch {
        try { recognition.abort(); } catch {}
      }
    }
  }

  loadVoices(onChange) {
    if (!this.synthesisSupported) return [];

    const refresh = () => {
      this.voices = window.speechSynthesis.getVoices();
      onChange?.(this.voices);
    };

    refresh();

    if (this.voiceChangeHandler) {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        this.voiceChangeHandler
      );
    }

    this.voiceChangeHandler = refresh;
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return this.voices;
  }

  speak({ text, voiceURI = "", rate = 1, pitch = 1, onState, onError }) {
    if (!this.synthesisSupported) {
      throw new Error("Text-to-speech is not supported by this browser.");
    }

    const cleanText = text.trim();
    if (!cleanText) throw new Error("Enter some text before selecting Speak.");

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = Number(rate);
    utterance.pitch = Number(pitch);

    const voice = this.voices.find(item => item.voiceURI === voiceURI);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => onState?.("Speaking…");
    utterance.onend = () => onState?.("Speech finished.");
    utterance.onerror = event => {
      if (event.error !== "canceled" && event.error !== "interrupted") {
        onError?.(new Error(`Speech synthesis error: ${event.error || "unknown"}`));
      }
      onState?.("Speech stopped.");
    };

    window.speechSynthesis.speak(utterance);
  }

  cancelSpeech() {
    if (this.synthesisSupported) window.speechSynthesis.cancel();
  }

  destroy() {
    this.stopRecognition();
    this.cancelSpeech();

    if (this.voiceChangeHandler && this.synthesisSupported) {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        this.voiceChangeHandler
      );
    }
  }
}
