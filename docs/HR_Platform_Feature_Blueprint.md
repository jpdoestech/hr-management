# Complete HR Platform Feature Blueprint

## Project Direction

This document is the master feature roadmap for the SCPA HR Management / Employee Information platform.

The application should be developed as a **feature-based product roadmap** rather than treating every small enhancement as a separate phase.

Phases can still be used internally during implementation for safer incremental development, testing, and rollback. They do not need to be treated as separate product milestones.

---

# 1. Executive / HR Dashboard

## Core
- Total employees
- Active employees
- Newly hired employees
- Probationary employees
- Employees on leave
- AWOL employees
- Employees transferred
- Separated employees
- Open HR cases
- Overdue cases
- Pending HR actions
- Upcoming evaluations
- Upcoming deadlines
- Recent HR activities

## Advanced
- Workforce trend charts
- Headcount by department
- Headcount by employment status
- Gender distribution
- Employment-class distribution
- Monthly hiring/separation trend
- Case trend
- Disciplinary trend
- Leave trend
- Attendance exceptions
- Probation monitoring
- Department comparison

## Executive View
Management should be able to understand the current HR situation within a few seconds of opening the system.

---

# 2. Employee Master Data

## Personal Information
- Employee number
- Full name
- Birth date
- Gender
- Civil status
- Mobile number
- Personal email
- Address
- Emergency contact

## Employment Information
- Position
- Department
- Date hired
- Employment status
- Employment class
- Status effective date
- PRF number
- Supervisor
- Employment type
- Work location

## Employee History
- Previous positions
- Department transfers
- Promotions
- Demotions
- Status changes
- Evaluations
- Disciplinary history
- Leave history
- Attendance history
- HR cases
- Employment milestones

## Data Quality
- Missing required information
- Duplicate employee detection
- Invalid dates
- Incomplete records
- Conflicting employment status
- Missing required documents

---

# 3. Employee 360

Employee 360 should be one of the primary screens in the platform.

## Profile
- Personal information
- Employment summary
- Current status
- Department
- Position
- Tenure
- Probation status

## Connected Information
- Employment timeline
- Leave
- Attendance
- HR cases
- Incidents
- CVR
- Disciplinary actions
- NTE
- Memorandum
- NOD
- Evaluations
- Transfers
- On-call records
- Documents
- Audit/activity history

## Quick Actions
- New Case
- New Incident
- New CVR
- New NTE
- New Memo
- New NOD
- New Disciplinary Action
- New Leave
- New Evaluation
- Update Status
- Transfer Employee
- View Documents

---

# 4. Employee Lifecycle Management

## Hiring
- Applicant-to-employee conversion
- Employee number generation
- Hiring date
- Position
- Department
- PRF
- Initial documents
- Initial status

## Onboarding
- Required documents
- Onboarding checklist
- Orientation
- Policy acknowledgment
- Account/setup checklist
- Completion tracking

## Probation
- Probation start
- Probation end
- 30-day evaluation
- 90-day evaluation
- 180-day evaluation
- Evaluation reminders
- Regularization recommendation
- Extension
- Probation failure
- Regularization

## Employment Changes
- Promotion
- Demotion
- Transfer
- Status change
- Department change
- Position change

## Separation
- Resignation
- Termination
- End of contract
- Retirement
- Other separation
- Effective date
- Exit checklist
- Clearance
- Document completion

---

# 5. HR Case Management

HR cases should act as the central container for employee-relations work.

## Case Creation
- Case number
- Employee
- Department
- Subject
- Description
- Priority
- Status
- Assigned HR personnel
- Open date
- Due date
- Remarks

## Case Workflow
Example:

`Open -> Under Review -> NTE Issued -> Investigation -> Decision -> Closed`

## Capabilities
- Case assignment
- Priority
- Deadlines
- Case notes
- Internal comments
- Activity timeline
- Linked records
- Related employees
- Attachments
- Case history
- Reassignment
- Closing reason
- Reopening

## Linked Records
- Incident Report
- CVR
- NTE
- Memorandum
- NOD
- Disciplinary Action
- ATD
- Leave
- Other HR documents

