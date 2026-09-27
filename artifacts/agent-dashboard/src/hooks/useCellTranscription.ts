import { useCallback, useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";

const MAX_RECORDING_MS = 120_000;

export function useCellTranscription(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestingRef = useRef(false);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardRef = useRef("");
  const stopRequestedRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const transcriptCallbackRef = useRef(onTranscript);
  transcriptCallbackRef.current = onTranscript;

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stop = useCallback((reason = "") => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (reason) discardRef.current = reason;
    stopRequestedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (deadlineRef.current) clearTimeout(deadlineRef.current);
    timerRef.current = null;
    deadlineRef.current = null;
    setIsRecording(false);
    try { recorder.stop(); } catch { setError("Recording stopped unexpectedly. Please try again."); }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onHidden = () => {
      if (document.hidden) stop("Recording stopped when your phone locked. Nothing was sent.");
    };
    const onPageHide = () => stop("Recording stopped when your phone locked. Nothing was sent.");
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      if (timerRef.current) clearInterval(timerRef.current);
      if (deadlineRef.current) clearTimeout(deadlineRef.current);
      abortRef.current?.abort();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* recording already stopped */ }
      }
      releaseStream();
    };
  }, [stop]);

  const start = async () => {
    if (requestingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Your browser cannot record audio here. Try an updated Safari or Chrome.");
      return;
    }
    const generation = ++generationRef.current;
    requestingRef.current = true;
    setError("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      requestingRef.current = false;
      if (!mountedRef.current || generationRef.current !== generation) return;
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError");
      setError(denied ? "Allow microphone access in your phone's browser settings, then try again." : "Microphone unavailable. Please try again.");
      return;
    }
    requestingRef.current = false;
    if (!mountedRef.current || generationRef.current !== generation || document.hidden) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    try {
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorderRef.current = recorder;
      discardRef.current = "";
      stopRequestedRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => stop("Recording stopped unexpectedly. Please try again.");
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorder.state === "recording") stop("Recording stopped when your phone locked. Nothing was sent.");
        };
      });
      recorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (deadlineRef.current) clearTimeout(deadlineRef.current);
        timerRef.current = null;
        deadlineRef.current = null;
        releaseStream();
        if (recorderRef.current === recorder) recorderRef.current = null;
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (!stopRequestedRef.current && !discardRef.current) {
          setIsRecording(false);
          setError("Recording stopped unexpectedly. Nothing was sent.");
          return;
        }
        if (discardRef.current) {
          setError(discardRef.current);
          discardRef.current = "";
          return;
        }
        const durationMs = Math.round(performance.now() - startedAtRef.current);
        if (durationMs > MAX_RECORDING_MS + 500) {
          setError("Recording ran past two minutes. Nothing was sent.");
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "" });
        if (durationMs < 100 || blob.size < 128) {
          setError("No audio was recorded. Please try again.");
          return;
        }
        const mime = blob.type.split(";")[0];
        if (!["audio/mp4", "audio/x-m4a", "audio/webm", "audio/ogg", "audio/aac", "audio/mpeg", "audio/wav"].includes(mime)) {
          setError("This phone's recording format is not supported.");
          return;
        }
        setIsTranscribing(true);
        const abort = new AbortController();
        abortRef.current = abort;
        try {
          const response = await fetch("/api/cell/stt", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": mime, "X-Recording-Duration-Ms": String(durationMs) },
            body: blob,
            signal: abort.signal,
          });
          if (!response.ok) {
            if (response.status === 413) throw new Error("Recording is too large. Please try a shorter one.");
            if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
            throw new Error("Transcription failed. Please try again.");
          }
          const result: unknown = await response.json();
          if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") {
            throw new Error("Transcription failed. Please try again.");
          }
          if (!mountedRef.current || generation !== generationRef.current) return;
          void queryClient.invalidateQueries({ queryKey: ["/api/cell/stt/usage"] });
          if ("usageWarning" in result && typeof result.usageWarning === "string" && result.usageWarning) {
            setError(result.usageWarning);
          }
          if (!result.text.trim()) {
            setError("I couldn't hear any words. Please try again.");
            return;
          }
          transcriptCallbackRef.current(result.text.trim());
        } catch (cause) {
          if (mountedRef.current && generation === generationRef.current && !abort.signal.aborted) {
            setError(cause instanceof Error && (
              cause.message.startsWith("Recording is too large")
              || cause.message.startsWith("Your session expired")
            )
              ? cause.message : "Transcription failed. Please try again.");
          }
        } finally {
          if (mountedRef.current && generation === generationRef.current) setIsTranscribing(false);
          if (abortRef.current === abort) abortRef.current = null;
        }
      };
      recorder.start(250);
      startedAtRef.current = performance.now();
      setElapsedSeconds(0);
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        const elapsed = performance.now() - startedAtRef.current;
        setElapsedSeconds(Math.min(120, Math.floor(elapsed / 1000)));
        if (document.hidden) stop("Recording stopped when your phone locked. Nothing was sent.");
        else if (elapsed >= MAX_RECORDING_MS) stop();
      }, 250);
      deadlineRef.current = setTimeout(() => {
        stop(document.hidden ? "Recording stopped when your phone locked. Nothing was sent." : "");
      }, MAX_RECORDING_MS);
    } catch {
      recorderRef.current = null;
      releaseStream();
      setError("Recording could not start. Please try again.");
    }
  };

  const toggle = () => {
    if (isTranscribing) return;
    if (recorderRef.current?.state === "recording") stop();
    else if (!recorderRef.current) void start();
  };

  return { isRecording, isTranscribing, elapsedSeconds, error, setError, toggle };
}