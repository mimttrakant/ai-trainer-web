# Dataset Library details

Run `docker compose exec -T backend python -m unittest discover -s tests -p test_dataset_details.py -v`.
Tests use temporary synthetic files and SQLite, never the application's datasets.

- Scanner records each detected class folder's supported-extension file count
  (`jpg/jpeg/png/bmp/webp`, case insensitive), including nested images. It does
  not decode/validate image contents. Existing structure eligibility is unchanged.
- Pre-split datasets aggregate each class across normalized train/val/test
  folders; details show separate split counts. For inconsistent splits, the
  detail rows include the union of detected names, while the existing card's
  class summary still describes the scanner's preferred split. Loose images
  outside detected class folders are reported separately when included in the
  existing scan total. Counts are not intended as a complete disk inventory.
- Upload and URL import persist `class_counts_json` with the existing scan.
  Startup adds this nullable column without removing records. Library listing
  does not scan files or include the large class-count payload.
- `GET /datasets/{id}/details?owner_id=...` checks dataset ownership using the
  application's existing owner-ID convention (not a replacement for verified
  authentication). Ready and unsupported datasets can show details. Processing,
  uploading and failed imports return 409; unavailable legacy files return 404.
- Old datasets with NULL/invalid cached counts are scanned on first details
  access and cached under a row lock (PostgreSQL). Existing status/summary fields
  remain unchanged. Subsequent access reads the cache. Counts are an import/scan
  snapshot, not live monitoring of manually modified storage files.
- The owned storage directory is derived from IDs, not the stored arbitrary
  path. Redirected root symlinks are rejected. Tests cover ownership, cache reuse,
  malformed cache recovery, failure retry, extensions, wrappers, splits,
  unlabeled data and import persistence. This suite uses SQLite and does not
  claim to test PostgreSQL row-lock concurrency.

The Thai guide describes the supported classification layout: at least two
nonempty class folders, folder names as labels, plain-folder automatic 80/20
train/validation division (minimum three total images), or explicit train and
optional val/test with identical class names. It warns that counts/Ready status
do not guarantee decodable files or successful training. No dataset files or
training behavior are changed by this feature.
