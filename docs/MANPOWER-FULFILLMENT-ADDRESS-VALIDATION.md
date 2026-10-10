# Backend address validation prerequisite (MP-B10)

Proposal 0049 prepares private authoritative address validation for future atomic
applicant-to-employee creation. It does not create employees, enable conversion,
change forms, or deploy a database migration.

## Behavior

- The existing files in `assets/data/philippine-address/` remain authoritative and
  unchanged. A structured generator validates codes, parent relationships and
  uniqueness before deriving an owner-only PostgreSQL reference catalog.
- The catalog contains 18 regions, 82 provinces, 1,642 cities/municipalities and
  42,011 barangays. Codes remain strings, including leading zeroes.
- Blank and free-text street/imported addresses remain optional. Administrative
  values require known codes, matching normalized names, compatible parents and
  the city's ZIP when available. NCR supports the existing no-province model.
- Readable names and formatted addresses are rebuilt from authoritative values.
  Caller-provided display text or a legacy flag cannot bypass location validation.
- RLS and revoked browser privileges protect the private catalog and helpers.
  Reference rows cannot be updated or deleted. No employee records are changed.

The helper mirrors existing `js/address/address-validation.js` rules. In
particular, a region with provinces requires a province: special province-less
cities in such regions need a coordinated, separately tested frontend/backend
rule update, not an inferred province or source-data modification.

## Gated setup and verification

Do not run these steps against production without the approved baseline and
deployment review. Proposal 0049 requires the private schema from proposal 0047;
it stays outside automatic migrations. No setup has been executed on a live DB.

1. Review and rehearse the compatible proposal chain and 0049 in a disposable DB.
2. Generate the seed to an explicit path outside migrations:

   ```powershell
   node scripts/generate-address-catalog-seed.mjs --output "$env:TEMP/hris-address-reference.sql"
   ```

   The generator refuses an existing file or a migration-directory destination.
   Do not commit the generated bulk SQL; it duplicates the reference dataset.
3. Review the generated SQL before approved owner execution. All inserts and the
   manifest commit together; repeated seeds fail rather than overwrite data.
4. Run `supabase/verification/manpower_address_catalog.sql` as an owner. Every
   issue query must return zero rows. Compare the manifest SHA with this checkout's
   generator output. The digest covers the sorted canonical projection, not file
   formatting or line endings.

Current projection SHA-256:
`e969ffbd40edbc5745a5aa7089c5bcab81365e6d21e5f8a2d91d9b51f14198af`.

Future approved reference updates need a versioned procedure; immutable rows must
not be silently replaced by re-running this seed.

## Validation and remaining work

Automated projection tests validate the complete hierarchy, deterministic digest,
SQL escaping and leading-zero preservation. Synthetic isolated and combined
PostgreSQL rehearsals cover optional/imported addresses, canonical names,
hierarchy/ZIP errors, forged fields, missing-catalog fail-closed behavior, NCR,
private browser denial and immutable reference rows.

Verified locally: lint, all 247 tests, production build, repository validation,
diff checks, isolated and combined database rehearsals passed. Explicit temporary
seed generation also succeeded; the generated SQL was not added to the repository.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --addresses
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses
```

Still required: atomic employee creation, canonical employee-number allocation,
other master-input validation, controlled conversion UI, independent concurrency,
live authorization and production acceptance. This prerequisite does not complete
Stage B or verify production RLS.
