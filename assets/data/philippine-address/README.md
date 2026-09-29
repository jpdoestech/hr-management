# Philippine Address Reference

This directory contains the project's authoritative Philippine administrative-location data.

- `regions.json`, `provinces.json`, and `cities.json` contain the searchable hierarchy and PSGC-style codes.
- `barangays/<city-code>.json` contains barangays loaded on demand for one city or municipality.
- `barangay-search-index.json` is the original aggregate search artifact and is retained unchanged for traceability. The application does not load it at runtime because the per-city files are substantially smaller.

Runtime indexing and validation live in `js/address/`. The original TypeScript service supplied with this dataset is preserved, unchanged, in `js/address/reference/addressService.ts`.

Do not hand-edit location names or codes. Replace the source files as a complete, validated dataset when an official reference update is needed.
