# nunopi

Learn the code your AI agents write. nunopi analyzes code and tech writing line by line, explains terms and concepts, and turns them into flashcards you can review.

- **Code / Text analysis**: line-by-line explanations, term and concept extraction
- **Ask**: chat sessions with folders and shared context
- **Memorize**: spaced-repetition cards and decks, quizzes
- **History**: everything you analyzed, searchable

Runs on your own AI CLI subscriptions (Claude Code, Codex, OpenCode) — no API key needed.

## Run

```bash
npm install
npm run dev            # web (http://localhost:3000)
npm run electron:dev   # desktop app
```

## Source of truth

This repository is **generated**. nunopi is developed inside the [Mustard](https://github.com/h1tTAKA/mustard) monorepo (`apps/nunopi`, `packages/core`, `packages/nunopi`) and synced here on every merge. Please open issues and pull requests on [h1tTAKA/mustard](https://github.com/h1tTAKA/mustard) — changes made directly here are overwritten by the next sync.

`SYNCED_FROM` holds the Mustard commit this snapshot came from.
