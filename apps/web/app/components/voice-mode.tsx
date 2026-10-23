"use client";

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { apiRequest } from "@/lib/api";

type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

type VoiceReply = {
  id: string;
  text: string;
};

type VoiceModeProps = {
  open: boolean;
  ready: boolean;
  waiting: boolean;
  reply: VoiceReply | null;
  onClose: () => void;
  onTranscript: (text: string) => Promise<string | null>;
  onError: (message: string) => void;
};

const MAX_RECORDING_MS = 60_000;
const SPEECH_START_LEVEL = 12;
const SILENCE_LEVEL = 7;
const SILENCE_DURATION_MS = 2_000;
const BARGE_IN_LEVEL = 18;
const BARGE_IN_HOLD_MS = 180;

function recordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function recordingExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export function VoiceMode({
  open,
  ready,
  waiting,
  reply,
  onClose,
  onTranscript,
  onError,
}: VoiceModeProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const discardRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const silenceStartedAtRef = useRef<number | null>(null);
  const openRef = useRef(open);
  const stateRef = useRef<VoiceState>(state);
  const spokenReplyRef = useRef<string | null>(null);
  const speechInterruptedRef = useRef(false);
  const recordingStartingRef = useRef(false);
  const bargeInStreamRef = useRef<MediaStream | null>(null);
  const bargeInContextRef = useRef<AudioContext | null>(null);
  const bargeInAnimationRef = useRef<number | null>(null);

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const stopMeter = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setLevel(0);
    setIsUserSpeaking(false);
  }, []);

  const stopBargeInMonitor = useCallback(() => {
    if (bargeInAnimationRef.current !== null) cancelAnimationFrame(bargeInAnimationRef.current);
    bargeInAnimationRef.current = null;
    bargeInStreamRef.current?.getTracks().forEach((track) => track.stop());
    bargeInStreamRef.current = null;
    void bargeInContextRef.current?.close();
    bargeInContextRef.current = null;
  }, []);

  const stopRecording = useCallback((discard = false) => {
    discardRef.current = discard;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    else recorder?.stream.getTracks().forEach((track) => track.stop());
    stopMeter();
    speechDetectedRef.current = false;
    silenceStartedAtRef.current = null;
  }, [stopMeter]);

  const speak = useCallback((text: string) => {
    if (!openRef.current || !text.trim()) return;
    if (!("speechSynthesis" in window)) {
      onError("이 브라우저에서는 음성 답변 재생을 지원하지 않습니다.");
      setState("error");
      return;
    }
    speechInterruptedRef.current = true;
    window.speechSynthesis.cancel();
    speechInterruptedRef.current = false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    const koreanVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith("ko"));
    if (koreanVoice) utterance.voice = koreanVoice;
    utterance.onstart = () => setState("speaking");
    utterance.onend = () => {
      if (openRef.current && !speechInterruptedRef.current) setState("idle");
    };
    utterance.onerror = () => {
      if (!openRef.current || speechInterruptedRef.current) return;
      onError("답변 음성을 재생하지 못했습니다.");
      setState("error");
    };
    window.speechSynthesis.speak(utterance);
  }, [onError]);

  const transcribe = useCallback(async (blob: Blob, mimeType: string) => {
    if (!blob.size || !openRef.current) {
      setState("idle");
      return;
    }
    setState("transcribing");
    const body = new FormData();
    body.append("file", blob, `recording.${recordingExtension(mimeType)}`);
    try {
      const result = await apiRequest<{ text: string }>("/chat/transcriptions", {
        method: "POST",
        body,
      });
      if (!openRef.current) return;
      setState("thinking");
      const answer = await onTranscript(result.text);
      if (openRef.current && answer) speak(answer);
    } catch (error) {
      if (!openRef.current) return;
      onError(error instanceof Error ? error.message : "음성을 처리하지 못했습니다.");
      setState("error");
    }
  }, [onError, onTranscript, speak]);

  const startRecording = useCallback(async () => {
    if (!openRef.current || !ready || waiting || stateRef.current === "listening" || recordingStartingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("이 브라우저에서는 음성 녹음을 지원하지 않습니다.");
      setState("error");
      return;
    }
    recordingStartingRef.current = true;
    speechInterruptedRef.current = true;
    window.speechSynthesis?.cancel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      });
      if (!openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferredMimeType = recordingMimeType();
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        analyser.getByteFrequencyData(samples);
        const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
        setLevel(Math.min(1, average / 72));
        const now = performance.now();
        if (average >= SPEECH_START_LEVEL) {
          speechDetectedRef.current = true;
          silenceStartedAtRef.current = null;
          setIsUserSpeaking(true);
        } else if (speechDetectedRef.current && average <= SILENCE_LEVEL) {
          setIsUserSpeaking(false);
          silenceStartedAtRef.current ??= now;
          if (
            now - silenceStartedAtRef.current >= SILENCE_DURATION_MS
            && recorder.state === "recording"
          ) {
            recorder.stop();
            return;
          }
        } else {
          silenceStartedAtRef.current = null;
          if (!speechDetectedRef.current) setIsUserSpeaking(false);
        }
        animationRef.current = requestAnimationFrame(updateMeter);
      };
      audioContextRef.current = audioContext;
      updateMeter();
      chunksRef.current = [];
      discardRef.current = false;
      speechDetectedRef.current = false;
      silenceStartedAtRef.current = null;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardRef.current = true;
        onError("음성 녹음 중 오류가 발생했습니다.");
        setState("error");
      };
      recorder.onstop = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        stopMeter();
        const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        if (!discardRef.current) void transcribe(blob, mimeType);
      };
      recorder.start();
      stateRef.current = "listening";
      setState("listening");
      onError("");
      timeoutRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (error) {
      const permissionDenied = error instanceof DOMException && error.name === "NotAllowedError";
      onError(
        permissionDenied
          ? "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 사용을 허용해 주세요."
          : "마이크를 시작하지 못했습니다.",
      );
      setState("error");
    } finally {
      recordingStartingRef.current = false;
    }
  }, [onError, ready, stopMeter, stopRecording, transcribe, waiting]);

  useEffect(() => {
    if (!open || state !== "speaking" || !ready) return;
    let cancelled = false;
    let voiceStartedAt: number | null = null;

    void navigator.mediaDevices?.getUserMedia({
      audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
    }).then((stream) => {
      if (cancelled || !openRef.current || stateRef.current !== "speaking") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      bargeInStreamRef.current = stream;
      bargeInContextRef.current = audioContext;

      const detectBargeIn = () => {
        analyser.getByteFrequencyData(samples);
        const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
        const now = performance.now();
        if (average >= BARGE_IN_LEVEL) {
          voiceStartedAt ??= now;
          if (now - voiceStartedAt >= BARGE_IN_HOLD_MS) {
            stopBargeInMonitor();
            speechInterruptedRef.current = true;
            window.speechSynthesis.cancel();
            stateRef.current = "idle";
            setState("idle");
            window.setTimeout(() => void startRecording(), 0);
            return;
          }
        } else {
          voiceStartedAt = null;
        }
        bargeInAnimationRef.current = requestAnimationFrame(detectBargeIn);
      };
      detectBargeIn();
    }).catch(() => {
      // Normal playback remains available if background barge-in monitoring is unavailable.
    });

    return () => {
      cancelled = true;
      stopBargeInMonitor();
    };
  }, [open, ready, startRecording, state, stopBargeInMonitor]);

  useEffect(() => {
    if (!open) return;
    if (!ready || waiting) return;
    if (reply && reply.id !== spokenReplyRef.current) {
      spokenReplyRef.current = reply.id;
      speak(reply.text);
      return;
    }
    if (stateRef.current === "idle") void startRecording();
  }, [open, ready, reply, speak, startRecording, waiting]);

  useEffect(() => {
    if (state !== "idle" || !open || !ready || waiting) return;
    const timer = setTimeout(() => void startRecording(), 350);
    return () => clearTimeout(timer);
  }, [open, ready, startRecording, state, waiting]);

  useEffect(() => () => {
    openRef.current = false;
    stopRecording(true);
    stopBargeInMonitor();
    window.speechSynthesis?.cancel();
  }, [stopBargeInMonitor, stopRecording]);

  function close() {
    stopRecording(true);
    stopBargeInMonitor();
    speechInterruptedRef.current = true;
    window.speechSynthesis?.cancel();
    setState("idle");
    onClose();
  }

  if (!open) return null;

  const displayState = (!ready || waiting) && state === "idle" ? "thinking" : state;
  const style = { "--voice-scale": String(1 + level * 0.16) } as CSSProperties;
  return (
    <div className={`voice-mode voice-mode-${displayState}${isUserSpeaking ? " voice-mode-user-speaking" : ""}`} role="dialog" aria-modal="true" aria-label="음성 대화 모드" style={style}>
      <button className="voice-mode-back" type="button" aria-label="채팅으로 돌아가기" onClick={close}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5 8 12l7 7M8 12h11" /></svg>
      </button>
      <span className="sr-only" aria-live="polite">
        {displayState === "listening" ? "듣는 중" : displayState === "transcribing" ? "전사 중" : displayState === "thinking" ? "답변 생성 중" : displayState === "speaking" ? "답변 재생 중" : "음성 대화 준비"}
      </span>
      <div className="voice-mode-stage">
        <div
          className="voice-mode-mark"
          aria-hidden="true"
        >
          <svg className="voice-mode-star" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M50 5.5 60.8 37h33.1L67.1 56.5l10.2 31.9L50 69 22.7 88.4l10.2-31.9L6.1 37h33.1L50 5.5Z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
