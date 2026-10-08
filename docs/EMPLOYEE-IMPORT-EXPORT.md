# Employee Import and Export

## Access

Only users with the `Administrator` role can see or use **Template** and **Import** in Employee Information. Export remains available to authorized HR users.

Before downloading a template, the System Administrator should maintain:

- **Settings > Organization Structure:** active departments and department-linked positions
- **Settings > Branches & Compensation:** reporting branches and allowance types

The template is generated from the current settings, so its department reference and allowance columns always reflect the active configuration. Imported positions must be active and assigned to the employee's selected department.

## Import employees

1. Open **Employee Information**.
2. Select **Template** to download `SLSC_Employee_Import_Template.xlsx`.
3. Read the **Instructions** and **Reference** worksheets.
4. Enter one employee per row in the **Employees** worksheet.
5. Keep the required column names unchanged. Leave **Employee No.** blank to generate the next number.
6. Select an active **Department** and a position configured for that department.
7. Select a configured **Branch Reporting** value for every employee.
8. Enter the optional **Daily Rate** and applicable allowance amounts as non-negative numbers.
9. Use the optional **Remarks** column for HR context that should remain on the employee master record.
10. Return to Employee Information and select **Import**.
11. Choose the completed `.xlsx`, `.xls`, or `.csv` file.
12. Review every validation result. The system does not save partial imports; all errors must be corrected first.
13. Review any yellow possible-duplicate warnings, then confirm the import.

The importer validates required fields, dates, allowed department and status values, email and phone formats, government ID formats, and duplicate employee numbers. Employee numbers use a six-digit numeric sequence in the canonical form `EMP-000001`; a blank value generates the next number, while a numeric or legacy value is normalized during validation. Similar employee names are warnings and require an explicit confirmation.

## Export employees

Select **Export** in Employee Information to download an Excel workbook containing:

- Complete employee master data, including branch assignment, daily rate, each allowance, contact details, and government IDs
- Creation and last-update audit details
- Employment history
- Employee record history

Exports from other record tables include all fields in their data-entry forms, plus calculated table fields and available audit details.
