#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
import { GitHubClient } from "./github.ts";
import { prepareReferencePack, writeReferencePack } from "./pipeline.ts";

const HELP = `imitator-agent-harness

Prepare a bounded, attributed precedent pack before a coding task.

Usage:
  imitator prepare --task "Build a durable job queue" [options]

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
`;

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command !== "prepare") throw new Error(`Unknown command: ${command}`);
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

main().catch((error: unknown) => {
  console.error(`imitator: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
