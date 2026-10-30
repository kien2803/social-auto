#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

function parseArgs(argv) {
  const out = { query: "", files: "", imports: "", json: false, cat: false, all: false, maxFiles: manifest.defaultMaxFiles, maxChars: 24000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query") out.query = argv[++i] ?? "";
    else if (arg === "--files") out.files = argv[++i] ?? "";
    else if (arg === "--imports") out.imports = argv[++i] ?? "";
    else if (arg === "--json") out.json = true;
    else if (arg === "--cat") out.cat = true;
    else if (arg === "--all") out.all = true;
    else if (arg === "--max-files") out.maxFiles = Number(argv[++i] ?? out.maxFiles);
    else if (arg === "--max-chars") out.maxChars = Number(argv[++i] ?? out.maxChars);
    else if (!arg.startsWith("--")) out.query += ` ${arg}`;
  }
  return out;
}


function collectFileSignals(filesArg) {
  const signals = [];
  const candidates = filesArg.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const abs = path.resolve(process.cwd(), candidate);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const stat = fs.statSync(abs);
    if (stat.size > 512_000) continue;
    const text = fs.readFileSync(abs, "utf8");
    const relevant = text
      .split("\n")
      .filter(line => /morphicons|react-native-svg|from\s+["'](?:react|vue|svelte)|<MorphIcon|createMorph|buildPlan|fitIcon|progress=/.test(line))
      .slice(0, 120)
      .join(" ");
    signals.push(relevant);
  }
  return signals.join(" ");
}

function scoreTopic(topic, haystack) {
  let score = 0;
  for (const signal of topic.signals) {
    const s = signal.toLowerCase();
    if (haystack.includes(s)) score += s.includes("morphicons/") ? 8 : 3;
  }
  return score;
}

function inferFromFiles(files) {
  const lower = files.toLowerCase();
  const inferred = [];
  if (/\.native\.(tsx|jsx|ts|js)\b/.test(lower)) inferred.push("react native react-native");
  if (/\.(tsx|jsx)\b/.test(lower)) inferred.push("react tsx jsx");
  if (/\.vue\b/.test(lower)) inferred.push("vue .vue");
  if (/\.svelte\b/.test(lower)) inferred.push("svelte .svelte");
  return inferred.join(" ");
}

function select(opts) {
  if (opts.all) return [...new Set(["references/index.md", ...manifest.mandatoryForCodeChanges, ...manifest.topics.map(t => t.file)])];
  const fileSignals = collectFileSignals(opts.files);
  const haystack = `${opts.query} ${opts.files} ${opts.imports} ${inferFromFiles(opts.files)} ${fileSignals}`.toLowerCase();
  const implementation = /add|build|implement|use|integrat|review|refactor|fix|debug|optim|morph|icon|component|code/.test(haystack);
  const scored = manifest.topics
    .map(topic => ({ topic, score: scoreTopic(topic, haystack) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id));

  const selected = [];
  if (implementation) selected.push("references/performance/decision-guide.md");

  // Prefer the most specific platform. React Native must beat generic React/TSX.
  const platformOrder = ["react-native", "react", "vue", "svelte", "dom", "core"];
  const platform = platformOrder
    .map(id => scored.find(x => x.topic.id === id))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0];
  if (platform) selected.push(platform.topic.file);

  for (const { topic } of scored) {
    if (!selected.includes(topic.file)) selected.push(topic.file);
  }

  if (selected.length === 0) selected.push("references/index.md");
  return selected.slice(0, Math.max(1, opts.maxFiles));
}

function emitContext(files, maxChars) {
  let used = 0;
  const chunks = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    const header = `\n\n===== ${rel} =====\n\n`;
    if (used + header.length >= maxChars) break;
    const room = maxChars - used - header.length;
    chunks.push(header + content.slice(0, room));
    used += header.length + Math.min(content.length, room);
    if (content.length > room) {
      chunks.push("\n[context truncated by --max-chars]\n");
      break;
    }
  }
  return chunks.join("").trimStart();
}

const opts = parseArgs(process.argv.slice(2));
const files = select(opts);
if (opts.json) {
  console.log(JSON.stringify({ files, maxChars: opts.maxChars }, null, 2));
} else if (opts.cat) {
  console.log(emitContext(files, opts.maxChars));
} else {
  console.log(files.join("\n"));
}