---

# 6. Employee Relations & Disciplinary Management

## Incident Reports
- Incident number
- Employee
- Incident date
- Location
- Description
- Witnesses
- Reporter
- Status
- Attachments

## CVR
- Employee
- Violation
- Incident
- Quotations/repair information
- Amount involved
- Supporting documents
- Status
- Remarks

## NTE
- Reference number
- Employee
- Case
- Allegation
- Date issued
- Response deadline
- Employee response
- Response date
- Status

## Memorandum
- Memo number
- Employee
- Case
- Subject
- Content
- Date issued
- Acknowledgment

## NOD
- Decision number
- Employee
- Case
- Findings
- Decision
- Effective date
- Remarks

## Disciplinary Action
- Violation
- Date
- Action
- Duration
- Effective date
- Case
- Supporting document

## Offense Catalog
- Offense
- Category
- First offense consequence
- Second offense consequence
- Third offense consequence
- Fourth offense consequence

---

# 7. Leave Management

## Leave Records
- Employee
- Leave type
- Start date
- End date
- Days
- Reason
- Application date
- Date received
- Approval status
- Remarks
- Attachment

## Workflow
`Filed -> Under Review -> Approved / Rejected -> Ongoing -> Completed`

## Advanced
- Leave balances
- Leave entitlement
- Leave utilization
- Department leave calendar
- Leave conflict detection
- Overlapping leave detection
- Approval workflow
- Leave reporting

---

# 8. Attendance / ATD Monitoring

## Core
- Employee
- Attendance period
- Attendance dates
- Cutoff
- Attendance issue
- Supporting documents
- Status
- Remarks

## Advanced
- Absence tracking
- Tardiness
- Undertime
- AWOL
- Missing attendance
- Attendance exceptions
- Monthly summaries
- Department trends
- Employee attendance history

## Payroll-Related Information
The ATD area can retain payment/cutoff information if required, while full payroll calculation remains a separate future system unless explicitly needed.

---

# 9. On-Call Management

## Records
- Employee
- Assignment date
- Location
- Schedule
- Duty type
- Status
- Remarks

## Analytics
- On-call frequency
- Employee utilization
- Department utilization
- Schedule history

---

# 10. Department Transfer Management

## Workflow
`Requested -> Reviewed -> Approved -> Effective -> Completed`

## Data
- Employee
- Current department
- New department
- Current position
- New position
- Requested date
- Effective date
- Reason
- Approver
- Remarks

## Automatic Effects
When completed:
- Update employee department
- Update employee history
- Preserve previous assignment
- Record new assignment

---

# 11. Performance & Evaluation

## Evaluation Types
- 30-day
- 90-day
- 180-day
- Regularization
- Performance evaluation
- Other HR evaluation

## Evaluation Structure
- Employee
- Evaluator
- Evaluation period
- Criteria
- Rating
- Strengths
- Areas for improvement
- Recommendation
- Overall result
- Remarks

## Advanced
- Evaluation reminders
- Overdue evaluations
- Department analysis
- Evaluation history
- Improvement tracking

---

# 12. PRF / Personnel Request

## PRF Data
- PRF number
- Requested position
- Department
- Requestor
- Reason
- Replacement/new position
- Date requested
- Approval
- Status
- Remarks

## Future Workflow
`Draft -> Submitted -> Reviewed -> Approved -> Recruiting -> Filled -> Closed`

---

# 13. Document Management

Document storage should eventually use Google Drive as the file store, while Supabase stores appropriate metadata and secure references.

## Employee Documents
- Government IDs
- Contracts
- Certificates
- Medical documents
- Evaluations
- HR forms

## Case Documents
- Incident reports
- NTE
- Memorandum
- NOD
- Supporting evidence
- Quotations
- Statements

## Document Metadata
- Document type
- Employee
- Case
- Date
- Expiration date
- Uploaded by
- Status

## Advanced
- Expiration alerts
- Missing-document alerts
- Document versioning
- Document categories
- Search
- Preview
- Access control
- Document audit trail

