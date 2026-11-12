/* ═══════════════════════════════════════════════════════════
   VoiceTriage  —  Frontend Application  v3.0 (Direct Voice Studio)
   ═══════════════════════════════════════════════════════════ */
"use strict";

// ── State ─────────────────────────────────────────────────────
const State = {
  mode:            "voice",
  currentResult:   null,
  allCases:        [],
  filteredCases:   [],
  urgencyFilter:   "ALL",
  historyData:     [],

  // Voice recording state
  isRecording:     false,
  voiceSeconds:    0,
  voiceTimerId:    null,
  audioContext:    null,
  mediaStream:     null,
  audioInput:      null,
  scriptProcessor: null,
  analyser:        null,
  recordedPcm:     [],
  recordedWavBlob: null,
  speechRecognizer:null,
  accumulatedSpeech:"",
  animFrameId:     null,
};

// ── Speaking prompts (practice cases) ─────────────────────────
const VOICE_PROMPTS = {
  chest: {
    lang: "hi",
    text: "मुझे पिछले दो घंटे से सीने में बहुत तेज़ दर्द हो रहा है। दर्द बाईं बाँह तक जा रहा है और बहुत पसीना आ रहा है। साँस लेने में भी बहुत तकलीफ़ है।",
  },
  stroke: {
    lang: "en",
    text: "My husband's face has suddenly drooped on one side. He cannot lift his right arm and his speech is completely slurred. This started ten minutes ago.",
  },
  fever: {
    lang: "hi",
    text: "मुझे चार दिनों से बहुत तेज़ बुखार है और पूरे शरीर पर लाल दाने निकल आए हैं। बहुत कमज़ोरी है और जोड़ों में असहनीय दर्द है।",
  },
  cold: {
    lang: "hi",
    text: "मुझे दो दिन से हल्की सर्दी और खाँसी है। हल्का बुखार निन्यानवे डिग्री है और गले में थोड़ी खराश है। कोई गंभीर तकलीफ़ नहीं है।",
  },
};

const TEXT_SAMPLES = {
  emergency: "I have been having severe crushing chest pain for the past two hours. The pain radiates to my left arm and jaw. I am sweating profusely and breathless.",
  stroke:    "My father's face suddenly drooped to the right side. He is unable to raise his right arm and cannot speak coherent words. Started 15 minutes ago.",
  tb:        "I have had a chronic cough for over three weeks with blood-tinged sputum, night sweats, and unexplained weight loss.",
  cold:      "Mild runny nose, sneezing, and slight sore throat for two days without high fever or difficulty breathing.",
  suicide:   "I have severe feelings of hopelessness and took multiple sleeping pills with suicidal intent.",
};

// ── Language map for Web Speech API ───────────────────────────
const SPEECH_LANG_MAP = {
  hi: "hi-IN",
  en: "en-IN",
  mr: "mr-IN",
  ta: "ta-IN",
  te: "te-IN",
  bn: "bn-IN",
  kn: "kn-IN",
  gu: "gu-IN",
  pa: "pa-IN",
};


// ═══════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  loadDemoCases();
  setupTextInput();
  initWaveformCanvas();
});

function setupTextInput() {
  const ta = document.getElementById("txtInput");
  if (!ta) return;
  ta.addEventListener("input", () => {
    document.getElementById("charCount").textContent = ta.value.length;
  });
}


// ═══════════════════════════════════════════════════════════
//  MODE SWITCHING
// ═══════════════════════════════════════════════════════════
function setMode(mode) {
  State.mode = mode;
  ["voice", "text", "demo"].forEach(m => {
    const btn = document.getElementById(`mode${cap(m)}`);
    const content = document.getElementById(`mode${cap(m)}Content`);
    if (btn) btn.classList.toggle("active", m === mode);
    if (content) content.classList.toggle("active", m === mode);
  });
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);


// ═══════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function checkHealth() {
  const pill = document.getElementById("statusPill");
  const dot  = pill ? pill.querySelector(".dot") : null;
  const txt  = document.getElementById("statusText");
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    if (d.status === "ok") {
      if (dot) dot.className = "dot dot-green";
      if (txt) txt.textContent = `Live · ${d.whisper_model}`;
    } else { throw new Error(); }
  } catch {
    if (dot) dot.className = "dot dot-red";
    if (txt) txt.textContent = "Offline";
  }
}


