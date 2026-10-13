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

Overview uses an identity header (name and employee number), an Overview/Personal/History navigation row and a permission-gated transaction toolbar. Compact Personal Information, Employment Details and Government IDs sections use left-aligned labels and right-aligned, wrapping values. Compensation, allowances and remarks are available in Overview rather than a separate Pay & IDs tab. IDs are masked initially; a keyboard-accessible disclosure shows complete identifiers within the existing authorized employee view. Separated employees retain Leaving Details. A single native progress indicator shows profile completeness. Larger record fonts and the existing dialog dimensions are preserved.

Edit groups existing fields into compact two-column sections on desktop/tablet and single-column sections on mobile. Addresses retain their existing component, validation and mirroring behavior. Employment Type displays Regular and Status Reason displays Active; canonical stored values remain `Regular / Permanent` and `Active / Normal`, preserving existing imports, reporting and automatic regularization. No database migration is required.

The detail navigation is now one underline-style tab row. Employee transactions are a separate toolbar: Edit is visible, Status/Lifecycle/Transfer are in the native keyboard-accessible More actions disclosure, and Report ER Matter remains role-gated. Escape closes the disclosure before closing the employee workspace. Existing save/discard/cancel transaction handling is reused. The ui-styling skill informed the hierarchy and disclosure pattern; no React, Tailwind or shadcn dependency was installed.

Automated tests cover the shared scale, unchanged dialog dimensions in the typography rules, mobile rules, canonical select values, shortened display labels, masked identifiers and compensation in Overview. The synthetic browser harness now extracts the shared employee Edit renderer as well as Status, Lifecycle, Transfer and Overview markup. Address controls remain representative fixture controls. It uses synthetic records and no Supabase calls; it is not a production authentication or save-flow test.

Compact-layout verification: 351 tests passed; lint, production build and structural validation passed. Browser checks at 390x844, 768x1024 and 1440x900 showed no horizontal overflow in Overview or Edit. The identifier disclosure was opened using the keyboard. No schema, authorization or Supabase configuration changes were made.

Commit remark: `fix(ui): normalize modal typography and enlarge employee record text`.

Compact-layout commit remark: `fix(employees): compact overview and edit sections, consolidate pay details, and shorten display labels`.
