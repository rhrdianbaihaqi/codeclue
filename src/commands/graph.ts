import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { CliError } from "../lib/errors";
import { assertSourceFile, isSupportedSource } from "../lib/files";
import { findTsConfig, loadCompilerOptions } from "../lib/project";
import { createResolver, extractSpecifiers } from "../lib/resolve";

export interface GraphOptions {
  /** Kedalaman maksimum dari entry (entry = 0). Default 2. */
  depth?: number;
  /** Basis path relatif pada keluaran. Default: process.cwd(). */
  cwd?: string;
  /** Ke mana peringatan non-fatal dikirim. Default: stderr. */
  warn?: (message: string) => void;
}

export interface GraphNode {
  path: string;
  depth: number;
  importedBy: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ExternalDependency {
  name: string;
  importedBy: string[];
}

export interface GraphResult {
  entry: string;
  /** Kedalaman yang diminta. Node di kedalaman ini tidak diperluas lebih jauh. */
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  external: ExternalDependency[];
  /** Import relatif/alias yang tidak ketemu filenya. */
  unresolved: { from: string; specifier: string }[];
  /** Kelompok file yang saling mengimpor (circular), masing-masing terurut. */
  cycles: string[][];
}

export const DEFAULT_DEPTH = 2;

/** Teks ringkas untuk manusia/agent: node per kedalaman, lalu eksternal, rusak, dan siklus. */
export function formatGraph(result: GraphResult): string {
  const lines: string[] = [`${result.entry} (entry, depth ${result.depth})`];
  let currentDepth = -1;
  for (const node of result.nodes) {
    if (node.depth !== currentDepth) {
      currentDepth = node.depth;
      lines.push(`depth ${currentDepth}`);
    }
    const by = node.importedBy.length > 0 ? `  <- ${node.importedBy.join(", ")}` : "";
    lines.push(`  ${node.path}${by}`);
  }
  if (result.external.length > 0) {
    lines.push("external");
    for (const dep of result.external) lines.push(`  ${dep.name}  <- ${dep.importedBy.join(", ")}`);
  }
  if (result.unresolved.length > 0) {
    lines.push("unresolved");
    for (const u of result.unresolved) lines.push(`  ${u.specifier}  <- ${u.from}`);
  }
  if (result.cycles.length > 0) {
    lines.push("cycles");
    for (const cycle of result.cycles) lines.push(`  ${cycle.join(" <-> ")}`);
  }
  return lines.join("\n");
}

/** Komponen terhubung kuat berukuran > 1, atau node dengan self-import (Tarjan, iteratif). */
function findCycles(nodes: string[], edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const e of edges) adjacency.get(e.from)?.push(e.to);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const neighbours = adjacency.get(frame.node) ?? [];

      if (frame.next < neighbours.length) {
        const to = neighbours[frame.next++]!;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        const selfLoop = component.length === 1 && edges.some((e) => e.from === member && e.to === member);
        if (component.length > 1 || selfLoop) cycles.push(component.sort());
      }
    }
  }

  return cycles.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
}

export function graph(filePath: string, options: GraphOptions = {}): GraphResult {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  const maxDepth = options.depth ?? DEFAULT_DEPTH;
  const cwd = options.cwd ?? process.cwd();

  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new CliError("EARGS", `--depth must be a non-negative integer, got ${String(maxDepth)}`);
  }
  assertSourceFile(filePath);

  const entryAbs = realpathSync(resolve(cwd, filePath));
  const display = (abs: string): string => {
    const rel = relative(cwd, abs);
    return (isAbsolute(rel) ? abs : rel).split(sep).join("/");
  };

  const tsConfigFilePath = findTsConfig(entryAbs);
  let compilerOptions;
  try {
    compilerOptions = loadCompilerOptions(tsConfigFilePath);
  } catch (err) {
    if (!(err instanceof CliError) || err.code !== "ETSCONFIG") throw err;
    warn(`Warning: ${err.message} (falling back to defaults)`);
    compilerOptions = loadCompilerOptions();
  }
  if (tsConfigFilePath === undefined) {
    warn(`Warning: no tsconfig.json found from ${filePath}; falling back to defaults.`);
  }
  const resolver = createResolver(compilerOptions, cwd);

  const depthOf = new Map<string, number>([[entryAbs, 0]]);
  const importers = new Map<string, Set<string>>([[entryAbs, new Set()]]);
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const externals = new Map<string, Set<string>>();
  const unresolved: { from: string; specifier: string }[] = [];

  // BFS per lapis. Node di kedalaman maksimum dicatat tapi tidak diperluas.
  let frontier = [entryAbs];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const file of frontier) {
      if (!isSupportedSource(file)) continue;

      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        warn(`Warning: cannot read ${display(file)}; skipped.`);
        continue;
      }

      for (const specifier of extractSpecifiers(text)) {
        const resolution = resolver.resolve(specifier, file);

        if (resolution.kind === "external") {
          const set = externals.get(resolution.name) ?? new Set<string>();
          set.add(display(file));
          externals.set(resolution.name, set);
        } else if (resolution.kind === "unresolved") {
          unresolved.push({ from: display(file), specifier });
        } else {
          const target = resolution.path;
          const key = `${file}\0${target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({ from: display(file), to: display(target) });
          }
          (importers.get(target) ?? importers.set(target, new Set()).get(target)!).add(display(file));
          if (!depthOf.has(target)) {
            depthOf.set(target, depth + 1);
            nextFrontier.push(target);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  const nodes: GraphNode[] = [...depthOf]
    .map(([abs, depth]) => ({
      path: display(abs),
      depth,
      importedBy: [...(importers.get(abs) ?? [])].sort(),
    }))
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  edges.sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : a.to > b.to ? 1 : 0) : a.from < b.from ? -1 : 1));
  unresolved.sort((a, b) => (a.from === b.from ? (a.specifier < b.specifier ? -1 : 1) : a.from < b.from ? -1 : 1));

  return {
    entry: display(entryAbs),
    depth: maxDepth,
    nodes,
    edges,
    external: [...externals]
      .map(([name, by]) => ({ name, importedBy: [...by].sort() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    unresolved,
    cycles: findCycles(
      nodes.map((n) => n.path),
      edges,
    ),
  };
}
