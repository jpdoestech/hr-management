# Modal Typography

## Findings

Employee Edit used 11px input text and 9.5px labels. Overview used 10.5px record values and 8px labels. Status, Lifecycle and Transfer inherited generic 14px inputs and 11.5px labels. Address inputs separately used 11px, and Employee Relations entry labels separately used 10px. These overrides caused visible changes when switching transactions.

## Shared Scale

`css/professional.css` now defines scoped dialog typography tokens without changing dialog width or height:

| Element | Desktop / Tablet | Mobile (720px and below) |
| --- | --- | --- |
| Form values, including addresses | 14.3px (30% above Edit's 11px) | 16px |
| Overview record values | 13.65px (30% above 10.5px) | 16px |
| Labels | 12.35px | 12.35px |
| Supporting text | 12px | 12px |
| Section headings | 15px | 15px |
| Dialog heading | 19.5px | 19.5px |
| Transaction and detail tabs | 13px | 13px |

Labels have a readability floor rather than scaling tiny 8px labels by only 30%. Inputs use 16px on mobile to improve readability and avoid focus zoom. Long names and values wrap; navigation tabs wrap without covering detail tabs. Dialog dimensions, transaction handlers, validation, permissions and persistence remain unchanged.

## Verification

Automated tests cover the shared scale, unchanged dialog dimensions in the typography rules, and mobile rules. The synthetic browser harness measures actual computed fonts in Overview, Edit, Status, Lifecycle and Transfer, plus representative shared entry controls at mobile/tablet widths. It uses synthetic records and no Supabase calls; it is not a production authentication or save-flow test. Employee Status, Lifecycle, Transfer and Overview summary markup are extracted from the application; Edit and additional shared-form examples use representative existing classes.

Commit remark: `fix(ui): normalize modal typography and enlarge employee record text`.
