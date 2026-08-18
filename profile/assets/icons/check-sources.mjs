// Each icon here is a copy of a mark owned by another project. This checks the
// copies against their sources so a redrawn mark does not sit stale on the org
// profile indefinitely. It never writes: on a mismatch it reports which file to
// re-copy from where, and exits non-zero.
//
// Icons with no reachable source are declared `unchecked` in sources.json and
// reported as such. A missing entry is an error, so adding an icon without
// deciding how it gets watched fails here rather than passing quietly.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(await readFile(join(HERE, "sources.json"), "utf8"));

async function fetchText(url) {
  // One retry, so a single 5xx on the weekly run does not read as drift.
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

const problems = [];

const icons = (await readdir(HERE)).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)).sort();

for (const name of icons) {
  const spec = sources[name];
  if (spec === undefined) {
    problems.push(`${name}: no entry in sources.json. Add one, or mark it "unchecked" with a reason.`);
    continue;
  }

  if (spec.mode === "unchecked") {
    console.log(`skipped ${name}: ${spec.reason}`);
    continue;
  }

  const local = await readFile(join(HERE, `${name}.svg`), "utf8");

  let upstream;
  try {
    upstream = await fetchText(spec.url);
  } catch (err) {
    // An unreachable source is its own problem: the check stops being able to
    // answer whether the copy is current, which is the only thing it is for.
    problems.push(`${name}: source unreachable, ${spec.url} (${err.message})`);
    continue;
  }

  if (spec.mode === "bytes") {
    if (local !== upstream) {
      problems.push(
        `${name}: ${name}.svg no longer matches ${spec.url}. Re-copy it, check it still reads at 20px on both GitHub themes, then commit.`,
      );
    }
  } else if (spec.mode === "contains") {
    if (!upstream.includes(spec.marker)) {
      problems.push(
        `${name}: ${spec.url} no longer contains the marker this copy was taken from. The mark was probably redrawn, so re-derive ${name}.svg from it.`,
      );
    }
  } else {
    problems.push(`${name}: unknown mode ${JSON.stringify(spec.mode)} in sources.json`);
  }

  console.log(`checked ${name} against ${spec.url}`);
}

for (const name of Object.keys(sources)) {
  if (!icons.includes(name)) {
    problems.push(`${name}: listed in sources.json but ${name}.svg does not exist.`);
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`\nall ${icons.length} icons accounted for`);