// ═══════════════════════════════════════════════════════════
//  DIRECT VOICE RECORDING & LIVE SPEAKING
// ═══════════════════════════════════════════════════════════

function toggleVoiceRecording() {
  if (State.isRecording) {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

async function startVoiceRecording() {
  try {
    // Request microphone access
    State.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    // Initialize AudioContext
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    State.audioContext = new AudioContextClass({ sampleRate: 16000 });
    State.audioInput = State.audioContext.createMediaStreamSource(State.mediaStream);

    // Setup Analyser for real-time waveform visualizer
    State.analyser = State.audioContext.createAnalyser();
    State.analyser.fftSize = 256;
    State.audioInput.connect(State.analyser);

    // Setup ScriptProcessor to capture raw PCM samples for 16kHz WAV encoding
    State.scriptProcessor = State.audioContext.createScriptProcessor(4096, 1, 1);
    State.recordedPcm = [];

    State.scriptProcessor.onaudioprocess = (e) => {
      if (!State.isRecording) return;
      const inputBuffer = e.inputBuffer.getChannelData(0);
      State.recordedPcm.push(new Float32Array(inputBuffer));
    };

    State.audioInput.connect(State.scriptProcessor);
    State.scriptProcessor.connect(State.audioContext.destination);

    // Setup Speech Recognition (Live captions in Indian regional languages)
    setupLiveSpeechRecognition();

    // Update UI to recording state
    State.isRecording = true;
    State.recordedWavBlob = null;
    State.voiceSeconds = 0;

    const micBtn = document.getElementById("micBtn");
    const voiceStatus = document.getElementById("voiceStatus");
    const triageBtn = document.getElementById("voiceTriageBtn");

    if (micBtn) {
      micBtn.classList.add("recording");
      document.getElementById("micIcon").textContent = "⏹️";
    }
    if (voiceStatus) {
      voiceStatus.classList.add("recording");
      voiceStatus.textContent = "🔴 Listening... Speak patient's symptoms clearly";
    }
    if (triageBtn) {
      triageBtn.disabled = false;
      triageBtn.textContent = "⏹️ Stop & Triage Patient";
    }

    // Start timer
    updateVoiceTimerDisplay();
    State.voiceTimerId = setInterval(() => {
      State.voiceSeconds++;
      updateVoiceTimerDisplay();
      if (State.voiceSeconds >= 60) {
        stopVoiceRecording();
      }
    }, 1000);

    // Start live waveform rendering loop
    drawLiveWaveform();
    toast("Microphone active — start speaking!", "info");

  } catch (err) {
    console.error("Microphone access error:", err);
    toast("Microphone permission denied or not available.", "warn");
    stopVoiceRecording();
  }
}

function stopVoiceRecording() {
  if (!State.isRecording && !State.mediaStream) return;
  State.isRecording = false;

  // Clear timer
  if (State.voiceTimerId) {
    clearInterval(State.voiceTimerId);
    State.voiceTimerId = null;
  }

  // Stop Speech Recognition
  if (State.speechRecognizer) {
    try { State.speechRecognizer.stop(); } catch (e) {}
  }

  // Disconnect audio nodes
  if (State.scriptProcessor) {
    State.scriptProcessor.disconnect();
    State.scriptProcessor = null;
  }
  if (State.audioInput) {
    State.audioInput.disconnect();
    State.audioInput = null;
  }
  if (State.mediaStream) {
    State.mediaStream.getTracks().forEach(t => t.stop());
    State.mediaStream = null;
  }

  // Encode collected PCM chunks into standard 16kHz WAV Blob
  if (State.recordedPcm.length > 0) {
    State.recordedWavBlob = encodePcmToWav(State.recordedPcm, 16000);
  }

  // Cancel waveform animation
  if (State.animFrameId) {
    cancelAnimationFrame(State.animFrameId);
    State.animFrameId = null;
    drawIdleWaveform();
  }

  // Update UI to stopped state
  const micBtn = document.getElementById("micBtn");
  const voiceStatus = document.getElementById("voiceStatus");
  const triageBtn = document.getElementById("voiceTriageBtn");

  if (micBtn) {
    micBtn.classList.remove("recording");
    document.getElementById("micIcon").textContent = "🎙️";
  }
  if (voiceStatus) {
    voiceStatus.classList.remove("recording");
    const words = State.accumulatedSpeech.trim();
    if (words) {
      voiceStatus.textContent = "✅ Voice recorded. Click 'Stop & Triage Patient' below.";
    } else {
      voiceStatus.textContent = "Recording stopped. Click microphone to speak again.";
    }
  }
  if (triageBtn) {
    triageBtn.disabled = !State.accumulatedSpeech.trim() && !State.recordedWavBlob;
    triageBtn.textContent = "⚡ Analyze Spoken Symptoms ▶";
  }
}

function updateVoiceTimerDisplay() {
  const el = document.getElementById("voiceTimer");
  if (!el) return;
  const m = String(Math.floor(State.voiceSeconds / 60)).padStart(2, "0");
  const s = String(State.voiceSeconds % 60).padStart(2, "0");
  el.textContent = `${m}:${s}`;
  el.classList.toggle("recording", State.isRecording);
}


// ═══════════════════════════════════════════════════════════
//  SPEECH RECOGNITION (WEB SPEECH API)
// ═══════════════════════════════════════════════════════════

function setupLiveSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log("Web Speech API not supported in this browser, relying on Whisper STT.");
    return;
  }

  const selectedLang = document.getElementById("voiceLang")?.value || "hi";
  const bcp47 = SPEECH_LANG_MAP[selectedLang] || "hi-IN";

  State.speechRecognizer = new SpeechRecognition();
  State.speechRecognizer.continuous = true;
  State.speechRecognizer.interimResults = true;
  State.speechRecognizer.lang = bcp47;

  State.speechRecognizer.onresult = (event) => {
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        State.accumulatedSpeech += (State.accumulatedSpeech ? " " : "") + transcript;
      } else {
        interimText += transcript;
      }
    }
    renderLiveSpeechText(State.accumulatedSpeech, interimText);
  };

  State.speechRecognizer.onerror = (e) => {
    console.warn("Speech recognition notice:", e.error);
  };

  State.speechRecognizer.onend = () => {
    // If still recording, restart recognition
    if (State.isRecording && State.speechRecognizer) {
      try { State.speechRecognizer.start(); } catch (e) {}
    }
  };

  try {
    State.speechRecognizer.start();
  } catch (e) {
    console.warn("Could not start speech recognition:", e);
  }
}

