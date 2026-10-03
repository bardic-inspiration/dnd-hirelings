---
name: ask-me
description: Run a detailed conceptual interview to understand and refine the user's intent before planning or building. The gentler, understanding-first counterpart to grill-me's adversarial stress-test. Use when the user wants help figuring out what they actually want, is about to start a task where the goal or scope is still fuzzy, or uses trigger phrases like "ask me", "ask me about it", or invokes /ask-me directly.
---

# Ask Me

A conceptual interview for understanding **what the user wants and why**,
before any plan or design exists to stress-test. Where `grill-me` pressure-tests
a plan that already exists, `ask-me` comes first: it exists to *form* the
intent that a plan would later be built or grilled against.

## When to use this skill

- The user asks to be "asked about" an idea, task, or feature before it's built.
- A request arrives with a fuzzy or under-specified goal ("something like X",
  "not sure exactly how this should work") and getting it right matters more
  than moving fast.
- The user explicitly invokes `/ask-me` or says a trigger phrase like "ask me".

Do not use this skill for small, unambiguous asks (a one-line bug fix, a typo,
a clearly-scoped issue with acceptance criteria already written) — interviewing
someone about an obvious change wastes their time.

## How this differs from grilling

| | `ask-me` | `grill-me` |
|---|---|---|
| Timing | Before a plan exists | After a plan/design exists |
| Tone | Curious, exploratory | Skeptical, adversarial |
| Goal | Discover and sharpen intent | Find holes and failure modes |
| Question shape | "What matters to you here, and why?" | "What breaks if X happens?" |

If the user already has a concrete plan on the table and wants it pressure-tested,
prefer `grill-me` instead. If they're still deciding what to build,
use this skill.

## Process

1. **Read what's already there first.** Skim the request, any linked issue,
   and the docs it touches (`AGENTS.md`, plus the `SPEC.md` sections the
   issue cites) before asking anything — never ask a question the existing
   material already answers.

2. **Ask one question at a time.**
   - Ask **one question per turn**.
   - Offer 2–4 concrete, concise suggested answers the user can pick from,
     but make clear they can riff freely instead of choosing one verbatim.
   - Wait for the answer before asking the next question. Let earlier answers
     reshape later questions — this is an interview, not a fixed checklist.

3. **Interview at the conceptual level, not the implementation level.** Aim
   for roughly 5–10 questions, drawn from categories like:
   - **Purpose** — What problem does this solve? Who feels the pain today?
   - **Success** — What does "done and right" look like? How will you know
     it worked?
   - **Constraints** — What's fixed (invariants, hard rules, deadlines, compatibility)
     and what's actually negotiable?
   - **Scope** — What's explicitly *out* of scope, even if it's tempting to
     include?
   - **Priorities / tradeoffs** — If two things you want conflict (e.g.
     simplicity vs. flexibility), which wins?
   - **Precedent** — Is there an existing pattern in this codebase (or
     its docs) this should follow, or is this deliberately a departure?
   - **Risk** — What would make this the wrong call in hindsight?

   Skip categories already answered by context gathered in step 1. Tailor
   the actual wording to the specific request — don't recite this list
   verbatim to the user.

4. **Weave the answers together.** After the interview, synthesize the
   answers into a short, concrete statement of intent: the goal, the
   constraints, the explicit non-goals, and any open tradeoff the user
   resolved. Reflect it back to the user for a quick confirm/correct before
   treating it as settled.

5. **Hand off.** Once intent is confirmed, proceed into normal planning
   (`EnterPlanMode` if this is a substantial change) or implementation,
   scoped to what came out of the interview — not more, not less. If the
   resulting plan is complex enough to be worth stress-testing before it's
   built, offer `grill-me` as the next step rather than running it yourself.

## Notes for this repo

- Work here is done by memoryless sessions taking one issue at a time
  (`AGENTS.md` "Working loop"). When `ask-me` is used ahead of picking up an issue, keep
  the interview scoped to *that issue's* intent — it is not a license to plan
  ahead into later work.
- If the interview surfaces a genuinely separate concern (a bug, a missing
  detail in the docs, an idea for later), don't fold it into the current
  work — note it as a candidate for a new issue per
  `docs/workflow.md`.
