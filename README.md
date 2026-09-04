# Nuum

Nuum is a local-first desktop environment for persistent AI agents.

Most AI products organize work around disposable chat sessions. Nuum takes the opposite position: an Agent is a durable entity with its own identity, conversation truth, memory, workspace, and ability to collaborate with other Agents. Users delegate work to Agents instead of managing session folders.

## Product philosophy

### Assign work, not sessions

The user should decide what needs to be done and who should own it. Session boundaries are an implementation detail created while an Agent works, not a product object the user has to maintain.

### Agents are persistent entities

An Agent keeps a stable identity across tasks. Its transcript records what it actually saw and did; its memory carries useful experience forward; its workspace and permissions define where it may act.

### Work belongs in one place

Project goals, tasks, shared discussion, collaborators, tools, Skills, CLIs, and knowledge sources belong to a Work—not to an arbitrary chat. Work Bar coordinates these resources without turning Nuum back into a session-first system.

### Proactivity needs a separate context domain

Proactive Mode is a separate planned product line. Ambient screen and accessibility context must not be poured into an Agent transcript or long-term memory. It should be captured under explicit permission, reduced locally into bounded evidence, and handed to a dedicated Proactive Agent only when it forms a useful proposal.

### Facts are written once

Nuum separates durable truth by domain:

- Agent transcripts are the source of truth for what an Agent saw and did.
- Work timelines are the source of truth for shared chat, tasks, handoffs, and deliverables.
- Proactive context logs will be the source of truth for permitted environmental observations.

UI timelines, model context, status indicators, and task boards are projections of those truths—not competing databases.

### Local-first and least disclosure

Private memory, raw environmental context, credentials, and local paths stay on the user's machine by default. Discovering a capability never implies permission to use it, and shared Work context must not expose an Agent's private transcript or memory.

## Current architecture

```text
Renderer ──IPC──> Desktop main ──stdio RPC──> Host ──stdio RPC──> Kernel
                  shell / secrets             product state       model loop
```

The current implementation provides:

- one append-only transcript, memory, workspace, and persistent shell per Agent;
- asynchronous Agent-to-Agent messaging;
- causal projections for user messages, peer messages, and tool activity;
- compact checkpoints without rewriting transcript history;
- action-scoped permissions and local file/search tools;
- OpenAI, Anthropic, and DeepSeek model routing.
- Work Bar V1 with an append-only Work timeline, task board, shared room, dynamic Agent membership, scoped dispatch and handoff, and Work-owned Skill, CLI, knowledge, and local-tool configuration.

The Host owns product semantics and persistence. The Kernel only executes model runs identified by `runId` and never owns Agent state.

## Planned independent product lines

- **Proactive Mode** — a dedicated default Agent backed by a permissioned, bounded ContextStore. It is designed to work without Work Bar.
- **Work Bar follow-ups** — richer deliverable review, additional capability providers, and networked collaboration. Work Bar remains independent from Proactive Mode.

They may gain an optional proposal-to-task bridge later, but neither is an architectural dependency of the other.

## Repository map

```text
apps/desktop       Electron shell and renderer mounting
packages/ui        React interface
packages/host      Agent state, transcripts, memory, permissions, scheduling
packages/kernel    Model loop and tool execution
packages/protocol  Shared RPC and domain contracts
packages/tools     Built-in tools
packages/sandbox   Local execution boundary and persistent shells
docs               Architecture and engineering records
```

## Development

Requirements: Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm run lint:deps
```

Start with [AGENTS.md](./AGENTS.md) for the project map and [docs/coding](./docs/coding/README.md) before changing product behavior.

## Project status

Nuum is under active development. The agent-first foundation and Work Bar V1 are implemented. Proactive Mode remains an independent work in progress.

## License

Licensed under the [Apache License 2.0](./LICENSE). Third-party dependencies and assets remain subject to their respective licenses and attribution requirements.
