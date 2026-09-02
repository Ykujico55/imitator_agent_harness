#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { GitHubClient } from "./github.ts";
import { prepareReferencePack, writeGateResult, writeReferencePack } from "./pipeline.ts";
import { applyReviewGate, parseReviewSubmission } from "./review.ts";
import type { ReferencePack } from "./types.ts";

const HELP = `imitator-agent-harness

Prepare a bounded, attributed precedent pack before a coding task.

Usage:
  imitator prepare --task "Build a durable job queue" [options]
  imitator gate --manifest <manifest.json> --decisions <review.json> [options]

Options:
  --task <text>       Required implementation task
  --query <query>     Explicit GitHub query; repeatable
  --language <name>   GitHub language qualifier
  --ecosystem <name>  Additional task/domain signal
  --config <path>     JSON configuration file
  --out <directory>   Output root (default: .imitator/reference)
  --token <token>     GitHub token; prefer GITHUB_TOKEN or GH_TOKEN
  --json              Print the manifest JSON to stdout
  -h, --help          Show help

Gate options:
  --manifest <path>   Reference pack manifest from prepare
  --decisions <path>  Completed REVIEW_TEMPLATE.json
  --config <path>     JSON configuration file
  --out <directory>   Approved artifact directory (default: <pack>/approved)
`;

async function prepareCommand(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      task: { type: "string" }, query: { type: "string", multiple: true },
      language: { type: "string" }, ecosystem: { type: "string" }, config: { type: "string" },
      out: { type: "string", default: ".imitator/reference" }, token: { type: "string" },
      json: { type: "boolean", default: false }, help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) { console.log(HELP); return; }
  if (!values.task) throw new Error("--task is required");
  const config = await loadConfig(values.config);
  const client = new GitHubClient({ token: values.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN });
  const pack = await prepareReferencePack(client, {
    task: values.task, queries: values.query, language: values.language, ecosystem: values.ecosystem,
  }, config);
  const directory = await writeReferencePack(pack, values.out!);
  if (values.json) console.log(JSON.stringify(pack, null, 2));
  else {
    console.log(`Reference pack: ${directory}`);
    console.log(`Inspected: ${pack.assessments.length}; accepted: ${pack.assessments.filter((item) => item.accepted).length}; slices: ${pack.slices.length}`);
  }
}

async function gateCommand(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      manifest: { type: "string" }, decisions: { type: "string" }, config: { type: "string" },
      out: { type: "string" }, help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) { console.log(HELP); return; }
  if (!values.manifest) throw new Error("--manifest is required");
  if (!values.decisions) throw new Error("--decisions is required");
  const rawPack = JSON.parse(await readFile(values.manifest, "utf8")) as ReferencePack;
  if (rawPack.schemaVersion !== 2 || !Array.isArray(rawPack.assessments) || !Array.isArray(rawPack.slices)) {
    throw new Error("Unsupported or malformed reference pack; expected schemaVersion 2");
  }
  const submission = parseReviewSubmission(JSON.parse(await readFile(values.decisions, "utf8")));
  const config = await loadConfig(values.config);
  const result = applyReviewGate(rawPack, submission, config);
  const output = values.out ?? resolve(dirname(values.manifest), "approved");
  const directory = await writeGateResult(result, submission, output);
  console.log(`Gate artifacts: ${directory}`);
  console.log(`Phase-one: ${result.results.length}; approved: ${result.results.filter((item) => item.approved).length}; slices: ${result.approvedPack.slices.length}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") { console.log(HELP); return; }
  if (command === "prepare") return prepareCommand();
  if (command === "gate") return gateCommand();
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(`imitator: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
