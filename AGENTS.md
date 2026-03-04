# Agent Operating Guide

This file is the single source of truth for Codex agents in this repository.

## What This Repo Is

- Next.js + TypeScript application for job discovery, tracking, and form-fill prep.
- Main quality gate: `npm run check`
- Main PR helper: `npm run pr:create`

## Required Workflow

1. Run `npm run hooks:install` once per clone (applies to that clone's worktrees too).
2. Never work directly on `main`.
3. Create a feature branch: `git switch -c codex/<short-task-name>`.
4. Keep changes focused to the requested task.
5. Before commit, run `npm run check`.
6. Commit with a clear message.
7. Push branch to `origin`.
8. Open/update PR with `npm run pr:create` and report the PR URL plus check results.

## Coding Rules

- Use strict TypeScript; avoid `any` and do not use `@ts-nocheck`.
- Do not mutate class prototypes or use prototype monkey patching patterns.
- Prefer explicit composition/inheritance and typed helpers.
- Add short comments only where logic is non-obvious.
- Avoid duplicate "V2" implementations; refactor shared helpers instead.

## Data Safety Rules

- Never commit personal or secret data.
- Real user data must stay in ignored local files:
  - `user-profile.local.md`
  - `PROJECT_CONTEXT.local.md`
  - `.env` or `.env.local`
  - `data/resumes/*.pdf`
- `user-profile.md` is a tracked template only.

## Shared Product Contracts

- Job status: `new`, `reviewing`, `ready`, `form-filling`, `form-ready`, `submitted`, `accepted`, `rejected`, `closed`
- Form-fill status: `pending`, `in-progress`, `completed`, `failed`, `awaiting-review`
- Resume choice: `student`, `experienced`
- Source: `new-grad`, `internship`
- Allowed transitions:
  - `new -> reviewing`
  - `reviewing -> ready`
  - `ready -> form-filling`
  - `form-filling -> form-ready`
  - `form-filling -> ready`
  - `form-ready -> submitted`
  - `submitted -> accepted`
  - `submitted -> rejected`
  - `submitted -> closed`
- Required Job fields: `company`, `role`, `location`, `applicationUrl`, `source`, `datePosted`
- API response shapes (initial):
  - `GET /api/jobs` -> `{ jobs: JobDTO[] }`
  - `GET /api/jobs/:id` -> `{ job: JobDTO | null }`
  - `PATCH /api/jobs/:id` -> `{ job: JobDTO }`
  - `GET /api/dashboard/stats` -> `{ total, pending, submitted, accepted, rejected }`
  - `POST /api/sync` -> `{ ok: boolean, startedAt: string }`

## Skills

- Repo skill: `.agents/skills/job-application-form-filler/SKILL.md`
- Use it for browser form-filling tasks.
- For profile data, prefer `user-profile.local.md` and fall back to `user-profile.md`.
- Never click final Submit in automated form fill flows; stop for user review.
