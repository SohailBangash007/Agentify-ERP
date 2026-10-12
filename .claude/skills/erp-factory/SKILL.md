---
name: erp-factory
description: Build or modify an ERP using the ERP-Factory knowledge base extracted from Agentify ERP — design system (typography, colours, accents, dark mode, components), architecture, accounting/posting rules, RBAC, multi-tenancy, sync patterns, module catalog and the new-ERP build playbook. Use whenever the task is to start a new ERP, add an ERP module or screen, restyle an ERP UI, design its schema or accounting, or review ERP code against house standards.
---

# ERP-Factory skill

The authoritative material lives in `erp-factory/` at the repository root. This skill is the router; do not duplicate content here.

## Procedure

1. Read `erp-factory/README.md` (folder map) and `CLAUDE.md` (non-negotiables).
2. Classify the task and read **only** the matching files:

| Task | Read |
|---|---|
| New client ERP | `standards/51-new-erp-build-playbook.md` → `templates/new-erp-brief.md` → `modules/40-module-catalog.md` |
| New module / feature | `templates/module-spec.md`, `architecture/10`, `11`, `12`, `data/20`, (money) `data/21`, `standards/52-checklists.md` |
| UI / styling / component | `design/01…06`, `tokens/design-tokens.css` |
| Auth, roles, tenancy, billing | `architecture/13` |
| Integration, webhook, offline, push | `sync/30-sync-and-integration-patterns.md` |
| Review / audit a diff | `standards/50-engineering-standards.md`, `standards/52-checklists.md`, known defects in `00-AUDIT-SUMMARY.md` |

3. Open the reference source named in the doc (paths are given) and copy/adapt rather than re-inventing.
4. Do not copy the **known reference defects** listed in `erp-factory/00-AUDIT-SUMMARY.md`.
5. After UI token changes run `node erp-factory/tools/check-token-drift.mjs` (or with `--target <project>/client/src/tokens.css`).
6. Before finishing, walk the Definition of Done in `standards/52-checklists.md` and report any item not met.

## Output expectations

* State which factory files you applied and any deliberate deviation (record it in the project's `DECISIONS.md`).
* Run the project's tests/build; report failures verbatim.
