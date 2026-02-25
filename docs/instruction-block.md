Here’s the instruction block (copy/paste exactly):
VOS Dev Build — Source of Truth Instruction
Use the uploaded PDFs as the single source of truth for the MVP.
Core rules:
1.	E&M (S11) is the master data source of truth for equipment types/instances and meter/state definitions.
2.	D02 is seed data for the Global Library (30–60m equipment types + counts + criticality defaults).
3.	D03 defines the unified dataset template engine. Treat dataset templates as field-definition templates, not separate bespoke schemas.
4.	Daily Log (S06) stores readings as equipment_id + field_id + timestamp with source/context_id. Widgets are generated from log_enabled fields.
5.	Defects (S01) can only create WO Requested. S02 decides/classifies and opens WOs/Tasks.
6.	WOT Reports (S03) finalize work; closed work stays “report pending” until report submitted; unresolved chains create linked follow-on WOs.
7.	Archive (S08) stores immutable records, evidence, packs, accounting rollups, activities log, compliance records, and sea service records.
8.	Prefer cached rollups for DOS (S07) performance widgets (don’t recompute heavy aggregations on every load).
Output format I want from you:
•	(A) Database schema (tables + key fields + relationships)
•	(B) API endpoints list (by screen)
•	(C) MVP build order / backlog tickets (Week 1–2)
•	(D) Seed scripts for D02 library + D03 template mappings
Ask clarifying questions only if absolutely required; otherwise make sensible assumptions consistent with the specs.
