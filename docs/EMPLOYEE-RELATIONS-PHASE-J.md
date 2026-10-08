# Employee Relations Hardening: Phase J Controlled Revisions

Phase J adds an approval-only workflow for reopening terminal HR cases and amending approved decisions without deleting finalized records.

## Required setup

1. Confirm migrations through Phase 30 are installed.
2. Open **Supabase Dashboard > SQL Editor**.
3. Run `supabase/phase31-employee-relations-revisions.sql` in full.
4. Reload the HRIS.
5. Open an HR Case and use **Reopen / Amend** when authorized.

## Behavior

- Reopening a terminal case without an approved decision moves it to **Under Investigation**.
- Superseding or reversing an approved decision preserves that decision and its NOD metadata.
- Generated disciplinary history is marked **Superseded** or **Reversed**, never deleted.
- Pending or in-progress implementation work for the old decision is cancelled with the authorization reason; completed implementation evidence remains unchanged.
- A replacement decision is created as a new draft version and the case returns to **For Decision**.
- Every action requires `employee_relations.approve`, a written reason, tenant/scope access, and creates an immutable revision record plus case timeline entry.
- Cases with material linked or due-process records cannot be hard-deleted. Only empty early-stage case drafts remain eligible for authorized deletion.

## Data safety

The migration is additive and transaction-wrapped. It does not rewrite existing cases, decisions, NODs, history, implementation records, or attachments during deployment.
