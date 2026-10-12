#!/usr/bin/env node
// Reproduces the README's savings tables against pinned-or-recorded checkouts.
// Dev tool only: not shipped (package.json "files" is ["dist"]), node builtins + git, no dependencies.
//
//   npm run build && node scripts/bench.mjs [trace|receipts|all] [options]
//
//   --repos a,b        only these repos (by name)
//   --outline-entry    pass --outline-entry to `clue trace`
//   --work-dir DIR     where checkouts live (default: <tmp>/codeclue-bench)
//   --fresh            delete existing checkouts first
//   --config FILE      repo list (default: scripts/bench-repos.json); entries may use
//                      "path" (an existing local checkout) instead of "url"
//   --cli FILE         CLI to measure (default: dist/cli.js)
//   --json             machine-readable output on stdout instead of markdown
//
// Tables go to stdout, progress to stderr. Numbers are estimated tokens (chars / 4),
// the same estimate the CLI uses. `trace` compares the map with reading every file in
// the map in full — it does not measure an agent session.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const log = (message) => process.stderr.write(`${message}\n`);

function parseArgs(argv) {
  const opts = { mode: "all", repos: null, outlineEntry: false, workDir: join(tmpdir(), "codeclue-bench"), fresh: false, json: false, config: join(here, "bench-repos.json"), cli: resolve(here, "..", "dist", "cli.js") };
  const takeValue = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["trace", "receipts", "all"].includes(a)) opts.mode = a;
    else if (a === "--repos") opts.repos = takeValue(i++, a).split(",");
    else if (a === "--outline-entry") opts.outlineEntry = true;
    else if (a === "--work-dir") opts.workDir = resolve(takeValue(i++, a));
    else if (a === "--fresh") opts.fresh = true;
    else if (a === "--config") opts.config = resolve(takeValue(i++, a));
    else if (a === "--cli") opts.cli = resolve(takeValue(i++, a));
    else if (a === "--json") opts.json = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout.trim();
}

/** Shallow checkout of branch, tag, or SHA; reuses an existing directory. Returns { dir, commit }. */
function checkout(repo, opts) {
  if (repo.path !== undefined) {
    const dir = resolve(repo.path);
    let commit = "local";
    try { commit = git(dir, "rev-parse", "HEAD"); } catch { /* not a git repo */ }
    return { dir, commit };
  }
  const dir = join(opts.workDir, repo.name);
  if (opts.fresh) rmSync(dir, { recursive: true, force: true });
  if (!existsSync(join(dir, ".git"))) {
    log(`[${repo.name}] fetching ${repo.url} @ ${repo.ref ?? "HEAD"} (shallow)...`);
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", repo.url);
    git(dir, "fetch", "-q", "--depth", "1", "origin", repo.ref ?? "HEAD");
    git(dir, "checkout", "-q", "FETCH_HEAD");
  } else {
    log(`[${repo.name}] reusing ${dir}`);
  }
  return { dir, commit: git(dir, "rev-parse", "HEAD") };
}

