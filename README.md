# mini-claude-code (TanStack AI)

A mini coding agent that runs in your terminal: it can list, read, and write
files, and run shell commands (after asking you to approve each one).

This is the TypeScript port of the original Python agent (`agent.py`), built
with the [TanStack AI SDK](https://tanstack.com/ai).

## Run

```bash
npm install
export OPENAI_API_KEY=sk-...
npm start
```

```
Mini agent ready. Type 'exit' to quit.

You: what files are in this folder?
 tool: list_files({})
The folder contains agent.py, agent.ts, ...
```

The reply streams token by token; ` tool: name(args)` lines appear as the
model calls tools. `run_command` prompts ` Run '<command>'? [y/N] ` before
executing anything.

## How it maps to the Python version

| agent.py | agent.ts |
| --- | --- |
| `OpenAI` client + `MODEL` | `openaiText('gpt-5-mini')` adapter from `@tanstack/ai-openai` (reads `OPENAI_API_KEY` from the env) |
| `TOOL_SCHEMAS` (hand-written JSON Schema) | `toolDefinition({ inputSchema: z.object(...) })` — schema + TypeScript types from one Zod definition |
| `TOOLS` dict of functions | `.server(async (args) => ...)` implementations, auto-executed by the SDK |
| `run_agent` while-loop (call model, run tools, repeat) | `chat({ adapter, messages, systemPrompts, tools })` runs the whole agent loop internally |
| `input()` prompts | one shared readline interface with a line queue (`ask()`) |
| unbounded tool loop | `agentLoopStrategy: maxIterations(25)` |

Two intentional differences: replies now stream instead of printing all at
once, and an API error prints `Error: ...` and returns to the prompt instead
of crashing the process. (`agent.py` also had a typo in `list_files`
(`entries.appent`) that made it always fail; the port just works.)

## Test without an API key

`npm run smoke` exercises every tool implementation directly — no model call:

```bash
printf 'n\ny\n' | npm run smoke
```

`n` declines the first command, `y` approves the second. `npm run typecheck`
runs `tsc --noEmit`.
