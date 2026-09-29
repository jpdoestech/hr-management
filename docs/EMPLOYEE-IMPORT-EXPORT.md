# Employee Import and Export

## Access

Only users with the `Administrator` role can see or use **Template** and **Import** in Employee Information. Export remains available to authorized HR users.

Before downloading a template, the System Administrator should open **Settings > Employee Assignment & Compensation** and maintain:

- Branch Locations used for employee reporting assignments
- Allowance Types that should appear as employee amount fields

The template is generated from the current settings, so every configured allowance becomes its own Excel column.

## Import employees

1. Open **Employee Information**.
2. Select **Template** to download `SLSC_Employee_Import_Template.xlsx`.
3. Read the **Instructions** and **Reference** worksheets.
4. Enter one employee per row in the **Employees** worksheet.
5. Keep the required column names unchanged. Leave **Employee No.** blank to generate the next number.
6. Select a configured **Branch Reporting** value for every employee.
7. Enter the optional **Daily Rate** and applicable allowance amounts as non-negative numbers.
8. Use the optional **Remarks** column for HR context that should remain on the employee master record.
9. Return to Employee Information and select **Import**.
10. Choose the completed `.xlsx`, `.xls`, or `.csv` file.
11. Review every validation result. The system does not save partial imports; all errors must be corrected first.
12. Review any yellow possible-duplicate warnings, then confirm the import.

The importer validates required fields, dates, allowed department and status values, email and phone formats, government ID formats, and duplicate employee numbers. Similar employee names are warnings and require an explicit confirmation.

## Export employees

Select **Export** in Employee Information to download an Excel workbook containing:

- Complete employee master data, including branch assignment, daily rate, each allowance, contact details, and government IDs
- Creation and last-update audit details
- Employment history
- Employee record history

Exports from other record tables include all fields in their data-entry forms, plus calculated table fields and available audit details.