function clue(opts, cwd, args) {
  const r = spawnSync(process.execPath, [opts.cli, ...args, "--json"], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let envelope;
  try { envelope = JSON.parse(r.stdout); } catch { return { ok: false, error: (r.stderr || "no JSON on stdout").trim() }; }
  return envelope.ok ? { ok: true, data: envelope.data } : { ok: false, error: `${envelope.error.code}: ${envelope.error.message}` };
}

const num = (n) => n.toLocaleString("en-US");
const pct = (full, reduced) => (full <= 0 ? 0 : Math.round((1 - reduced / full) * 100));
const bold = (p) => (p >= 70 ? `**${p}%**` : `${p}%`);
const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

function benchTrace(repos, opts) {
  const rows = [];
  for (const repo of repos) {
    const { dir, commit } = checkout(repo, opts);
    for (const depth of [1, 2]) {
      log(`[${repo.name}] trace ${repo.entry} --depth ${depth}`);
      const args = ["trace", repo.entry, "--depth", String(depth), ...(opts.outlineEntry ? ["--outline-entry"] : [])];
      const r = clue(opts, dir, args);
      if (!r.ok) { rows.push({ repo: repo.name, commit, entry: repo.entry, depth, error: r.error }); continue; }
      const t = r.data.totals;
      rows.push({ repo: repo.name, commit, entry: repo.entry, depth, files: t.files, full: t.fullTokens, trace: t.traceTokens, saved: pct(t.fullTokens, t.traceTokens) });
    }
  }
  return rows;
}

function listSources(dir, sub) {
  const out = git(dir, "ls-files", "-z", "--", sub).split("\0").filter(Boolean);
  return out.filter((f) => /\.tsx?$/.test(f) && !/\.d\.[cm]?tsx?$/.test(f) && !/\.(test|spec)\.[cm]?tsx?$/.test(f) && !/(^|\/)(__tests__|tests?)\//.test(f));
}

function benchReceipts(repos, opts) {
  const files = [];
  const commits = {};
  let failures = 0;
  for (const repo of repos) {
    const { dir, commit } = checkout(repo, opts);
    commits[repo.name] = commit;
    const sources = listSources(dir, repo.dir ?? ".");
    log(`[${repo.name}] outline x ${sources.length} files`);
    sources.forEach((file, i) => {
      if ((i + 1) % 50 === 0) log(`[${repo.name}] ${i + 1}/${sources.length}`);
      const r = clue(opts, dir, ["outline", file]);
      if (!r.ok) { failures++; log(`  failed: ${file} (${r.error.split("\n")[0]})`); return; }
      files.push({ file: `${repo.name}/${file}`, before: r.data.originalTokens, after: r.data.outlineTokens });
    });
  }
  const before = files.reduce((n, f) => n + f.before, 0);
  const after = files.reduce((n, f) => n + f.after, 0);
  return {
    commits,
    files: files.length,
    failures,
    before,
    after,
    saved: pct(before, after),
    median: median(files.map((f) => pct(f.before, f.after))),
    largest: [...files].sort((a, b) => b.before - a.before).slice(0, 6).map((f) => ({ ...f, saved: pct(f.before, f.after) })),
  };
}

function renderTrace(rows) {
  const lines = ["| Repo | Entry | Depth | Files | Full | `trace` | Saved |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |"];
  for (const r of rows) {
    lines.push(r.error !== undefined
      ? `| ${r.repo} | \`${r.entry}\` | ${r.depth} | - | - | - | failed: ${r.error.split("\n")[0]} |`
      : `| ${r.repo} | \`${r.entry}\` | ${r.depth} | ${r.files} | ~${num(r.full)} | ~${num(r.trace)} | ${bold(r.saved)} |`);
  }
  const commits = [...new Map(rows.map((r) => [r.repo, r.commit])).entries()].map(([n, c]) => `${n}@${c.slice(0, 10)}`);
  return `${lines.join("\n")}\n\nCommits: ${commits.join(", ")}`;
}

function renderReceipts(r) {
  const lines = [
    "| | |", "| --- | --- |",
    `| Files processed | **${r.files}** |`, `| Failures | **${r.failures}** |`,
    `| Tokens | **${num(r.before)} → ${num(r.after)}** |`, `| Saved overall | **${r.saved}%** |`, `| Median file | **${r.median}%** |`,
    "", "| File | Before | After | Saved |", "| --- | ---: | ---: | ---: |",
    ...r.largest.map((f) => `| \`${f.file}\` | ${num(f.before)} | ${num(f.after)} | ${bold(f.saved)} |`),
  ];
  const commits = Object.entries(r.commits).map(([n, c]) => `${n}@${c.slice(0, 10)}`);
  return `${lines.join("\n")}\n\nCommits: ${commits.join(", ")}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.cli)) throw new Error(`CLI not found at ${opts.cli}. Run \`npm run build\` first (or pass --cli).`);
  const config = JSON.parse(readFileSync(opts.config, "utf8"));
  const pick = (list) => (opts.repos === null ? list : list.filter((r) => opts.repos.includes(r.name)));

  const result = {};
  if (opts.mode !== "receipts") result.trace = benchTrace(pick(config.trace ?? []), opts);
  if (opts.mode !== "trace") result.receipts = benchReceipts(pick(config.receipts ?? []), opts);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const parts = [];
  if (result.trace !== undefined) parts.push(`### \`trace\`${opts.outlineEntry ? " (--outline-entry)" : ""}\n\n${renderTrace(result.trace)}`);
  if (result.receipts !== undefined) parts.push(`### \`outline\` receipts\n\n${renderReceipts(result.receipts)}`);
  process.stdout.write(`${parts.join("\n\n")}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`bench: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
