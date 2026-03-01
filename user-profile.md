# User Profile Template

This tracked file is a sanitized template.
Use `user-profile.local.md` for real personal data (that file is ignored by git).
If both files exist, agents should prefer `user-profile.local.md` and fall back to this file.

## Authentication

| Field | Value |
|-------|-------|
| Email | candidate@example.com |
| Password | REPLACE_ME |
| Sign-in preference | Choose "Sign in with Gmail" when available; otherwise use email + password |

### Email Verification Flow
If an application portal requires email verification after sign-up:
1. Open the inbox for the email above
2. Find the verification email from the portal
3. Click the verification link
4. Return to the portal and sign in

## Personal Information

| Field | Value |
|-------|-------|
| First Name | FirstName |
| Last Name | LastName |
| Preferred Name | (leave blank unless needed) |
| Email | candidate@example.com |
| Phone Device | Mobile |
| Phone Number | 5550101234 |
| Phone Extension | 1 |
| Country | United States |

### Address

| Field | Value |
|-------|-------|
| Address Line 1 | 123 Example St |
| Address Line 2 | (leave blank) |
| City | New York |
| State | New York |
| Zip/Postal Code | 10001 |
| County | New York |

## Websites / Links

| Type | URL |
|------|-----|
| LinkedIn | https://www.linkedin.com/in/example |
| GitHub | https://github.com/example |

## Education

### Education 1 (Current)
| Field | Value |
|-------|-------|
| School | Example University |
| Degree | Bachelor's degree |
| Field of Study | Computer Science |
| GPA | 3.6 |
| Expected Graduation | June 2027 |

### Education 2 (Previous)
| Field | Value |
|-------|-------|
| School | Example College |
| Degree | Associate degree |
| Field of Study | Computer Systems |
| GPA | 3.7 |

## Work Experience

Add only one work experience entry and tailor it to the role.

### Rules for Job Description
- Keep it concise and clear
- Tailor based on role type (backend, frontend, full-stack, AI/ML)
- 40-60 words max
- Use projects from the selected resume

## Application Preferences

### "How did you hear about us?"
Choose in this order when available:
1. Glassdoor
2. LinkedIn
3. Corporate Website
4. Other -> "Simplify GitHub Repo"

### Resume Upload Strategy
- When portal offers "Autofill with resume" -> click it and upload chosen resume
- Resume files:
  - `data/resumes/resume-student.pdf`
  - `data/resumes/resume-experienced.pdf`

### Schedule / Availability
- "Can you commit to this schedule?" -> Yes

### Salary / Compensation
- If listing gives range, use that range
- Else use reasonable range for role/location

## Work Authorization & Legal

| Question | Answer |
|----------|--------|
| Legally authorized to work in the US? | Yes |
| Require visa sponsorship? | No |
| Relative works at the company? | No |
| Referral? | No |
| Previously worked at the company? | No |
| Current employee? | No |

## Demographics / EEO (Voluntary)

| Field | Value |
|-------|-------|
| Veteran Status | I am not a protected veteran |
| Gender | Prefer not to answer |
| Race/Ethnicity | Prefer not to answer |
| Disability | I do not have any disabilities |
| Employee ID | (leave blank) |

## Open-Ended Question Templates

### "Why do you want to work here?"
Keep it simple, around 40-60 words. Mention team collaboration, mission alignment, and growth.

### "What makes you a strong fit?"
Use resume skills/projects that match requirements. Keep it simple, around 40-60 words.

### "Long-term goals / How does this role contribute?"
Focus on gaining hands-on experience, growing as an engineer, and building strong fundamentals.

## Email Source (Simplify / SWE List)

| Field | Value |
|-------|-------|
| Sender | SWE List <noreply@swelist.com> |
| Mailing List | daily.mg.swelist.com |
| Mailed-by | mg.swelist.com |
| Subject pattern | "New Internships Posted Today" or similar |
