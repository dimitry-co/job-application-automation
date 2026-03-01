# PR Workflow (Agent + Human)

## Branch Rules

- Never work directly on `main`.
- Create a feature branch: `git switch -c codex/<short-task-name>`.
- Commit to that branch only.

## Open a PR From Terminal

- Run `npm run pr:create`.
- The script will:
  - confirm you are not on `main`
  - push the branch if it has no upstream
  - create a PR to `main` with `gh pr create --fill`
  - print the existing PR URL if one already exists

## Optional Flags

- `npm run pr:create -- --draft`
- `npm run pr:create -- --title "feat: add sync endpoint" --body "..." `

## Agent Prompt Snippet

Use this in agent instructions:

```
At the end of implementation:
1) run npm run check
2) git add -A && git commit -m "<clear commit message>"
3) git push -u origin <current-branch>
4) npm run pr:create
5) return PR URL and test results
```
