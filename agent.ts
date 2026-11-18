/**
 * Mini coding agent — the TanStack AI SDK port of agent.py.
 *
 * Same behavior as the Python original: a terminal chat loop where the model
 * can list files, read files, write files, and run shell commands (after
 * asking the user for approval). The agent loop — model turn, tool calls,
 * feeding results back — runs inside chat().
 */
import { exec } from "node:child_process";
import * as readline from "node:readline";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { EventType } from "@ag-ui/core";
import {
  chat,
  maxIterations,
  toolDefinition,
  type ModelMessage,
} from "@tanstack/ai";
import { openaiText, type OpenAITextAdapter } from "@tanstack/ai-openai";
import { z } from "zod";

const MODEL = "gpt-5-mini";

const SYSTEM_PROMPT = `You are a coding agent running in the user's terminal.
You can list files, read files, write files, and run shell commands.
Use your tools to complete the user's task, then briefly summarize what you did.
The working directory is the folder the user launched you from.`;

export function listFiles(path = "."): string {
  const entries = readdirSync(path, { withFileTypes: true })
    .map((entry) => entry.name + (entry.isDirectory() ? "/" : ""))
    .sort();
  return entries.join("\n") || "(empty directory)";
}

export function readFile(path: string): string {
  return readFileSync(path, "utf-8");
}

export function writeFile(path: string, content: string): string {
  writeFileSync(path, content, "utf-8");
  return `Saved ${path} (${content.length} characters)`;
}

export function runCommand(command: string): Promise<string> {
  return ask(` Run '${command}'? [y/N] `).then((answer) => {
    if (answer.trim().toLowerCase() !== "y") {
      return Promise.resolve("The user declined to run this command");
    }
    return new Promise<string>((resolve) => {
      exec(command, { timeout: 120_000 }, (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve(`Error: command timed out after 120 seconds`);
          return;
        }
        const output = (stdout + stderr).trim();
        resolve(output || `(no output, exit code ${error ? error.code : 0})`);
      });
    });
  });
}

// One readline interface for every prompt (the chat prompt and tool
// approvals). Lines are queued instead of using rl.question() so input that
// arrives between prompts (e.g. pasted or piped text) is never dropped, and
// prompts are serialized so concurrent tool calls can't interleave questions.
let rl: readline.Interface | undefined;
const pendingLines: string[] = [];
let lineWaiter: ((line: string) => void) | undefined;
let promptLock: Promise<unknown> = Promise.resolve();

function ask(question: string): Promise<string> {
  const answer = promptLock.then(async () => {
    rl ??= readline.createInterface({ input: process.stdin, terminal: false });
    if (rl.listenerCount("line") === 0) {
      rl.on("line", (line) => {
        if (lineWaiter) {
          const resolve = lineWaiter;
          lineWaiter = undefined;
          resolve(line);
        } else {
          pendingLines.push(line);
        }
      });
    }

    process.stdout.write(question);
    const queued = pendingLines.shift();
    if (queued !== undefined) return queued;
    return new Promise<string>((resolve) => {
      lineWaiter = resolve;
    });
  });
  promptLock = answer.then(
    () => undefined,
    () => undefined,
  );
  return answer;
}

// Python's run_tool caught exceptions and returned "Error: ..." to the model.
async function safe(work: () => string | Promise<string>): Promise<string> {
  try {
    return await work();
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export const listFilesTool = toolDefinition({
  name: "list_files",
  description: "List the files in a directory. Folders end with /.",
  inputSchema: z.object({
    path: z.string().optional().describe('Directory to list, e.g. "."'),
  }),
}).server(({ path }) => safe(() => listFiles(path)));

export const readFileTool = toolDefinition({
  name: "read_file",
  description: "Read a text file and return its contents.",
  inputSchema: z.object({
    path: z.string().describe("Path of the file to read"),
  }),
}).server(({ path }) => safe(() => readFile(path)));

export const writeFileTool = toolDefinition({
  name: "write_file",
  description: "Create or overwrite a text file with the given content.",
  inputSchema: z.object({
    path: z.string().describe("Path of the file to write"),
    content: z.string().describe("Full contents of the file"),
  }),
}).server(({ path, content }) => safe(() => writeFile(path, content)));

export const runCommandTool = toolDefinition({
  name: "run_command",
  description: "Run a shell command and return its output. The user approves it first.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to run"),
  }),
}).server(({ command }) => safe(() => runCommand(command)));

const TOOLS = [listFilesTool, readFileTool, writeFileTool, runCommandTool];

async function runAgent(
  adapter: OpenAITextAdapter<typeof MODEL>,
  messages: ModelMessage[],
): Promise<string> {
  const stream = chat({
    adapter,
    messages,
    systemPrompts: [SYSTEM_PROMPT],
    tools: TOOLS,
    // Python's loop ran until the model stopped calling tools; 25 model
    // turns is high enough to never bite, low enough to stop a runaway.
    agentLoopStrategy: maxIterations(25),
  });

  let reply = "";
  const toolNames = new Map<string, string>();

  for await (const chunk of stream) {
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) {
      process.stdout.write(chunk.delta ?? "");
      reply += chunk.delta ?? "";
    } else if (chunk.type === "TOOL_CALL_START") {
      toolNames.set(chunk.toolCallId, chunk.toolCallName);
    } else if (chunk.type === "TOOL_CALL_END") {
      const name = toolNames.get(chunk.toolCallId) ?? chunk.toolCallId;
      console.log(` tool: ${name}(${JSON.stringify(chunk.input ?? {})})`);
    } else if (chunk.type === EventType.RUN_ERROR) {
      throw new Error(chunk.message);
    }
  }
  return reply;
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Set the OPENAI_API_KEY environment variable and try again.");
    process.exit(1);
  }

  const adapter = openaiText(MODEL);
  const messages: ModelMessage[] = [];

  console.log("Mini agent ready. Type 'exit' to quit.");
  while (true) {
    const userInput = await ask("\nYou: ");
    if (["exit", "quit"].includes(userInput.trim().toLowerCase())) {
      break;
    }
    messages.push({ role: "user", content: userInput });

    process.stdout.write("\nAgent: ");
    try {
      const reply = await runAgent(adapter, messages);
      process.stdout.write("\n");
      messages.push({ role: "assistant", content: reply });
    } catch (error) {
      process.stdout.write("\n");
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
    }
  }

  rl?.close();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