## Google Drive Architecture
Conceptual structure:

`HR Platform`
- Employee folders
- Employee Documents
- Cases
- Case Documents
- HR Templates
- Organizational Documents

Supabase should hold metadata/relationships rather than becoming the main file-storage layer.

---

# 14. Notifications & Alerts

## Notification Types
- New case assigned
- Case due soon
- Case overdue
- Unassigned case
- NTE deadline
- Evaluation due
- Probation ending
- Missing documents
- Leave awaiting action
- Incident awaiting review
- Pending approval
- Transfer pending
- Employee status event

## Notification Center
- Unread count
- Read/unread
- Timestamp
- Priority
- Related module
- Direct navigation
- Mark read
- Mark all read

## Future
- Email notifications
- Scheduled reminders
- Escalations
- Supervisor notifications

---

# 15. HR Action Center

Action Center should present HR work as tasks rather than forcing users to search each module.

## Today's Work
- Cases due today
- NTE deadlines
- Evaluations due
- Leaves awaiting review
- Incidents awaiting action
- Transfers awaiting approval

## Overdue
- Overdue cases
- Overdue evaluations
- Missed deadlines

## Assigned to Me
- Cases
- Employee actions
- Reviews
- Approvals

---

# 16. HR Operations Workspace

A central HR cockpit for employee-centric work.

## Employee Summary
- Current status
- Department
- Position
- Tenure
- Probation status

## Open Work
- Cases
- Leave
- Incidents
- Evaluations
- Transfers
- ATD issues

## Quick Actions
- Create case
- Create incident
- Issue NTE
- Create memo
- Create NOD
- Record discipline
- Update status
- Transfer employee
- Add leave
- Add evaluation

---

# 17. Management Analytics

## Workforce
- Headcount
- New hires
- Separations
- Transfers
- Status distribution
- Department distribution
- Tenure distribution

## Employee Relations
- Open cases
- Case aging
- Cases by department
- Cases by priority
- Cases by category
- Disciplinary actions

## Leave
- Leave volume
- Leave by department
- Leave type distribution

## Attendance
- AWOL
- Absences
- Attendance exceptions

## Probation
- Upcoming evaluations
- Overdue evaluations
- Probation outcomes

## Lifecycle
- New hires
- Regularized employees
- Transfers
- Separations

---

# 18. Advanced HR Reports

## Employee Reports
- Employee master list
- Employee directory
- Employee status report
- Department employee list

## Case Reports
- Case register
- Open cases
- Closed cases
- Overdue cases
- Case aging

## Discipline Reports
- Disciplinary register
- Violations by employee
- Violations by department
- Action history

## Leave Reports
- Leave register
- Leave utilization
- Leave by employee
- Leave by department

## Lifecycle Reports
- New hires
- Probationary employees
- Regularization
- Transfers
- Separations

## Management Reports
- Workforce report
- HR activity report
- Monthly HR report
- Quarterly HR report
- Annual HR report

## Output
- PDF
- Excel
- CSV
- Print
- Scheduled report

---

# 19. User Management

## Users
- User account
- Full name
- Username
- Email
- Role
- Status
- Created date
- Last login

## Current Roles
- Administrator
- HR Staff
- Viewer

## Future Roles
- HR Manager
- Department Head
- Supervisor
- Investigator
- Management
- Auditor

---

# 20. Security & Permissions

The long-term model should be more granular than only showing/hiding whole modules.

## Permissions
- View employees
- Create employees
- Edit employees
- Delete employees
- View cases
- Create cases
- Assign cases
- Close cases
- View disciplinary records
- Create disciplinary records
- Approve leave
- View documents
- Upload documents
- Delete documents
- View reports
- Export reports
- Manage users
- Manage settings

## Data-Level Security
Concept:

`User -> Role -> Permission -> Module -> Record`

This can later support department-level restrictions.

---

# 21. Audit Trail

## Audit Events
- Created
- Updated
- Deleted
- Status changed
- Assignment changed
- Case linked
- Document uploaded
- Document deleted
- User created
- Permission changed
- Record exported

