import {
  listFilesTool,
  readFileTool,
  writeFileTool,
  runCommandTool,
} from "./agent.ts";

// Exercise each tool's server implementation directly (no LLM involved).
const listing = await listFilesTool.execute?.({});
console.log("list_files ->", JSON.stringify(listing));

const notes = await readFileTool.execute?.({ path: "notes.txt" });
console.log("read_file ->", JSON.stringify(notes));

const saved = await writeFileTool.execute?.({
  path: "/tmp/mini-agent-smoke.txt",
  content: "hello world",
});
console.log("write_file ->", JSON.stringify(saved));

const declined = await runCommandTool.execute?.({ command: "echo should-not-run" });
console.log("run_command (declined) ->", JSON.stringify(declined));

const ran = await runCommandTool.execute?.({ command: "echo hi" });
console.log("run_command (approved) ->", JSON.stringify(ran));

const missing = await readFileTool.execute?.({ path: "no-such-file.txt" });
console.log("read_file (missing) ->", JSON.stringify(missing));
