import { spawn } from "node:child_process";

// Inspect the actual uploaded media before starting a billable transcription.
// Audio is passed through stdin; it is never written to disk.
export async function getAudioDurationSeconds(audio: Buffer): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_packets",
      "-show_entries", "packet=pts_time,duration_time",
      "-of", "csv=p=0",
      "-i", "pipe:0",
    ], { stdio: ["pipe", "pipe", "ignore"] });
    let pending = "";
    let first = Infinity;
    let last = -Infinity;
    let latestDuration = 0;
    let packets = 0;
    let finished = false;
    const finish = (seconds: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(seconds);
    };
    const timeout = setTimeout(() => {
      probe.kill();
      finish(null);
    }, 10_000);
    probe.on("error", () => finish(null));
    probe.stdout.setEncoding("utf8");
    probe.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const [timestamp, length] = line.trim().split(",");
        const pts = Number(timestamp);
        const duration = Number(length);
        if (!Number.isFinite(pts)) continue;
        packets++;
        first = Math.min(first, pts);
        last = Math.max(last, pts);
        if (Number.isFinite(duration) && duration > 0) latestDuration = duration;
      }
      if (pending.length > 1024) { probe.kill(); finish(null); }
    });
    probe.stdin.on("error", () => { /* malformed input may close the pipe early */ });
    probe.on("close", (code) => {
      if (finished || code !== 0) return finish(null);
      // MediaRecorder WebM often has no container duration. Packet timestamps
      // remain available even when the header cannot provide a duration.
      finish(packets > 0 && last >= first ? last - first + latestDuration : null);
    });
    probe.stdin.end(audio);
  });
}