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

### Employee Overview Layout

Overview uses an identity header (name and employee number) and one permission-gated navigation row. Full-width Personal Information, Emergency Information, Government IDs and Employment Details sections use compact left-aligned label/value rows with section dividers. Compensation and allowances sit side by side on desktop. Home and current addresses and calculated age are included in Overview; there is no separate Personal or Pay & IDs tab. IDs are masked initially; a keyboard-accessible toggle reveals and remasks the same four rows without recreating the form or duplicating identifiers. Separated employees retain Leaving Details. A single native progress indicator shows profile completeness. Larger record fonts and the existing dialog dimensions are preserved.

Edit follows Overview's group sequence: Personal Information (including addresses), Emergency Information, Government IDs, Employment Details, Compensation, Allowances, Remarks and Leaving Details. Editable fields follow the same sequence within each group; name inputs and the employee identifier are retained, while age and length of service remain calculated display values. Sections are full-width with two-column fields on desktop/tablet and single-column fields on mobile. Addresses retain their existing component, validation and mirroring behavior. Employment Type displays Regular and Status Reason displays Active; canonical stored values remain `Regular / Permanent` and `Active / Normal`, preserving existing imports, reporting and automatic regularization. No database migration is required.

The shared employee workspace keeps its action toolbar and detail tabs in a non-scrolling controls area. Only the accessible Employee record content region scrolls. Header and footer remain fixed within the existing modal dimensions. This shell is reused by Overview, Edit, Status, Lifecycle and Transfer. Scoped overlay padding avoids programmatic focus scrolling the entire modal on mobile.

Group-and-scroll verification: 355 tests passed; lint, build and structural validation passed. Synthetic browser checks at desktop, tablet and mobile widths verified wrapping and no horizontal overflow. Toolbar, tabs and footer coordinates remained unchanged during desktop scrolling; mobile Edit toolbar and footer coordinates remained unchanged after scrolling 2,718px. Address mirroring and persistence handlers were not changed.

The employee workspace now has one fixed navigation row: Overview, Edit, Transfer, Movement, History and Report ER Matter. Overview opens first, and actions retain their order on each transaction. Read-only users see Overview and History only. The second detail-tab row, separate Status button and More actions disclosure have been removed. Report ER Matter uses the same unsaved-change guard as other workspace navigation. Existing save/discard/cancel and return-to-employee handling is reused.

Movement merges Status and Lifecycle entry forms. Employment Status Change delegates to the existing status save path, preserving operational status/reason validation, leaving classifications, employment history, actor audit, save rollback and return navigation. Legacy Status links open this movement type automatically. Career milestones, regularization, promotion/position changes, returns, rehire and separation events remain available. Leaving fields appear only for separation-related movements. Existing records and database migrations are unchanged.

Unified-navigation verification: 360 tests passed; lint, build and structural validation passed. Synthetic browser checks covered the single navigation row, direct Edit-to-Transfer switching, conditional status/leaving fields and no horizontal overflow at 390px, 768px and 1440px. Save tests covered validated status changes, missing separation details, incompatible reasons, future dates and failed-save rollback. Production authenticated saves were not exercised.

Automated tests cover the shared scale, unchanged dialog dimensions in the typography rules, mobile rules, canonical select values, shortened display labels, masked identifiers and compensation in Overview. The synthetic browser harness now extracts the shared employee Edit renderer as well as Status, Lifecycle, Transfer and Overview markup. Address controls remain representative fixture controls. It uses synthetic records and no Supabase calls; it is not a production authentication or save-flow test.

Section-layout verification: 353 tests passed; lint, production build and structural validation passed. Browser checks at 390x844, 768x1024 and 1440x900 showed no horizontal overflow. Long synthetic addresses and email wrap on mobile. The identifier toggle was exercised with Enter and Space. No schema, authorization or Supabase configuration changes were made. Blood type, religion, education, emergency-contact address and monthly rate in the supplied mockup are not existing record fields and were not invented by this layout change.

Commit remark: `fix(ui): normalize modal typography and enlarge employee record text`.

Compact-layout commit remark: `fix(employees): compact overview and edit sections, consolidate pay details, and shorten display labels`.
