/**
 * cut-static.cjs — shorten the idle stretches of a screen recording without
 * ever producing a visible jump.
 *
 *   node cut-static.cjs IN OUT [KEEP] [CROP] [SS] [T]
 *
 * A stretch is only cut when every frame in it is BYTE-IDENTICAL (ffmpeg's
 * per-frame MD5 of the cropped picture, no scaling, no noise tolerance). The
 * frame at the cut-in and the frame at the cut-out are therefore the same
 * image, so the splice cannot be seen. freezedetect is not good enough here:
 * its -NNdB tolerance lets small things change inside a "freeze" — a 6px
 * progress bar filling, for instance — and cutting across that is a jump.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const [IN, OUT, KEEP = "2", CROP = "crop=1680:927:240:49", SS = "0", T = "0"] = process.argv.slice(2);
if (!IN || !OUT) { console.error("usage: cut-static.cjs IN OUT [KEEP] [CROP] [SS] [T]"); process.exit(1); }
const keep = parseFloat(KEEP);

const trim = ["-ss", SS, ...(T !== "0" ? ["-t", T] : [])];

// 1. exact per-frame hashes of the cropped picture
const md5file = path.join(os.tmpdir(), `frames-${process.pid}.md5`);
execFileSync("ffmpeg", ["-v", "error", "-y", ...trim, "-i", IN, "-vf", CROP, "-an", "-f", "framemd5", md5file]);
const frames = fs.readFileSync(md5file, "utf8").split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.trim().split(/[,\s]+/))
  .map((c) => ({ hash: c[c.length - 1] }));
fs.unlinkSync(md5file);
if (frames.length < 2) { console.error("no frames"); process.exit(1); }

// frame times come from the index and the frame rate: framemd5's pts are in
// its own timebase, and the crop filter rewrites them anyway.
const rate = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=avg_frame_rate", "-of", "json", IN]).toString()).streams[0].avg_frame_rate;
const [rNum, rDen] = rate.split("/").map(Number);
const fps = rDen ? rNum / rDen : 25;
const sec = (i) => i / fps;
const dur = sec(frames.length - 1);
console.log(`${frames.length} frames at ${fps}fps = ${dur.toFixed(2)}s`);

// 2. maximal runs of identical frames
const runs = [];
let start = 0;
for (let i = 1; i <= frames.length; i++) {
  if (i === frames.length || frames[i].hash !== frames[start].hash) {
    runs.push({ from: sec(start), to: sec(i - 1), n: i - start });
    start = i;
  }
}

// 3. every freeze longer than KEEP loses its MIDDLE: half of KEEP stays at
// each end, so a 3s freeze from 5.00 to 8.00 is cut 5.50 -> 7.50 and reads as
// a 1s pause. Both ends of the cut sit inside the identical run, so they are
// the same image and the join cannot be seen.
const half = keep / 2;
const kept = [];
let cursor = 0, cut = 0;
for (const r of runs) {
  const len = r.to - r.from;
  if (len <= keep) continue;
  const cutFrom = r.from + half;
  const cutTo = r.to - half;
  if (cutTo <= cutFrom) continue;
  kept.push([cursor, cutFrom]);
  console.log(`freeze ${r.from.toFixed(2)}s -> ${r.to.toFixed(2)}s (${len.toFixed(2)}s, ${r.n} frames): cutting ${cutFrom.toFixed(2)} -> ${cutTo.toFixed(2)}`);
  cut += cutTo - cutFrom;
  cursor = cutTo;
}
kept.push([cursor, dur + 1]);
console.log(`cut ${cut.toFixed(2)}s of ${dur.toFixed(2)}s -> ${(dur - cut).toFixed(2)}s`);

// 4. re-encode the kept spans
const sel = kept.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
execFileSync("ffmpeg", ["-v", "error", "-y", ...trim, "-i", IN,
  "-vf", `${CROP},select='${sel}',setpts=N/FRAME_RATE/TB,scale=1280:-2`,
  "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: "inherit" });
console.log(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size",
  "-of", "csv=p=0", OUT]).toString().trim());
