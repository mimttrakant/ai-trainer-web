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

Training uses `/library/jobs`: the server verifies model and dataset access,
locks the source rows for admission, and stores the exact selected architecture,
version and source-owner IDs. Completed weights belong to the person who starts
training, even when the source design/dataset belongs to someone else. Public
access revocation stops new submissions; jobs already accepted keep their access
grant and immutable design snapshot. Dataset removal is blocked while queued or
running jobs reference it. Restart existing worker processes after upgrading,
only after their active jobs have finished; `worker.bat 3` still means up to
three concurrent jobs, not three dedicated CPU cores.

Weights default to private. Sharing a completed weight exposes its saved graphs,
model/dataset labels, parameters, and PT/ONNX downloads to signed-in users. It
does not grant access to private source datasets or the original design editor.
Changing back to private blocks subsequent requests but cannot retract files
already downloaded. The Training UI and new weight API do not export JSON;
Builder JSON import/export and the protected legacy download API are retained.
Delete Weight is recoverable removal: the row and files are retained, the weight
disappears from both lists, and shared result access is revoked. Model designs,
job records, and metric history are untouched. Physical storage reclamation is
not performed by this action.

Training has separate model, dataset, and parameter sections, paginated searchable
selectors, a ten-row job list, and an independent My/Public weight library. All
job history remains searchable; pagination replaces the old default 48-hour
display cutoff. Selected job IDs persist in the page URL. Graph polling is every
three seconds while active and thirty seconds when completed; hidden tabs pause
polling. Unchanged metric arrays retain identity to avoid chart redraws.

Verification: `docker compose exec -T -e WORKER_TEST_POSTGRES=1 backend python -m unittest discover -s tests -v`
uses disposable PostgreSQL schemas, in-memory API databases and temporary
synthetic images/exports, never user datasets. Direct-URL tests use mocked HTTP
responses including a redirect, ZIP extraction, persisted counts and a download
round trip; they do not depend on any particular third-party hosting service.
