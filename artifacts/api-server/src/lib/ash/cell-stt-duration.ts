import { spawn } from "node:child_process";

export type AudioDurationResult =
  | { seconds: number }
  | { error: string };

// Inspect the actual uploaded media before starting a billable transcription.
// Audio is passed through stdin; it is never written to disk.
export async function getAudioDurationSeconds(audio: Buffer): Promise<AudioDurationResult> {
  return new Promise((resolve) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_packets",
      "-show_entries", "packet=pts_time,duration_time",
      "-of", "csv=p=0",
      "-i", "pipe:0",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let pending = "";
    let first = Infinity;
    let last = -Infinity;
    let latestDuration = 0;
    let packets = 0;
    let stderr = "";
    let finished = false;
    const finish = (result: AudioDurationResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      probe.kill();
      finish({ error: "ffprobe timed out after 10 seconds" });
    }, 10_000);
    probe.on("error", (error) => finish({ error: `ffprobe could not start: ${error.message}` }));
    probe.stdout.setEncoding("utf8");
    probe.stderr?.setEncoding("utf8");
    probe.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-1_000);
    });
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
      if (pending.length > 1024) {
        probe.kill();
        finish({ error: "ffprobe produced an oversized packet line" });
      }
    });
    probe.stdin.on("error", () => { /* malformed input may close the pipe early */ });
    probe.on("close", (code) => {
      if (finished) return;
      if (code !== 0) {
        finish({ error: `ffprobe exited with code ${code}: ${stderr.trim() || "no diagnostic output"}` });
        return;
      }
      // MediaRecorder WebM often has no container duration. Packet timestamps
      // remain available even when the header cannot provide a duration.
      finish(packets > 0 && last >= first
        ? { seconds: last - first + latestDuration }
        : { error: "ffprobe found no timestamped audio packets" });
    });
    probe.stdin.end(audio);
  });
}