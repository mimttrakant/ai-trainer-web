# Community library (Phases 14 onward)

Existing records remain private. Existing users must log in again: the API now
requires an expiring opaque bearer session, stored hashed in `user_sessions`.
Legacy owner-ID routes are protected too; changing localStorage owner IDs does
not grant access. Only the owner can change visibility or delete their content.
Public here means visible to other signed-in platform users, not an anonymous
internet upload. Previously downloaded/cloned content cannot be revoked.

After deployment, run `docker compose exec -T backend python -m backfill_dataset_counts`
once for old datasets. New imports persist counts before becoming ready. Both
new and legacy details endpoints read stored counts only: they never scan on GET.
Import/scan failure remains explicit; NULL legacy counts are not reported as zero.

URL import supports Google Drive ZIP file links and public HTTP(S) direct ZIP
URLs, with public-address checks at each direct-URL redirect and finite timeouts.
Deployments exposed to untrusted users should additionally enforce network-level
egress restrictions (DNS rebinding protection), storage quotas, and upload limits.
ZIP downloads use temporary disk-backed archives and clean them after delivery.
Do not publicly share datasets you do not have permission to redistribute.

`test_library.py` uses an in-memory database, real bearer validation and temporary
fixtures. `frontend/tests/dataset-library.spec.js` mocks API traffic. Neither suite
publishes, deletes or trains real user content. Existing Dataset tests were
updated because live backfill on details GET is intentionally no longer allowed.

Model designs remain backed by `projects` / `project_versions`; the UI calls
them Models and keeps old URLs as aliases. Community models expose version
metadata and explicit clone actions, not an editor. Clones copy only the selected
immutable architecture into a new private model with Version 1 and new row IDs.
Design removal is soft deletion so existing jobs/weights retain provenance.
Public means all saved versions of the design can be selected, not just latest.
