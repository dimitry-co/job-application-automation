---
name: job-application-form-filler
description: Navigate and auto-fill job/internship application forms via browser automation. Loads user data from user-profile.local.md (fallback user-profile.md). Never clicks Submit.
---

# Job Application Form Filler

Load all personal data from `user-profile.local.md` when present; otherwise use `user-profile.md`. Load the chosen resume PDF path from the profile's Resume Upload Strategy section.

**NEVER click Submit / Submit Application / Apply (final).** Stop and alert the user.

---

## Browser Connection

Before Step 0, connect to the user's already-running Chrome instance via CDP:

- Use `chromium.connectOverCDP()` with `CDP_ENDPOINT` from environment.
- If `CDP_ENDPOINT` is unset, default to `http://localhost:9222`.
- Do **NOT** launch a new browser process.
- Do **NOT** use headless mode.
- If CDP connection fails, stop and report:
  - `manualActionReason: "browser_not_running"`
  - message: `Chrome not running with remote debugging. Start Chrome with: --remote-debugging-port=9222`

---

## Step 0 — Bot-Protection & Landing Page

1. After navigating to the URL, wait 3-5 seconds for the page to settle.
2. Check for Cloudflare / bot-protection interstitials:
   - If you see "Verifying…", "Verify you are human", or a Turnstile/CAPTCHA widget, **stop immediately**. Set `manualActionRequired: true` with reason `security_verification`. Do NOT click the checkbox or inject scripts.
3. If no bot wall, proceed with landing page actions in priority order:
   - "Autofill with resume" → click, upload chosen resume PDF
   - "Sign in with Google" → use email from profile
   - Email + password login → use credentials from profile
   - Sign-up required → register with profile credentials → check email for verification → click link → sign in
   - "Apply" / "Start Application" → click to begin

---

## Step 1 — Section-by-Section Fill Strategy

Application forms are often long single-page forms. You MUST scroll through the entire page and fill every section. Do NOT try to fill only what is visible in the initial viewport.

### Scrolling Protocol

1. First, scroll the entire page top-to-bottom to inventory all sections.
2. Scroll back to the top.
3. Work through sections one at a time: fill all fields in the current viewport, then scroll down to the next section.
4. After reaching the bottom, scroll back to top for verification (Step 3).

### Section: Personal Information

Map these fields using the profile's **Personal Information** table:

| Form Label (common variants)      | Profile Field                                |
| --------------------------------- | -------------------------------------------- |
| First Name / Given Name           | First Name                                   |
| Last Name / Family Name / Surname | Last Name                                    |
| Preferred Name / Nickname         | Preferred Name (leave blank if not required) |
| Email / Email Address             | Email                                        |
| Phone / Phone Number / Mobile     | Phone Number                                 |
| Country / Country of Residence    | Country                                      |
| Address / Street Address          | Address Line 1                               |
| City                              | City                                         |
| State / Province                  | State                                        |
| Zip / Postal Code / ZIP Code      | Zip/Postal Code                              |
| Location (free text)              | Combine: "City, State"                       |

For each field:

- Click the field to focus it.
- Clear any pre-filled content first (Ctrl+A then type).
- Type the value from the profile.
- Tab out or click away to trigger validation.
- Confirm the value stuck (field should show the typed text).

---

### Handling Custom Dropdowns (Lever / Ashby / Greenhouse)

These platforms do NOT use standard `<select>` elements. Their dropdowns are custom React/JS components rendered as `<div>` containers. A standard "select option" approach will not work.

**How to identify them:** They look like text inputs or buttons with a chevron/arrow. Clicking them opens a floating list of options (often in a portal `<div>` outside the form).

**Fill protocol for custom dropdowns:**

1. **Click the dropdown trigger** — the element that looks like an input or has placeholder text like "Select…" or "Choose…". This opens the options panel.
2. **Wait 1-2 seconds** for the options list to render.
3. **Check if there's a search/filter input** inside the opened panel:
   - **If searchable:** Type a keyword to narrow results (e.g., "Bachelor" for degree, "Computer" for discipline, your university name for school). Wait 1-2 seconds for filtered results.
   - **If NOT searchable:** Scroll through the visible options list.
4. **Click the matching option text.** Match by visible label, not by value attribute.
5. **Verify** the dropdown trigger now shows the selected value (not the placeholder).
6. **If the dropdown closed but shows no selection**, the click may have missed. Re-open and try again.

**Common custom dropdown fields and what to type in the search:**

| Field                               | Search Keyword                      | Expected Match                                      |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------- |
| School / University                 | First word of school name           | Full school name                                    |
| Degree                              | "Bachelor" / "Master" / "Associate" | "Bachelor's degree" or similar                      |
| Discipline / Major / Field of Study | "Computer"                          | "Computer Science" or similar                       |
| Country                             | "United"                            | "United States"                                     |
| State                               | First letters of state name         | Full state name                                     |
| Gender                              | "Prefer" or "Decline"               | "Prefer not to answer" / "Decline to self-identify" |
| Race / Ethnicity                    | "Prefer" or "Decline"               | "Prefer not to answer" / "Decline to self-identify" |
| Veteran Status                      | "not a" or "am not"                 | "I am not a protected veteran"                      |
| Disability                          | "do not"                            | "I do not have a disability" / "No"                 |
| "How did you hear?" / Source        | "Glass" or "Linked"                 | "Glassdoor" / "LinkedIn" per profile preference     |

**If multiple matches appear**, pick the one that most closely matches the profile value. If no match exists, pick the most neutral/generic option.

**Date pickers:** Lever/Ashby often use month+year dropdowns or calendar widgets for dates:

