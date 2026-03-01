---
name: Job Application Form Filler
description: Navigate and auto-fill job/internship application forms via browser automation. Loads user data from user-profile.local.md (fallback user-profile.md). Never clicks Submit.
---

# Job Application Form Filler

Load all personal data from `user-profile.local.md` when present; otherwise use `user-profile.md`. Load the chosen resume PDF from the resume analyzer.

**NEVER click Submit / Submit Application / Apply (final).** Stop and alert the user.

---

## Landing Page

In priority order:
1. "Autofill with resume" → click, upload chosen resume PDF
2. "Sign in with Google" -> use email from the active profile file
3. Email + password login -> use credentials from the active profile file
4. Sign-up required → register with profile credentials → check email for verification → click link → sign in
5. "Apply" / "Start Application" → click to begin

---

## Form Fill Loop

Repeat per page:

1. Screenshot page → send to AI vision to identify fields
2. Map each field to active profile file data (`user-profile.local.md` or `user-profile.md`)
3. Fill:
   - Text inputs → type value
   - Dropdowns → select match (type to search if searchable)
   - File uploads → upload chosen resume PDF
   - Checkboxes/radios → select per profile preferences
   - Open-ended questions → generate answer (see below)
4. Screenshot filled page → save
5. "Next" / "Continue" → click, repeat | **"Submit" → STOP**

---

## Dynamic Answers

Generate from resume + job description. Keep to **20-60 words, simple language**.

- **Work description**: Tailor to job type (backend/frontend/full-stack/AI). Use resume projects. Concise.
- **"Why this company?"**: Use themes from the active profile templates. Reference company mission.
- **"Strong fit?"**: Match resume skills/projects to job requirements.
- **"How did you hear?"**: Use preference order from the active profile file.
- **Salary**: Use listing range if given, otherwise reasonable estimate.

---

## On Completion

1. Save all page screenshots
2. Record URL of the page with Submit button
3. Report link + screenshot carousel to dashboard
4. User reviews and clicks Submit

---

## Errors

| Scenario | Action |
|----------|--------|
| CAPTCHA | Pause, alert user |
| Unsupported auth (SMS 2FA) | Pause, alert user |
| "Already applied" | Stop, update status |
| "Position closed" | Stop, update status |
| Page timeout | Retry once, then alert |
| Unknown field | Best judgment from resume + profile; skip if unsure |
