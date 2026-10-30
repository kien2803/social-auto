#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const roots = args.filter(a => a !== "--json");
if (roots.length === 0) roots.push(".");

const EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"]);
const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".svelte-kit", "coverage"]);

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const stat = fs.statSync(p);
  if (stat.isFile()) {
    if (EXT.has(path.extname(p))) out.push(p);
    return out;
  }
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE.has(entry.name)) continue;
    walk(path.join(p, entry.name), out);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function add(findings, file, severity, rule, message, index = 0) {
  findings.push({ file, line: lineOf(fs.readFileSync(file, "utf8"), index), severity, rule, message });
}

const findings = [];
let totalMorphIcons = 0;
let filesUsingMorphicons = 0;

for (const file of [...new Set(roots.flatMap(r => walk(r)))]) {
  const text = fs.readFileSync(file, "utf8");
  if (!/morphicons\//.test(text) && !/<MorphIcon\b/.test(text) && !/createMorph\s*\(/.test(text)) continue;
  filesUsingMorphicons++;

  const uses = [...text.matchAll(/<MorphIcon\b/g)];
  totalMorphIcons += uses.length;

  const keyed = /<MorphIcon\b[^>]*\bkey\s*=/.exec(text);
  if (keyed) add(findings, file, "high", "forced-remount", "Avoid key-driven remounts; they discard interruption continuity and instance state.", keyed.index);

  for (const m of text.matchAll(/<MorphIcon\b[^>]*>/gs)) {
    const tag = m[0];
    if (/\bprogress\s*=/.test(tag) && /\bspring\s*=/.test(tag)) {
      add(findings, file, "medium", "controlled-spring", "Controlled progress owns the path; a spring does not drive controlled mode.", m.index);
    }
    if (/\bfrom\s*=/.test(tag) && /\bto\s*=/.test(tag) && /\bicon\s*=/.test(tag)) {
      add(findings, file, "info", "mixed-modes", "Controlled mode wins while both from and to are present. Verify that this precedence is intentional.", m.index);
    }
  }

  if (/\.map\s*\([\s\S]{0,300}=>[\s\S]{0,800}<MorphIcon\b/.test(text)) {
    add(findings, file, "medium", "list-concurrency", "MorphIcon appears inside a mapped list. Profile the expected simultaneous active count and offscreen behavior.", text.search(/\.map\s*\(/));
  }

  if (uses.length >= 20) {
    add(findings, file, "medium", "many-in-file", `${uses.length} MorphIcon instances appear in this file. Treat concurrent animation as a profiling requirement.`, uses[0]?.index ?? 0);
  }

  const fitMatches = [...text.matchAll(/\bfitIcon\s*\(/g)];
  for (const m of fitMatches) {
    const before = text.slice(Math.max(0, m.index - 900), m.index);
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const callIndent = (text.slice(lineStart, m.index).match(/^\s*/) ?? [""])[0].length;
    const nearbyFunction = /function\s+\w+[\s\S]*\{|=>\s*\{|setup\s*\([\s\S]*\{/.test(before);
    if (callIndent > 0 && nearbyFunction) {
      add(findings, file, "medium", "fiticon-runtime", "fitIcon may be running inside component/setup code. Hoist static fitting to module scope or memoize truly dynamic input.", m.index);
    }
  }

  if (/\bprogress\s*=/.test(text) && /(scroll|pointer|mouse|touch|drag)/i.test(text) && !/requestAnimationFrame|useAnimationFrame|raf/i.test(text)) {
    add(findings, file, "medium", "unbatched-progress", "Controlled progress appears interaction-driven without obvious animation-frame batching. Verify event coalescing and profile framework commits.", text.search(/\bprogress\s*=/));
  }

  if (/filter\s*:|filter=|blur\(|drop-shadow\(|box-shadow/i.test(text) && uses.length > 0) {
    add(findings, file, "info", "paint-effects", "Visual filters or shadows appear near morphing SVGs. Profile paint/rendering cost on target devices.", text.search(/filter\s*:|filter=|blur\(|drop-shadow\(|box-shadow/i));
  }
}

const summary = {
  filesUsingMorphicons,
  staticMorphIconOccurrences: totalMorphIcons,
  findings,
  note: "Static audit only. It cannot measure CPU time, GPU usage, paint cost, frame rate, or actual concurrency."
};

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Morphicons files: ${filesUsingMorphicons}`);
  console.log(`Static <MorphIcon> occurrences: ${totalMorphIcons}`);
  if (findings.length === 0) console.log("No heuristic findings.");
  for (const f of findings) {
    console.log(`${f.severity.toUpperCase()} ${f.file}:${f.line} [${f.rule}] ${f.message}`);
  }
  console.log(`NOTE: ${summary.note}`);
}
