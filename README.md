# Grok Desktop (Unofficial)

*[한국어 README](README.ko.md)*

> **This is an unofficial community project.** It is not built, endorsed, or sponsored by xAI, and
> it has no affiliation with xAI. "Grok" and "xAI" are trademarks of xAI Corp., used here only
> descriptively to identify the tool this app works with. No xAI logos, icons, or brand assets are
> included in this repository.

A local agent desktop app that stays inside the folder you pick. It drives the official
**Grok Build CLI** as an ACP (Agent Client Protocol) agent, and every file edit or shell command
the CLI asks about goes through your approval first.

One caveat worth knowing up front: if your `~/.grok/config.toml` sets
`[ui] permission_mode = "always-approve"` (or another mode that skips asking), the CLI approves its
own tools and never asks this app, so commands it runs itself never reach an approval card. The CLI
offers no per-run override, so the app detects the setting and says so in the header instead of
implying a gate that is not there.

This is not a WebView wrapper around `grok.com`. The whole loop — read files → propose changes →
approve a diff → run → inspect results — happens locally.

## Requirements

- Node.js LTS (`.nvmrc` = 22.11.0)
- pnpm 11 (or run everything through `corepack pnpm ...`)
- Grok Build CLI

The app never installs the CLI for you. Run it yourself:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

Then sign in:

```bash
grok login
```

The app looks for `grok` on your `PATH` and in `~/.grok/bin`, `~/.local/bin`, `/usr/local/bin`, and
`/opt/homebrew/bin`. If yours lives somewhere else, point at it with the `GROK_DESKTOP_CLI_PATH`
environment variable.

### Supported CLI versions

The app speaks ACP protocol version 1 over `grok agent stdio` and negotiates capabilities from the
handshake, so it enforces no minimum CLI version — it reports whatever `grok version` prints and
adapts to what the agent advertises. Developed and exercised against CLI 1.0.3 through 1.0.30. A
CLI that drops ACP protocol 1 would break it.

## Development

```bash
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | Run in development mode (HMR) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Type-check main/preload/packages and the renderer |
| `pnpm test` | Unit tests |
| `pnpm test:security` | Path containment, IPC schemas, URL policy, child-process env |
| `pnpm test:e2e` | Integration tests, including a full approval round trip against a fake ACP agent |
| `pnpm build` | Production bundle (`apps/desktop/out`) |
| `pnpm package:mac` | Build a macOS DMG |
| `pnpm verify` | lint + typecheck + test + test:security |

## Layout

```text
grok-desktop-mac/
├── apps/desktop/           Electron app
│   ├── src/main/           Window, IPC, sessions, permissions, diffs, storage
│   ├── src/preload/        The only API exposed through contextBridge
│   └── src/renderer/       React UI (no Node access)
├── packages/
│   ├── shared/             Domain types, IPC channels and Zod schemas, bridge interface
│   ├── security/           Path containment, command risk, secret masking, URL/env policy
│   └── acp-client/         JSON-RPC stdio client, ACP schemas, CLI detection
├── tests/
│   ├── fixtures/           Fake ACP agent
│   ├── security/           Security tests
│   └── e2e/                Integration tests
└── docs/                   Spec, security model, ACP notes, release checklist
```

## How it works

1. The app spawns `grok agent stdio` as a child process and talks JSON-RPC over stdin/stdout.
2. The session's `cwd` is the realpath of the folder you chose.
3. The agent's file reads and writes are routed back through the app, so every path is checked
   against the workspace root before anything touches disk.
4. State-changing tool calls go through a permission engine that either auto-allows, auto-denies,
   or raises an approval card.
5. The original content is snapshotted right before a write, so the UI can show a real diff and
   offer a revert.
6. Shell commands run inside the CLI's own sandbox; the app is the approval layer in front of it.

## Features

- **Model picker** — in the header. The list comes from the agent's `initialize` response. Switching
  restarts the agent with `-m` and reattaches the conversation through `session/load`.
- **Usage** — once the API reports real numbers (it only does so at the limit), you get remaining
  tokens and a gauge; before that, the turn count for this session and the model's context size.
  xAI exposes no remaining-usage endpoint, so nothing here is estimated.
- **Theme** — follows the system light/dark setting, including the native window background.
- **Menu bar** — a macOS status item shows session state and pending approvals, and offers open,
  stop, and quit. Pending approvals also raise a Dock badge.
- **Previous conversations** — resuming from the session list restores both the on-screen history
  and the agent's own context. Your first prompt becomes the session title.
- **Composer** — `Enter` sends, `Shift+Enter` inserts a newline, `⌘Enter` queues a message while a
  turn is running. Enter never sends mid-composition for IME input (Korean, Japanese, Chinese).

Work modes:

- **Ask** — read-only. Answers questions.
- **Plan** — proposes a plan without changing anything.
- **Agent** — edits files and runs commands, with approval.

## Where data lives

The source of truth for a conversation is the CLI's own log at
`~/.grok/sessions/<workspace>/<session-id>/updates.jsonl`. The app indexes it and adds an overlay
only for events the CLI log does not carry, such as approvals and file changes.

- CLI conversation log: `~/.grok/sessions/` (relocatable with `GROK_HOME`)
- Sessions, workspaces, approval history: `~/Library/Application Support/Grok Desktop/metadata.json` (mode 0600)
- UI transcript cache (fallback): `~/Library/Application Support/Grok Desktop/sessions/<session-id>.json`
- App-only overlay: `~/Library/Application Support/Grok Desktop/overlays/<session-id>.jsonl`
- Diagnostic log: `~/Library/Application Support/Grok Desktop/logs/grok-desktop.log` (mode 0600)

Those paths are for the packaged app, whose name is `Grok Desktop`. Running from source with
`pnpm dev` uses the workspace package name instead, so the same files live under
`~/Library/Application Support/@grok-desktop/desktop/`.

The app never stores auth tokens. xAI authentication is handled entirely by the Grok CLI.

## Security

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the full model. In short:

- The renderer has no Node, no filesystem, and no token access.
- Every IPC input is validated against a per-channel Zod schema, and the sender is verified.
- Your whole home directory, system directories, and credential folders cannot be opened as a
  workspace.
- Access outside the workspace is refused regardless of permission profile — including paths
  reached through symlinks.
- Deletes, package installs, `git push`, network commands, and permission changes are always
  re-approved, even when a session-wide allowance exists.
- Strings on their way to the UI or the logs are scanned and masked for secrets.

## Status

Phases 1–5 are implemented, plus session resume and error recovery from Phase 6. What remains is
accessibility and performance polish, and signed/notarized distribution (Phase 7), tracked in
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

Note that most in-app copy and the documents under `docs/` are written in Korean.

## Built with

This project was written with three AI coding agents working on the same codebase:

- [Claude Code](https://claude.com/claude-code) (Anthropic)
- [Codex](https://openai.com/codex/) (OpenAI)
- [Grok Build CLI](https://docs.x.ai/build/overview) (xAI) — also the runtime this app drives

Commits carry `Co-authored-by:` trailers for the agents involved in that particular change.
None of these vendors are affiliated with this project.

## License

No license is granted (all rights reserved). The source is published for reading and review only;
copying, modifying, redistributing, or commercial use are not permitted. Open an issue if you would
like to use it for something.

This app only launches a Grok Build CLI that you installed yourself; it does not redistribute the
CLI or any xAI service. Your use of the CLI and of xAI services is governed by their own terms.