1. If it's a month/year pair of dropdowns, open each and select the correct month and year.
2. If it's a calendar popup, navigate to the correct month/year and click the date.
3. If it's a free-text date input, type the date in the format the placeholder suggests (e.g., MM/YYYY, MM/DD/YYYY).

---

### Section: Resume / CV Upload

- Look for file upload inputs with labels like "Resume", "CV", "Resume/CV", or a drag-and-drop area.
- Upload the resume PDF from the path in the profile (`data/resumes/resume-student.pdf` or `data/resumes/resume-experienced.pdf`).
- Wait for the upload to complete (file name should appear).

### Section: Links / URLs

| Form Label                                 | Profile Field                     |
| ------------------------------------------ | --------------------------------- |
| LinkedIn / LinkedIn URL / LinkedIn Profile | LinkedIn URL                      |
| GitHub / GitHub URL / Portfolio            | GitHub URL                        |
| Website / Personal Website                 | GitHub URL (if no separate field) |

### Section: Education

Map using the profile's **Education** section. Use Education 1 (Current) as the primary entry.

| Form Label                                       | Profile Field                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| School / University / Institution                | School                                                                    |
| Degree / Degree Type                             | Degree                                                                    |
| Major / Field of Study / Discipline              | Field of Study                                                            |
| GPA                                              | GPA                                                                       |
| Graduation Date / Expected Graduation / End Date | Expected Graduation                                                       |
| Start Date                                       | Estimate: 4 years before graduation for Bachelor's, 2 years for Associate |

For Degree, Discipline, and School fields — these are almost always **custom dropdowns** on Lever/Ashby/Greenhouse. Follow the **Handling Custom Dropdowns** protocol above. Use the search keywords from that table.

If the form has an "Add another education" option AND the profile has Education 2, add it.

### Section: Work Experience

- If required, add one entry following the profile's **Work Experience** rules.
- Tailor the description to the role type. Keep to 40-60 words.
- If not required and no entry is pre-filled, skip.

### Section: Open-Ended / Text-Area Questions

Generate answers using the profile's **Open-Ended Question Templates** combined with the job description visible on the page.

| Question Pattern                                           | Strategy                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| "Why do you want to work here?" / "Why this company?"      | Use template; reference company mission from the job listing |
| "What makes you a strong fit?" / "Why should we hire you?" | Match resume skills/projects to listed requirements          |
| "How did you hear about us?" / "Source"                    | Use preference order from profile                            |
| Work description / "Describe your experience"              | Tailor to role type, use resume projects, 40-60 words        |
| Salary / Compensation expectations                         | Use listing range if given; otherwise reasonable estimate    |
| Schedule / Availability / "Can you commit?"                | Yes                                                          |
| "Long-term goals" / "Career goals"                         | Use template from profile                                    |

Rules:

- 20-60 words, simple professional language.
- Never fabricate experiences not in the resume/profile.
- If unsure about a question, use best judgment from profile data; skip only as last resort.

### Section: Work Authorization & Legal

Map using the profile's **Work Authorization & Legal** table. These are usually Yes/No radio buttons or dropdowns.

| Question Pattern                                 | Answer |
| ------------------------------------------------ | ------ |
| Legally authorized to work in the US?            | Yes    |
| Require visa sponsorship? (now or in the future) | No     |
| Relative works at the company?                   | No     |
| Referral? / Were you referred?                   | No     |
| Previously worked here?                          | No     |
| Current employee?                                | No     |

### Section: Voluntary Self-Identification (EEO / Demographics)

Map using the profile's **Demographics / EEO** table. These are always optional.

| Form Label       | Profile Value                                   |
| ---------------- | ----------------------------------------------- |
| Gender           | Prefer not to answer / Decline to self-identify |
| Race / Ethnicity | Prefer not to answer / Decline to self-identify |
| Veteran Status   | I am not a protected veteran                    |
| Disability       | I do not have any disabilities / No             |

For these sections: select the closest matching option. If exact text isn't available, pick the "decline" or "prefer not to answer" variant.

---

## Step 2 — Handle Multi-Page Forms

If the form has "Next" / "Continue" buttons instead of being single-page:

1. Fill all fields on the current page using the mappings above.
2. Screenshot the filled page → save to `artifacts/`.
3. Click "Next" / "Continue".
4. Wait for the next page to load (up to 5 seconds).
5. Repeat from Step 1 for the new page.
6. If you see "Submit" / "Submit Application" / "Apply" → **STOP. Do not click.**

---

## Step 3 — Post-Fill Verification

After filling all sections (or reaching the submit page):

1. Scroll from top to bottom of the page.
2. Check every field you filled — confirm it still holds the value you entered (some forms clear fields on blur or have validation that resets them).
3. Look for any required fields marked with `*` or red borders that are still empty.
4. If you find empty required fields, fill them now.
5. Screenshot each viewport section as you scroll → save all to `artifacts/`.

---

## Step 4 — Completion

1. Save all screenshots to `artifacts/` with descriptive names.
2. Record the final URL (the page where Submit is visible).
3. Return the JSON result. The user will review and click Submit manually.

---

## Errors

| Scenario                        | Action                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| Cloudflare / bot protection     | Stop immediately, report `security_verification`                     |
| CAPTCHA on the form itself      | Pause, report `captcha`                                              |
| Unsupported auth (SMS 2FA)      | Pause, report `two_factor_required`                                  |
| Login required, no credentials  | Stop, report `login_required`                                        |
| "Already applied"               | Stop, update status                                                  |
| "Position closed"               | Stop, update status                                                  |
| Page timeout (>10s no load)     | Retry once, then report                                              |
| Field not in profile            | Best judgment from resume + profile; leave blank only as last resort |
| Dropdown has no matching option | Pick the closest match; record deviation                             |
