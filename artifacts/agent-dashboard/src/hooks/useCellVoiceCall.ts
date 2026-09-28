import { useCallback, useEffect, useRef, useState } from "react";
import type { AshMessage } from "@/lib/types";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

interface VoiceCallOptions {
  active: boolean;
  setActive: (active: boolean) => void;
  messages: AshMessage[];
  voiceId?: string;
  isSpeaking: boolean;
  speak: (text: string, volume: number) => Promise<void>;
  stopSpeaking: () => void;
  sendTranscript: (text: string) => Promise<void>;
}

export function useCellVoiceCall({
  active,
  setActive,
  messages,
  voiceId,
  isSpeaking,
  speak,
  stopSpeaking,
  sendTranscript,
}: VoiceCallOptions) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [volume, setVolumeState] = useState(1);
  const [showVolume, setShowVolume] = useState(false);
  const activeRef = useRef(active);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const messagesRef = useRef(messages);
  const voiceIdRef = useRef(voiceId);
  const volumeRef = useRef(volume);
  const lastReplyIdRef = useRef(0);
  const queueRef = useRef<Array<{ id: number; content: string }>>([]);
  const queueRunningRef = useRef(false);
  const generationRef = useRef(0);
  const stopSpeakingRef = useRef(stopSpeaking);
  const sendTranscriptRef = useRef(sendTranscript);
  const speakRef = useRef(speak);
  const isSpeakingRef = useRef(isSpeaking);

  activeRef.current = active;
  messagesRef.current = messages;
  voiceIdRef.current = voiceId;
  volumeRef.current = volume;
  stopSpeakingRef.current = stopSpeaking;
  sendTranscriptRef.current = sendTranscript;
  speakRef.current = speak;
  isSpeakingRef.current = isSpeaking;

  const setVolume = useCallback((nextVolume: number) => {
    const bounded = Math.max(0, Math.min(1, nextVolume));
    volumeRef.current = bounded;
    setVolumeState(bounded);
  }, []);

  const cancelRecognition = useCallback(() => {
    transcriptRef.current = "";
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      try { recognition.abort(); } catch { /* recognition already stopped */ }
    }
    setListening(false);
  }, []);

  const endCall = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    queueRef.current = [];
    queueRunningRef.current = false;
    cancelRecognition();
    stopSpeakingRef.current();
    setProcessing(false);
    setShowVolume(false);
    setActive(false);
  }, [cancelRecognition, setActive]);

  const startListening = useCallback(() => {
    if (!activeRef.current || isSpeakingRef.current || recognitionRef.current) return;
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setError("Speech recognition is not supported in this browser. End the call to use text chat.");
      return;
    }

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      setError("Could not start speech recognition. Try again or use text chat.");
      return;
    }
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    transcriptRef.current = "";

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const alternative = result?.[0];
        if (!result?.isFinal || !alternative) continue;
        const confidence = alternative.confidence ?? 1;
        if (confidence >= 0.5) finalText += `${alternative.transcript} `;
      }
      if (finalText) {
        transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      if (!activeRef.current) return;
      const transcript = transcriptRef.current.trim();
      transcriptRef.current = "";
      if (transcript.length < 2) {
        setError("I didn’t catch that. Tap the microphone and try again.");
        return;
      }
      setError("");
      setProcessing(true);
      void sendTranscriptRef.current(transcript).catch((cause: unknown) => {
        setProcessing(false);
        setError(cause instanceof Error ? cause.message : "Could not send that voice message.");
      });
    };
    recognition.onerror = (event) => {
      setListening(false);
      recognitionRef.current = null;
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      setError(denied
        ? "Microphone or speech access was denied. Check Chrome’s site permissions."
        : event.error === "no-speech"
          ? "I didn’t hear speech. Tap the microphone and try again."
          : "Speech recognition stopped. Tap the microphone to try again.");
      if (denied) endCall();
    };

    recognitionRef.current = recognition;
    setError("");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError("Speech recognition could not start. Check microphone permission and try again.");
    }
  }, [endCall]);

  const toggleListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try { recognition.stop(); } catch { setError("Could not stop listening. Please try again."); }
      return;
    }
    if (isSpeakingRef.current || processing) return;
    startListening();
  }, [isSpeaking, processing, startListening]);

  const startCall = useCallback(() => {
    if (!voiceIdRef.current) {
      setError("Ash’s voice is not configured. Text chat is still available.");
      return;
    }
    if (!getSpeechRecognitionConstructor()) {
      setError("Speech recognition is not supported in this browser. Text chat is still available.");
      return;
    }
    setError("");
    stopSpeakingRef.current();
    generationRef.current += 1;
    queueRef.current = [];
    queueRunningRef.current = false;
    lastReplyIdRef.current = messagesRef.current.reduce(
      (latest, message) => message.role === "ash" ? Math.max(latest, message.id) : latest,
      0,
    );
    activeRef.current = true;
    setProcessing(false);
    setActive(true);
  }, [setActive]);

  const pumpQueue = useCallback(async () => {
    if (!activeRef.current || queueRunningRef.current) return;
    queueRunningRef.current = true;
    const generation = generationRef.current;
    try {
      while (activeRef.current && generation === generationRef.current && queueRef.current.length > 0) {
        const reply = queueRef.current.shift()!;
        await speakRef.current(reply.content, volumeRef.current);
      }
    } catch {
      if (activeRef.current && generation === generationRef.current) {
        setError("Ash’s reply could not be played. Check your connection and try again.");
      }
    } finally {
      if (generation === generationRef.current) {
        queueRunningRef.current = false;
        if (activeRef.current && queueRef.current.length > 0) void pumpQueue();
        else if (queueRef.current.length === 0) setProcessing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active || messages.length === 0) return;
    const newReplies = messages
      .filter((message) => message.role === "ash" && message.id > lastReplyIdRef.current && message.content.trim())
      .sort((first, second) => first.id - second.id);
    if (newReplies.length === 0) return;

    lastReplyIdRef.current = newReplies[newReplies.length - 1]!.id;
    queueRef.current.push(...newReplies.map((message) => ({ id: message.id, content: message.content })));
    setProcessing(false);
    void pumpQueue();
  }, [active, messages, pumpQueue]);

  useEffect(() => {
    if (!active) return;
    const onVisibilityChange = () => {
      if (document.hidden) endCall();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", endCall);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", endCall);
    };
  }, [active, endCall]);

  useEffect(() => () => {
    activeRef.current = false;
    generationRef.current += 1;
    transcriptRef.current = "";
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.abort(); } catch { /* recognition already stopped */ }
    }
    stopSpeakingRef.current();
  }, []);

  return {
    active,
    listening,
    processing,
    error,
    volume,
    showVolume,
    setError,
    setVolume,
    setShowVolume,
    startCall,
    endCall,
    toggleListening,
  };
}