## Audit Information
- User
- Timestamp
- Module
- Record
- Action
- Previous value
- New value
- Relevant device/IP information where appropriate and supported

---

# 22. Data Quality & Governance

## Automatic Checks
- Duplicate employee
- Missing employee information
- Missing required documents
- Invalid status
- Invalid dates
- Employee without department
- Employee without position
- Expired documents
- Missing evaluations
- Inconsistent lifecycle dates

## Data Health Dashboard
Example indicators:
- Employee completeness
- Document completeness
- Evaluation completeness
- Records requiring attention

---

# 23. Workflow Automation

This is one of the biggest future upgrades.

## General Workflow Model
`Event -> Rule -> Task -> Notification -> Deadline -> Escalation -> Audit Log`

## Example: Probation
Employee reaches a milestone:

`Detect milestone`
-> Create evaluation task
-> Assign evaluator
-> Notify evaluator
-> Track deadline
-> Record evaluation
-> HR review
-> Update lifecycle

## Example: Employee Relations Case
`Incident`
-> Case created
-> Investigator assigned
-> NTE deadline calculated
-> Notification created
-> NTE issued
-> Response recorded
-> Case progresses
-> Decision required
-> NOD recorded
-> Case closed

---

# 24. Approval Engine

## Approval Workflows
- Leave
- Employee status change
- Department transfer
- PRF
- Disciplinary action
- NOD
- Document approval
- Other HR requests

## Approval Chain
Example:

`Employee / HR Staff -> Supervisor -> HR -> Management`

The exact hierarchy should eventually be configurable.

---

# 25. Template & Letter Generation

## Templates
- NTE
- Memorandum
- NOD
- Employment documents
- Evaluation forms
- HR notices
- Internal letters

## Automatic Data Insertion
Templates can pull:
- Employee name
- Employee number
- Position
- Department
- Case number
- Incident date
- Other relevant record data

This reduces repetitive HR data entry.

---

# 26. Search & Global Navigation

## Global Search
Search across:
- Employee
- Employee number
- Case number
- Incident number
- NTE number
- Memo number
- NOD number
- Department
- Document
- Date

Example:

Search `Bryan Torres`

Results can include:
- Employee profile
- Cases
- Incidents
- NTE
- Disciplinary actions
- Leave
- Documents
- Evaluations

---

# 27. Calendar & Timeline

## HR Calendar
- Leave
- Evaluations
- Probation dates
- Case deadlines
- NTE deadlines
- Transfers
- On-call assignments
- HR activities

## Employee Timeline
Example:

`Hired`
-> `Probation`
-> `Evaluation`
-> `Transfer`
-> `Incident`
-> `NTE`
-> `Disciplinary Action`

---

# 28. Organization Management

## Configuration
- Departments
- Positions
- Employment types
- Employment statuses
- Leave types
- Case categories
- Offense categories
- Evaluation types
- Document types

## Organization Structure
Concept:

`Company`
-> Department
-> Team
-> Supervisor
-> Employees

This improves reporting and permissions.

---

# 29. System Settings

## Organization
- Company name
- Logo
- Address
- Contact information

## HR Rules
- Probation period
- Evaluation schedule
- Leave types
- Case priorities
- Case statuses

## System
- Date format
- Notification settings
- Numbering formats
- Document categories
- Report settings

---

# 30. Mobile / Responsive HR

The platform should support:
- Desktop
- Laptop
- Tablet
- Mobile

## Mobile Priorities
- Employee search
- Employee 360
- Notifications
- Action Center
- Cases
- Approvals
- Leave
- Quick actions

Heavy administrative forms can remain desktop-oriented.

---

# 31. Dashboard Personalization

## HR Staff
Focus on:
- My Cases
- Pending Actions
- Employees
- Notifications

## HR Manager
Focus on:
- Workforce
- Cases
- Discipline
- Probation
- Analytics

## Management
Focus on:
- Headcount
- Trends
- HR Metrics
- Reports

---

# 32. Integration Layer

Potential integrations:

## Storage
- Google Drive

