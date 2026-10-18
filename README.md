<p align="center">
  <img src=".github/assets/mustard-hero.png" alt="Mustard — Must-have ADE" width="100%">
</p>

<h3 align="center">The agentic development environment that keeps you in the loop.</h3>

<p align="center">
  Run Claude Code, Codex and friends in a real terminal — with Git, GitHub, docs, a browser<br>
  and a live explanation of everything your agents do, all in one window.
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-2b2e3a?style=flat-square&logo=electron&logoColor=9feaf9">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="Node 24" src="https://img.shields.io/badge/node-24-d4a017?style=flat-square&logo=nodedotjs&logoColor=white">
  <a href="https://github.com/h1tTAKA/mustard/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/h1tTAKA/mustard?style=flat-square&color=d4a017"></a>
</p>

<p align="center">
  <a href="#-why-mustard">Why</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-nunopi">nunopi</a> ·
  <a href="#-contributing">Contributing</a>
</p>

---

## 🌼 Why Mustard

Coding agents now write hundreds of lines in minutes. **Writing is no longer the bottleneck — understanding is.** You still have to review what the agent did, know why it did it, and own the result.

Meanwhile everything you need lives somewhere else: issues in the browser, plans in a notes app, previews in another tab. Every switch costs focus.

Mustard puts it all around the terminal your agents already run in, and explains the work while it happens.

- **Terminal-first.** Your agents run as they always do. Mustard never replaces the terminal — it organizes everything around it.
- **Bring your own agents.** Claude Code, Codex, OpenCode, Grok Build, Cursor. Your existing subscriptions, your MCP servers, your project rules. No API keys.
- **Local by default.** Your code stays on your machine and only goes to the AI you chose.

## ✨ Features

### 🖥️ Workspace
| | |
|---|---|
| **Terminal** | Multi-tab terminals in a background daemon — sessions survive app restarts. |
| **Git** | Commit graph, diffs, working-tree changes and branches beside the terminal. |
| **GitHub** | Issues, pull requests and CI checks without leaving the app. |
| **Docs** | Read research notes and plans (Markdown) in tabs. |
| **Browser** | Preview your app, pick an element and hand it straight to the agent. |
| **Architecture** | A code graph the agent reads through MCP, explained back to you as feature flows. |

### ⚡ Catch-up — understand what your agents did
- **Live narration** of every tool call: what the agent is doing, and why.
- **Commit ↔ conversation.** Every commit links to the exact agent session that produced it — from your prompt to the end of the committing turn. Open it in a code review or an incident months later.
- **Ask anything** about a change; answers link back to the related diff and session.

### 👥 Crew — agent teams with human gates
- A kanban board where role agents — scope planner, builder, tester, release checker — hand cards to each other in an order enforced by code.
- **Mix vendors per role:** Claude builds, Codex tests, another agent reviews.
- **Team chat** — agents report to each other; `@mention` a role to start a card.
- **Triggers** — CI failures, labeled issues or a schedule create cards automatically.
- **Subtasks** run in dependency order, each in its own git worktree.
- **Humans stay in charge.** Agents never push or merge. You approve specs, destructive data changes and merges, and open draft PRs with one click.

## 🚀 Quick start

Requirements: macOS, Node.js 24, and at least one agent CLI you are logged in to.

```bash
git clone https://github.com/h1tTAKA/mustard.git
cd mustard
npm install
npm run electron:dev        # desktop app
```

<details>
<summary>More commands</summary>

```bash
npm run dev                                            # web UI only (http://localhost:3000)
npm run electron:dist:dir --workspace apps/mustard     # package the .app into apps/mustard/dist_electron
```
</details>

## 🌱 nunopi

Mustard ships with **nunopi**, an optional learning module named after the Korean word *눈높이* — "at eye level".

Paste code or tech writing and get line-by-line explanations, a term dictionary and concept cards. Branch your questions into threads that stay organized, and review what you learned with spaced-repetition decks — sorted for you by an agent.

Want just the learning app? → **[h1tTAKA/nunopi](https://github.com/h1tTAKA/nunopi)** (synced automatically from this repository).

## 🗂️ Repository layout

```
apps/
  mustard/        Mustard desktop app (Next.js + Electron)
  nunopi/         nunopi standalone app
packages/
  core/           shared UI, i18n (en / ja / ko), agent runtime client
  nunopi/         nunopi learning module
scripts/
  export-nunopi.mjs   builds the standalone nunopi repository
```

## 🤝 Contributing

Issues and pull requests are welcome — including changes to nunopi, which is developed here. The standalone nunopi repository is generated, so changes made there are overwritten on the next sync.

