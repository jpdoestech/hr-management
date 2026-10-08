# Employee Relations Hardening: Phase K Stage-Aware Work Queues

Phase K gives Notifications, Action Center, and HR Operations one shared interpretation of Employee Relations work. It derives current actions from normalized case, intake, hearing, decision, and implementation records instead of creating another stored task record.

## Required setup

No new SQL migration is required.

1. Confirm the Employee Relations migrations already used by the deployment are installed. Phase 24 enables hearings and decisions, Phase 27 enables implementation tracking, and Phase 30 enables Reports & Intake.
2. Deploy the updated static application files.
3. Reload the HRIS with an account that can view Employee Relations records.
4. Review **Overview > Action Center**, the notification panel, and **Overview > HR Operations > Work Queues**.

The queue automatically degrades to the available schema. For example, a deployment without Phase 30 still receives case-stage work but does not show intake-triage items.

## Queue behavior

- Reports awaiting triage and reports needing more information are identified from Reports & Intake.
- Open cases receive one current-stage action, including investigation, NTE service, response follow-up, findings, decision, NOD service, implementation, and closure review.
- Scheduled hearings appear as dated due-process work.
- Decisions awaiting approval and Notices of Decision awaiting preparation, issue, or service use normalized decision data.
- Pending implementation records replace the generic implementation action and use their own deadline.
- Missing case ownership remains visible as a separate assignment action.
- Past deadlines and cases open for at least 30 days are prioritized as urgent.
- Stable queue identifiers prevent the same stage action from being repeated when a normalized child record provides better detail.

## Data and security

Phase K is read-only. It does not insert workflow tasks, send messages, update case stages, or modify attachments. Supabase RLS and effective-access scopes continue to determine which records each user can load. Direct links open the selected case; intake work opens the Reports & Intake workspace.
