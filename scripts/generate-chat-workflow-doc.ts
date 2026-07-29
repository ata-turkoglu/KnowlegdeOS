import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chatWorkflowStages } from "../packages/shared/src/chat-workflow.js";

const outputUrl = new URL("../docs/chat-workflow.mmd", import.meta.url);

function quote(value: string) {
  return value.replaceAll("\"", "'");
}

function generate() {
  const lines = [
    "%% GENERATED FILE — packages/shared/src/chat-workflow.ts dosyasından üretilir.",
    "%% Elle düzenlemeyin: corepack pnpm docs:generate",
    "flowchart LR"
  ];

  for (const stage of chatWorkflowStages) {
    lines.push(`  ${stage.id}["${quote(stage.label.tr)}"]`);
    if ("branches" in stage) {
      lines.push("", `  subgraph ${stage.id}_branches[${quote(stage.label.tr)}]`, "    direction TB");
      for (const branch of stage.branches) lines.push(`    ${branch.id}["${quote(branch.label.tr)}"]`);
      lines.push("  end");
    }
  }

  lines.push("");
  for (const [index, stage] of chatWorkflowStages.entries()) {
    if ("branches" in stage) {
      for (const branch of stage.branches) lines.push(`  ${stage.id} --> ${branch.id}`);
    }
    const next = chatWorkflowStages[index + 1];
    if (!next) continue;
    if ("branches" in stage) {
      for (const branch of stage.branches) lines.push(`  ${branch.id} --> ${next.id}`);
    } else {
      lines.push(`  ${stage.id} --> ${next.id}`);
    }
  }
  if (chatWorkflowStages.some((stage) => stage.id === "validate") && chatWorkflowStages.some((stage) => stage.id === "generate")) {
    lines.push("  validate -.->|Kontrollü tekrar| generate");
  }

  const idsByLane = (lane: (typeof chatWorkflowStages)[number]["lane"]) => chatWorkflowStages.flatMap((stage) => [
    ...(stage.lane === lane ? [stage.id] : []),
    ...("branches" in stage && stage.lane === lane ? stage.branches.map((branch) => branch.id) : [])
  ]);
  lines.push(
    "",
    "  classDef chat fill:#eff6ff,stroke:#2563eb,color:#172554;",
    "  classDef retrieval fill:#fff7ed,stroke:#d97706,color:#7c2d12;",
    "  classDef model fill:#f5f3ff,stroke:#7c3aed,color:#3b0764;",
    "  classDef control fill:#fef2f2,stroke:#dc2626,color:#7f1d1d;",
    `  class ${idsByLane("chat").join(",")} chat;`,
    `  class ${idsByLane("retrieval").join(",")} retrieval;`,
    `  class ${idsByLane("model").join(",")} model;`,
    `  class ${idsByLane("control").join(",")} control;`,
    ""
  );
  return lines.join("\n");
}

async function main() {
  const expected = generate();
  if (process.argv.includes("--check")) {
    const current = await readFile(outputUrl, "utf8").catch(() => "");
    if (current !== expected) {
      console.error("docs/chat-workflow.mmd güncel değil. `corepack pnpm docs:generate` çalıştırın.");
      process.exitCode = 1;
    }
  } else {
    await writeFile(fileURLToPath(outputUrl), expected, "utf8");
    console.info("docs/chat-workflow.mmd güncellendi.");
  }
}

void main();