## Authentication / Database
- Supabase Auth
- Supabase PostgreSQL

## Communication
- Email service
- Application notifications

## Calendar
- Google Calendar (potential future integration)

## External HR Systems
- Payroll
- Attendance / biometric systems
- Other internal systems

Integrations should be introduced only when the business requirement exists.

---

# 33. Advanced Analytics / HR Intelligence

## Metrics
- Employee turnover
- Average tenure
- Department movement
- Case resolution time
- Disciplinary frequency
- Leave utilization
- Probation outcomes
- Hiring activity
- Separation patterns

## Trends
Historical reporting should support:

`January -> February -> March -> April`

rather than only showing the current snapshot.

---

# 34. AI-Assisted HR Features

AI should remain an optional assistance layer.

Potential uses:
- HR natural-language search
- Case summarization
- Employee timeline summarization
- Management report drafting
- HR document data extraction
- Data-quality assistance

The system should assist authorized users with organizing and presenting HR information rather than making official HR decisions.

---

# 35. Enterprise-Level Features

Potential future capabilities:
- Multi-company support
- Multi-branch support
- Advanced organization hierarchy
- Granular permissions
- SSO
- Advanced audit/compliance controls
- Backup/recovery tooling
- Public/private API
- Webhooks
- Scheduled background jobs
- Enterprise reporting
- External system integrations

---

# Recommended Navigation Structure

Instead of putting every function at the top level, consolidate the platform into major groups.

## Overview
- Dashboard
- Action Center
- HR Operations
- Management Analytics
- Reports

## People
- Employees
- Employee 360
- Lifecycle
- Evaluations
- Transfers

## Attendance & Leave
- Leave
- Attendance / ATD
- On-Call

## Employee Relations
- HR Cases
- Incidents
- CVR
- NTE
- Memorandum
- NOD
- Disciplinary Action
- Offense Catalog

## Documents
- Document Center
- Employee Documents
- Case Documents
- Templates

## Administration
- User Management
- Departments / Organization
- Settings
- Audit Logs

---

# Product Maturity Levels

## CORE HR PLATFORM

- Employee Master Data
- Employee 360
- Employee Lifecycle
- Leave
- Attendance / ATD
- HR Cases
- Incidents
- CVR
- NTE
- Memorandum
- NOD
- Disciplinary Action
- Evaluations
- Transfers
- PRF
- Offense Catalog
- HR Operations
- Action Center
- Notifications
- User Roles
- Audit Trail
- Reports
- Dashboard

## ADVANCED HR PLATFORM

- Workflow Automation
- Approval Engine
- Automated Reminders
- Advanced Employee 360
- Advanced Analytics
- Data Quality Center
- Global Search
- HR Calendar
- Document Expiration Management
- Document Templates
- Automatic HR document generation
- Google Drive integration
- Personalized dashboards
- Scheduled reports
- Email notifications

## ENTERPRISE HR PLATFORM

- Multi-company
- Multi-branch
- Advanced organization hierarchy
- Granular permissions
- SSO
- External system integrations
- Attendance-device integration
- Payroll integration
- API
- Webhooks
- Scheduled background processing
- Advanced audit/compliance
- AI-assisted HR workflows

---

# Architecture Target

Conceptually:

```text
                    MANAGEMENT
                Dashboard / Reports
                         |
                         v
                 +------------------+
                 |   HR PLATFORM    |
                 |------------------|
                 | Employee Mgmt    |
                 | Employee 360     |
                 | Lifecycle        |
                 | Leave / ATD       |
                 | Cases / Discipline|
                 | Evaluations      |
                 | Documents        |
                 | Tasks / Alerts   |
                 | Reports / Metrics|
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | WORKFLOW ENGINE  |
                 | Tasks             |
                 | Approvals         |
                 | Rules             |
                 | Deadlines         |
                 | Escalations       |
                 +--------+---------+
                          |
             +------------+-------------+
             |            |             |
             v            v             v
        Supabase      Google Drive   External APIs
        Auth/DB       File Storage   Payroll/ATD/etc.
```

The most important architectural relationship is:

