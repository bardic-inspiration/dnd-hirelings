---
name: grill-me
description: Relentlessly stress-test an existing plan or design by interviewing the user about its failure modes, edge cases, and weak assumptions. The adversarial, plan-already-exists counterpart to ask-me's intent-forming interview. Use when the user wants a plan, design, or approach pressure-tested before building it, or uses trigger phrases like "grill me" or invokes /grill-me directly.
---

# Grill Me

A relentless interview for **finding the holes in a plan that already exists**.
Where `ask-me` comes first to discover and sharpen intent, `grill-me` comes
after: it exists to break a concrete plan before reality does.

## When to use this skill

- The user has a plan, design, or approach in hand and wants it pressure-tested
  before implementation starts.
- A plan looks plausible on its face but hasn't been checked against edge
  cases, hard rules, or the parts of the docs it touches.
- The user explicitly invokes `/grill-me` or says a trigger phrase like
  "grill me".

Do not use this skill when there's no plan yet to grill — a fuzzy or
unformed idea should go through `ask-me` first. Grilling an idea
that hasn't been shaped yet just produces noise; grill the plan once it
exists.

## How this differs from asking

| | `grill-me` | `ask-me` |
|---|---|---|
| Timing | After a plan/design exists | Before a plan exists |
| Tone | Skeptical, adversarial | Curious, exploratory |
| Goal | Find holes and failure modes | Discover and sharpen intent |
| Question shape | "What breaks if X happens?" | "What matters to you here, and why?" |

If the user is still deciding *what* to build, prefer `ask-me`
instead. If the shape of the thing is already decided and the question is
whether it survives contact with reality, use this skill.

## Process

1. **Read the plan and its context first.** Understand exactly what is being
   proposed, and read the parts of `SPEC.md` and `AGENTS.md` it touches —
   especially the invariants (`SPEC.md`) and hard rules (`AGENTS.md`) —
   before
   attacking it. A challenge that ignores an already-stated constraint just
   wastes the user's time.

2. **Ask one hard question at a time.**
   - Ask **one question per turn**.
   - Where useful, offer 2–4 concrete answer shapes the user can pick from
     or riff on, but the point of a grill is to make them think, not to make
     picking easy — don't soften a question just to fit a tidy option list.
   - Wait for the answer before moving to the next question. Let a weak
     answer draw a sharper follow-up on the same point rather than moving on.

3. **Interview at the level of concrete failure, not vibes.** Aim for
   roughly 5–10 questions, drawn from categories like:
   - **Edge cases** — What's the smallest/largest/emptiest/most malformed
     input this has to survive? What happens at zero, one, and "too many"?
   - **Invariant checks** — Does this plan hold every invariant and hard rule
     the project requires, or does it quietly assume one away?
   - **Failure modes** — What's the first thing that breaks under load, bad
     data, or a step done out of order? How would you *know* it broke?
   - **Assumptions** — What is this plan silently assuming about the caller,
     the data, or the environment that might not hold?
   - **Reversibility** — If this turns out wrong after it ships, how costly
     is it to undo or change?
   - **Alternatives** — What's the next-best approach that was rejected, and
     why does this one actually beat it rather than just being first to mind?
   - **Blast radius** — What else in the codebase (or its docs)
     does this plan touch or constrain that isn't obvious from the plan
     itself?

   Skip categories the plan already addresses explicitly and correctly.
   Tailor wording to the specific plan — don't recite this list verbatim.

4. **Press on weak answers.** If an answer is hand-wavy ("that shouldn't
   happen", "we'll deal with it later"), don't accept it and move on — ask
   what makes that true, or what the cost is if it's wrong. The goal is a
   plan that's actually been tested, not one that's survived polite
   questions.

5. **Summarize the damage.** After the interview, list concretely what
   changed or firmed up as a result: which assumptions got confirmed, which
   got revised, and which gaps are still open and need a decision before
   building. Don't declare the plan "sound" — report what it survived and
   what it didn't.

6. **Hand off.** Once the plan has been sharpened (or the user decides an
   open gap needs to go back to `ask-me` because the *intent* underneath it
   was never actually settled), proceed into implementation scoped to the
   sharpened plan — not a larger rewrite prompted by the grilling itself.

## Notes for this repo

- Work here is done by memoryless sessions taking one issue at a time
  (`AGENTS.md` "Working loop"). Grill the plan for *that* issue's acceptance criteria — a
  grilling session is not license to expand scope into later work, even when
  the interview surfaces a legitimately good idea for it.
- If grilling surfaces a real gap outside the current issue's scope (an
  ambiguity in the docs, a missing hard-rule test, an idea for later), don't
  fold it into the current plan — file it per `docs/workflow.md`
  instead.