function onVoiceLangChange() {
  if (State.isRecording) {
    // Restart recognition with new language
    if (State.speechRecognizer) {
      try { State.speechRecognizer.stop(); } catch (e) {}
    }
    setupLiveSpeechRecognition();
  }
}

function renderLiveSpeechText(finalText, interimText) {
  const el = document.getElementById("liveTranscript");
  if (!el) return;

  const full = (finalText + (interimText ? " " + interimText : "")).trim();
  if (!full) {
    el.innerHTML = `<span class="lt-placeholder">Click microphone above and speak your symptoms. Your words will appear here live...</span>`;
    return;
  }

  el.innerHTML = `<strong>${esc(finalText)}</strong> <span style="color:var(--accent);opacity:0.8">${esc(interimText || "")}</span>`;
  el.scrollTop = el.scrollHeight;

  // Enable triage button once words exist
  const triageBtn = document.getElementById("voiceTriageBtn");
  if (triageBtn && full.length > 3) triageBtn.disabled = false;
}

function clearVoiceTranscript() {
  State.accumulatedSpeech = "";
  State.recordedWavBlob = null;
  renderLiveSpeechText("", "");
  const triageBtn = document.getElementById("voiceTriageBtn");
  if (triageBtn && !State.isRecording) triageBtn.disabled = true;
  toast("Voice transcript cleared.", "info");
}

function speakPrompt(key) {
  const p = VOICE_PROMPTS[key];
  if (!p) return;
  const langSel = document.getElementById("voiceLang");
  if (langSel) langSel.value = p.lang;
  State.accumulatedSpeech = p.text;
  renderLiveSpeechText(p.text, "");
  toast("Practice symptoms loaded! Click 'Stop & Triage Patient' or Speak to add more.", "ok");
}