**Employee + Case + Workflow + Document + Notification**

These should become interconnected instead of acting like isolated modules.

---

# Current Project Direction

The current application already has a substantial Core HR foundation, including:
- Employee master data
- Employee 360
- Employment lifecycle
- Leave / attendance-related functions
- HR case management and case intelligence
- Disciplinary workflow
- Analytics and reporting
- User roles
- HR Operations
- Notifications

The next major improvements should therefore focus on **platform-level capabilities** rather than repeatedly adding tiny standalone modules.

---

# Recommended Next Development Priorities

## Next Major Feature: Workflow & Approval Engine

Recommended as the next substantial build after Notifications.

### Why
Notifications tell users **what needs attention**.

A workflow/approval engine determines:
- What needs to happen
- Who must do it
- When it is due
- What status follows
- What happens next
- When escalation occurs

### First workflows to support
1. Leave approval
2. Department transfer approval
3. Employee status change
4. PRF approval
5. Evaluation workflow
6. HR case workflow
7. Disciplinary/NOD workflow

### Result
The platform moves from:

`Records -> Notifications`

to:

`Records -> Workflow -> Tasks -> Notifications -> Approvals -> Audit Trail`

That is a major capability increase and creates a foundation for later automation.

---

# Suggested Development Order From Here

### Current
**Phase 12 — Notifications & Alerts**
- Notification center
- Unread alerts
- Due/overdue alerts
- Assignment alerts
- Reminder logic

### Next
**Workflow & Approval Engine**
- Task model
- Assignments
- Approval states
- Approval history
- Deadlines
- Escalation
- Workflow-aware notifications

### After That
**Google Drive Document Architecture**
- Employee folders
- Case folders
- Document metadata
- Secure links
- Upload/preview workflow
- Document permissions
- Expiration tracking

### Then
**Advanced Reports & Analytics**
- Historical trends
- Management reports
- Case aging
- Workforce analytics
- Lifecycle analytics

### Then
**Data Quality Center**
- Missing fields
- Duplicate detection
- Missing documents
- Data health dashboard

### Then
**Automation Layer**
- Scheduled jobs
- Automatic reminders
- Recurring HR tasks
- Automated lifecycle events

### Then
**Advanced Security & Organization**
- Granular permissions
- Organization hierarchy
- Department-level access
- Advanced audit controls

### Later
**Enterprise / Integration / AI**
- External APIs
- Payroll / attendance integration
- SSO
- AI-assisted workflows
- Multi-company / multi-branch

---

# Product Philosophy

The end goal is not a collection of HR pages.

The end goal is:

**A connected HR operating system**

where an employee record is connected to their:
- employment lifecycle
- cases
- incidents
- disciplinary history
- attendance
- leave
- evaluations
- documents
- workflows
- approvals
- notifications
- reports

and where HR staff can move from **information -> action -> workflow -> completion -> audit** without leaving the platform.

---

# Feature Selection Checklist

Use this section as a future planning checklist.

## Core
- [ ] Employee Management
- [ ] Employee 360
- [ ] Lifecycle
- [ ] Leave
- [ ] Attendance
- [ ] Cases
- [ ] Discipline
- [ ] Evaluations
- [ ] Transfers
- [ ] PRF
- [ ] Documents
- [ ] Reports
- [ ] Analytics
- [ ] Action Center
- [ ] Notifications
- [ ] User Management
- [ ] Audit

## Advanced
- [ ] Workflow Engine
- [ ] Approval Engine
- [ ] Automation
- [ ] Global Search
- [ ] Calendar
- [ ] Data Quality
- [ ] Document Automation
- [ ] Google Drive
- [ ] Advanced Analytics
- [ ] Scheduled Reports
- [ ] Email Notifications

## Enterprise
- [ ] Granular Permissions
- [ ] Organization Hierarchy
- [ ] Multi-company
- [ ] Multi-branch
- [ ] SSO
- [ ] API
- [ ] Webhooks
- [ ] Payroll Integration
- [ ] Attendance Integration
- [ ] Advanced Compliance
- [ ] AI Assistance
