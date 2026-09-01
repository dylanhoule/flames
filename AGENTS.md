# Documentation Rules

These are two separate rules. Do not merge them: rule 1 is one file per new code file; rule 2 is one file per distinct library/math concept, created once and reused.

## 1. Per-file companion markdown

Whenever you create a new code file, also create a sibling markdown file explaining it.

- Naming: `<filename>.md` next to `<filename>.<ext>` (e.g. `parser.py` -> `parser.md`), same directory.
- Content: one or two sentences on what the code does, plus a list of the libraries/packages it imports with a one-line purpose for each.
- Scope: only applies to files you create going forward. Do not retroactively backfill existing files unless asked.

## 2. Per-library/math reference markdown

For every distinct library or nontrivial math/algorithm used anywhere in the project, maintain one reference markdown file explaining it.

- Location: `context/learning/`, one file per library or concept, named after it (e.g. `context/learning/numpy.md`, `context/learning/rate-of-spread-model.md`).
- Deduplicated: one file per library/concept for the whole project, not per file that uses it. Before creating one, check whether it already exists in `context/learning/`; if it does, leave it (update it only if the usage changed materially).
- Content: what the library/math is, why it's used in this project, and an explanation of the relevant concept or API surface being used. Since this project follows wildland fire physics and needs the math double-checked, these files should be precise enough to support that verification.
