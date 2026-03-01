# Contract Freeze v1

This file defines shared data contracts and status transitions for all implementation threads.

## Job Status
- `new`
- `reviewing`
- `ready`
- `form-filling`
- `form-ready`
- `submitted`
- `accepted`
- `rejected`
- `closed`

## Form Fill Status
- `pending`
- `in-progress`
- `completed`
- `failed`
- `awaiting-review`

## Resume Choice
- `student`
- `experienced`

## Source
- `new-grad`
- `internship`

## Status Transition Matrix
- `new -> reviewing`
- `reviewing -> ready`
- `ready -> form-filling`
- `form-filling -> form-ready`
- `form-filling -> ready`
- `form-ready -> submitted`
- `submitted -> accepted`
- `submitted -> rejected`
- `submitted -> closed`

## Required Job Fields
- `company`
- `role`
- `location`
- `applicationUrl`
- `source`
- `datePosted`

## API Shapes (initial)
- `GET /api/jobs` -> `{ jobs: JobDTO[] }`
- `GET /api/jobs/:id` -> `{ job: JobDTO | null }`
- `PATCH /api/jobs/:id` -> `{ job: JobDTO }`
- `GET /api/dashboard/stats` -> `{ total, pending, submitted, accepted, rejected }`
- `POST /api/sync` -> `{ ok: boolean, startedAt: string }`