// ═══════════════════════════════════════════════════════════
//  WAVEFORM VISUALIZER (CANVAS)
// ═══════════════════════════════════════════════════════════

function initWaveformCanvas() {
  const canvas = document.getElementById("waveformCanvas");
  if (!canvas) return;
  drawIdleWaveform();
}

function drawIdleWaveform() {
  const canvas = document.getElementById("waveformCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#2e344d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawLiveWaveform() {
  const canvas = document.getElementById("waveformCanvas");
  if (!canvas || !State.analyser) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const bufferLength = State.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (!State.isRecording) return;
    State.animFrameId = requestAnimationFrame(draw);

    State.analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "#121520";
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#38bdf8";
    ctx.beginPath();

    const sliceWidth = (w * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);

      x += sliceWidth;
    }

    ctx.lineTo(w, h / 2);
    ctx.stroke();
  };

  draw();
}


// ═══════════════════════════════════════════════════════════
//  SUBMIT VOICE TRIAGE
// ═══════════════════════════════════════════════════════════

async function submitVoiceTriage() {
  // If still actively recording, stop first
  if (State.isRecording) {
    stopVoiceRecording();
  }

  const spokenText = State.accumulatedSpeech.trim();
  const wavBlob = State.recordedWavBlob;
  const language = document.getElementById("voiceLang")?.value || "hi";

  if (!spokenText && !wavBlob) {
    toast("No voice recorded yet. Click the microphone and speak.", "warn");
    return;
  }

  showLoading("Analysing voice message across clinical layers…");

  const formData = new FormData();
  if (wavBlob) {
    formData.append("file", wavBlob, "voice_recording.wav");
  }
  if (spokenText) {
    formData.append("transcript", spokenText);
  }
  formData.append("language", language);

  try {
    const res = await fetch("/api/triage/voice", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Triage processing failed");
    renderResult(data);
    toast("Voice triage complete!", "ok");
  } catch (err) {
    showErrorState(err.message);
  } finally {
    hideLoading();
  }
}


// ═══════════════════════════════════════════════════════════
//  PCM TO 16kHz WAV ENCODER (PURE JS)
// ═══════════════════════════════════════════════════════════

function encodePcmToWav(chunks, sampleRate) {
  let totalLength = 0;
  for (let c of chunks) totalLength += c.length;

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (let c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  // 16-bit PCM WAV buffer
  const buffer = new ArrayBuffer(44 + merged.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + merged.length * 2, true);
  writeString(view, 8, "WAVE");

  // fmt subchunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);          // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);           // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);           // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);  // SampleRate (16000)
  view.setUint32(28, sampleRate * 2, true); // ByteRate (16000 * 1 * 2)
  view.setUint16(32, 2, true);           // BlockAlign (1 * 2)
  view.setUint16(34, 16, true);          // BitsPerSample (16)

  // data subchunk
  writeString(view, 36, "data");
  view.setUint32(40, merged.length * 2, true);

  // Write PCM float samples into 16-bit integer
  let idx = 44;
  for (let i = 0; i < merged.length; i++) {
    let s = Math.max(-1, Math.min(1, merged[i]));
    view.setInt16(idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    idx += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}


// ═══════════════════════════════════════════════════════════
//  TEXT TRIAGE
// ═══════════════════════════════════════════════════════════

async function runTextTriage() {
  const transcript = document.getElementById("txtInput").value.trim();
  if (!transcript) { toast("Please type a patient description first.", "warn"); return; }
  const language = document.getElementById("txtLang").value;

  showLoading("Analysing patient description…");
  setBtn("txtRunBtn", true, "Running…");

  try {
    const r = await fetch("/api/triage/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, language }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || "Server error");
    renderResult(d);
    toast("Triage complete!", "ok");
  } catch (e) {
    showErrorState(e.message);
  } finally {
    hideLoading();
    setBtn("txtRunBtn", false, "Run Triage ▶");
  }
}

function useSample(type) {
  document.getElementById("txtInput").value = TEXT_SAMPLES[type] || "";
  document.getElementById("charCount").textContent = (TEXT_SAMPLES[type] || "").length;
  setMode("text");
  toast("Sample loaded — click Run Triage ▶", "info");
}


// ═══════════════════════════════════════════════════════════
//  DEMO CASES
// ═══════════════════════════════════════════════════════════

async function loadDemoCases() {
  try {
    const r = await fetch("/api/cases");
    const d = await r.json();
    State.allCases = d.cases || [];
    State.filteredCases = [...State.allCases];
    renderCasesList();
  } catch {
    document.getElementById("casesList").innerHTML =
      `<div class="loading-row">Failed to load cases. Is the server running?</div>`;
  }
}

function renderCasesList() {
  const list = document.getElementById("casesList");
  const q    = (document.getElementById("demoSearch")?.value || "").toLowerCase();
  let cases  = State.filteredCases.filter(c => {
    const matchText = !q || c.case_id.toLowerCase().includes(q) ||
                      c.transcript_preview.toLowerCase().includes(q) ||
                      (c.symptoms||[]).join(",").toLowerCase().includes(q);
    const matchUrg  = State.urgencyFilter === "ALL" || c.urgency === State.urgencyFilter;
    return matchText && matchUrg;
  });

  if (!cases.length) {
    list.innerHTML = `<div class="loading-row">No cases match your filter.</div>`;
    return;
  }

  list.innerHTML = cases.map(c => `
    <div class="case-row" onclick="runDemo('${c.case_id}')">
      <div class="case-dot" style="background:${urgColor(c.urgency)}"></div>
      <div class="case-info">
        <div class="case-id">${esc(c.case_id)} · ${esc(c.language_name)}</div>
        <div class="case-preview">${esc(c.transcript_preview)}</div>
        <div class="case-meta">${esc(c.urgency)} → ${esc(c.specialty)}</div>
      </div>
    </div>
  `).join("");
}

function filterCases(query) { renderCasesList(); }

function filterByUrgency(urg, btn) {
  State.urgencyFilter = urg;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderCasesList();
}

async function runDemo(caseId) {
  showLoading(`Running demo: ${caseId}…`);
  try {
    const r = await fetch(`/api/demo/${caseId || ""}`);
    const d = await r.json();
    if (!d.success) throw new Error(d.error || "Server error");
    renderResult(d);
    toast(`Demo case ${caseId} complete`, "ok");
  } catch (e) {
    showErrorState(e.message);
  } finally {
    hideLoading();
  }
}


// ═══════════════════════════════════════════════════════════
//  RENDER RESULT
// ═══════════════════════════════════════════════════════════

function renderResult(data) {
  State.currentResult = data;

  // Switch from empty → result
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("errorState").classList.add("hidden");
  document.getElementById("resultWrap").classList.remove("hidden");

  const urg = data.urgency_level || "ROUTINE";
  const icon = { EMERGENCY:"🔴", URGENT:"🟡", ROUTINE:"🟢" }[urg] || "🟢";

  // Urgency banner
  const banner = document.getElementById("urgencyBanner");
  banner.className = `urgency-banner ${urg}`;
  set("ubIcon",     icon);
  set("ubUrgency",  urg);
  set("ubSpecialty",data.suggested_specialty || "–");
  set("ubConf",     `${Math.round((data.confidence_score||0)*100)}%`);

  // Pipeline steps — all done
  ["ps1","ps2","ps3","ps4"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = "pstep done";
  });

  // Transcript
  set("transcriptBox", data.transcript || "–");
  set("langBadge",     data.detected_language || "–");
  set("modelBadge",    data.stt_model || "–");

  // Symptoms
  document.getElementById("symptomsBox").innerHTML =
    tagsHtml(data.symptoms || [], "tag-blue") ||
    `<span style="color:var(--muted)">None extracted</span>`;

  // Patient info
  set("durVal", data.duration  || "–");
  set("sevVal", data.severity  || "–");
  set("ageVal", data.age != null ? String(data.age) : "–");
  set("genVal", data.gender    || "–");
  document.getElementById("disVal").innerHTML =
    tagsHtml(data.existing_diseases||[], "tag-gray") ||
    `<span style="color:var(--muted)">None</span>`;

  // Red flags
  const rfs = data.red_flags_triggered || [];
  const rfCard = document.getElementById("rfCard");
  if (rfCard) rfCard.style.borderColor = rfs.length ? "var(--emergency)" : "";
  document.getElementById("rfBox").innerHTML = rfs.length
    ? tagsHtml(rfs.map(r => r.split(" [")[0]), "tag-red")
    : `<span style="color:var(--muted)">None triggered ✓</span>`;

  // Rules
  document.getElementById("rulesBox").innerHTML =
    tagsHtml(data.rule_ids_matched||[], "tag-yellow") ||
    `<span style="color:var(--muted)">–</span>`;

  // Explanation
  set("reasonBox", data.explanation || "–");

  // Performance
  set("perfTotal", fmt(data.total_time_seconds));
  set("perfSTT",   fmt(data.stt_time));
  set("perfLLM",   fmt(data.llm_time));
  set("perfDec",   fmt(data.decision_time));
  set("perfRAG",   String(data.rag_rules_count ?? "–"));
  set("perfCase",  data.case_id || "–");

  // Scroll to top of output card
  document.getElementById("outputCard").scrollIntoView({behavior:"smooth",block:"start"});
}

const fmt = v => v != null ? `${Number(v).toFixed(2)}s` : "–";


// ═══════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════

async function openHistory() {
  document.getElementById("historyOverlay").classList.remove("hidden");
  document.getElementById("historyDrawer").classList.add("open");
  await loadHistory();
}

function closeDrawer(which) {
  document.getElementById(`${which}Overlay`).classList.add("hidden");
  document.getElementById(`${which}Drawer`).classList.remove("open");
}

async function loadHistory(query) {
  const list = document.getElementById("historyList");
  try {
    const r = await fetch("/api/history?limit=40");
    const d = await r.json();
    State.historyData = d.results || [];
    renderHistory(query || "");
  } catch {
    list.innerHTML = `<div class="loading-row">Failed to load history.</div>`;
  }
}

function filterHistory(q) { renderHistory(q); }

function renderHistory(q) {
  const list = document.getElementById("historyList");
  q = (q||"").toLowerCase();
  let items = State.historyData;
  if (q) items = items.filter(r =>
    (r.urgency_level||"").toLowerCase().includes(q) ||
    (r.suggested_specialty||"").toLowerCase().includes(q) ||
    (r.symptoms||[]).join(",").toLowerCase().includes(q)
  );

  if (!items.length) {
    list.innerHTML = `<div class="loading-row">No history yet. Record some voice triages first!</div>`;
    return;
  }
  list.innerHTML = items.map((r,i) => `
    <div class="hist-item" onclick="restoreResult(${i})">
      <div class="hist-row1">
        <span class="hist-urgency" style="color:${urgColor(r.urgency_level)}">${esc(r.urgency_level||"–")}</span>
        <span class="hist-time">${fmtTime(r.timestamp)}</span>
      </div>
      <div class="hist-spec">${esc(r.suggested_specialty||"–")}</div>
      <div class="hist-syms">${esc((r.symptoms||[]).slice(0,4).join(", ")||"–")}</div>
    </div>
  `).join("");
}

function restoreResult(idx) {
  const r = State.historyData[idx];
  if (r) { renderResult(r); closeDrawer("history"); }
}


// ═══════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════

async function openStats() {
  document.getElementById("statsOverlay").classList.remove("hidden");
  document.getElementById("statsDrawer").classList.add("open");
  await loadStats();
}

async function loadStats() {
  const wrap = document.getElementById("statsContent");
  try {
    const r = await fetch("/api/stats");
    const d = await r.json();

    if (!d.total) {
      wrap.innerHTML = `<div class="loading-row">No data yet. Speak some symptoms first.</div>`;
      return;
    }
    const u = d.urgency || {};
    const specs = Object.entries(d.top_specialties||{})
      .map(([k,v])=>`<span class="tag tag-blue">${esc(k)}: ${v}</span>`).join(" ");

    wrap.innerHTML = `
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val c-emergency">${u.EMERGENCY||0}</div><div class="stat-key">Emergency</div></div>
        <div class="stat-box"><div class="stat-val c-urgent">${u.URGENT||0}</div><div class="stat-key">Urgent</div></div>
        <div class="stat-box"><div class="stat-val c-routine">${u.ROUTINE||0}</div><div class="stat-key">Routine</div></div>
      </div>
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val c-accent">${d.total}</div><div class="stat-key">Total Triages</div></div>
        <div class="stat-box"><div class="stat-val c-accent">${Math.round((d.avg_confidence||0)*100)}%</div><div class="stat-key">Avg Confidence</div></div>
      </div>
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.5rem">Top Specialties</div>
        <div class="tags-wrap">${specs||"–"}</div>
      </div>
    `;
  } catch {
    wrap.innerHTML = `<div class="loading-row">Failed to load stats.</div>`;
  }
}


// ═══════════════════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════════════════
function openHelp()  { document.getElementById("helpOverlay").classList.remove("hidden"); }
function closeHelp() { document.getElementById("helpOverlay").classList.add("hidden"); }


// ═══════════════════════════════════════════════════════════
//  COPY / DOWNLOAD RESULT
// ═══════════════════════════════════════════════════════════
function copyResult() {
  if (!State.currentResult) { toast("No result to copy.", "warn"); return; }
  navigator.clipboard.writeText(JSON.stringify(State.currentResult, null, 2))
    .then(() => toast("Result copied to clipboard!", "ok"))
    .catch(() => toast("Copy failed.", "warn"));
}

function downloadResult() {
  if (!State.currentResult) { toast("No result to download.", "warn"); return; }
  const blob = new Blob([JSON.stringify(State.currentResult, null, 2)], {type:"application/json"});
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `triage_${State.currentResult.case_id || "result"}.json`;
  a.click();
  toast("Downloading JSON…", "info");
}


// ═══════════════════════════════════════════════════════════
//  LOADING OVERLAY
// ═══════════════════════════════════════════════════════════
let _stageTimer = null;

function showLoading(title) {
  document.getElementById("loadingOverlay").classList.remove("hidden");
  document.getElementById("loadingTitle").textContent = title || "Running Pipeline…";

  const rows = ["sr1","sr2","sr3","sr4"];
  rows.forEach(id => { 
    const el = document.getElementById(id);
    if (el) el.className = "stage-row"; 
  });

  let step = 0;
  _stageTimer = setInterval(() => {
    if (step > 0) {
      const prev = document.getElementById(rows[step-1]);
      if (prev) prev.className = "stage-row done";
    }
    if (step < rows.length) {
      const curr = document.getElementById(rows[step]);
      if (curr) curr.className = "stage-row active";
      step++;
    } else { clearInterval(_stageTimer); }
  }, 700);
}

function hideLoading() {
  clearInterval(_stageTimer);
  document.getElementById("loadingOverlay").classList.add("hidden");
}


// ═══════════════════════════════════════════════════════════
//  ERROR STATE
// ═══════════════════════════════════════════════════════════
function showErrorState(msg) {
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("resultWrap").classList.add("hidden");
  document.getElementById("errorState").classList.remove("hidden");
  document.getElementById("errMsg").textContent = msg || "An unexpected error occurred.";
}

function hideError() {
  document.getElementById("errorState").classList.add("hidden");
  document.getElementById("emptyState").classList.remove("hidden");
}


// ═══════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════
let _toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById("toast");
  if (!el) return;
  const colors = { ok:"var(--routine)", warn:"var(--urgent)", info:"var(--accent)" };
  el.textContent = msg;
  el.style.borderLeftColor = colors[type] || "var(--accent)";
  el.style.borderLeft = `3px solid ${colors[type]||"var(--accent)"}`;
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}


// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function tagsHtml(arr, cls) {
  if (!arr?.length) return "";
  return arr.map(s => `<span class="tag ${cls}">${esc(s)}</span>`).join(" ");
}

function urgColor(u) {
  return { EMERGENCY:"var(--emergency)", URGENT:"var(--urgent)", ROUTINE:"var(--routine)" }[u]
    || "var(--muted)";
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
  catch { return ts||"–"; }
}

function setBtn(id, disabled, text) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled;
  btn.textContent = text;
}
