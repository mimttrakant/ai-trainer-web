# Trained model actions

- GET `/training/projects/{project_id}/models/{model_id}/download/pt?owner_id=...`
  downloads the saved state dictionary (`.pt`, not a serialized model class).
- GET the same URL with `/download/onnx` downloads `.onnx` for self-contained
  models, or a ZIP containing the graph and every referenced external tensor
  file. Extract the ZIP together before opening the ONNX graph. The current
  exporter produces `model.onnx` plus `model.onnx.data`.
- GET the same URL with `/download/json` downloads a portable Builder design
  from `model_versions.architecture_json`, never from the project's current
  architecture. It includes the originating Builder version, model name and
  training provenance. Import it through Builder's Import JSON. It contains no
  trained weights; PT / ONNX downloads provide those separately. Missing legacy
  architectures return 404 rather than substituting an unrelated current design.
- DELETE `/training/projects/{project_id}/models/{model_id}?owner_id=...`
  performs a **soft delete**, setting `model_versions.deleted_at`. The listing
  and download endpoints no longer expose that model. Model files, checkpoints,
  jobs, metrics, lineage, and version numbers are retained. It frees no disk
  space. There is no restore UI yet; an administrator can restore the row by
  clearing its `deleted_at`. Git does not back up these files or database rows.

Startup adds the nullable column to existing databases without dropping data.
Keeping deleted rows prevents the worker's next-version calculation from
reusing an existing export directory. No worker changes are needed.

These routes follow the application's existing client-supplied `owner_id`
contract and validate both project and model ownership. **This is not strong
authentication:** the existing application has no verified session/token for
these routes. Add server-verified authentication before exposing it publicly.
Downloads are limited to the model's own version folder, and unsafe / missing
external ONNX files are rejected. ZIPs are disk-backed temporary files removed
after sending; the browser buffers the download as a Blob to handle API errors.

Run isolated backend checks (in-memory SQLite and temporary synthetic files):

```powershell
docker compose exec -T backend python -m unittest discover -s tests -p test_model_routes.py -v
```

From `frontend`, run the mocked browser checks:

```powershell
npm run test:e2e -- tests/trained-models.spec.js tests/training-charts.spec.js
```

The checks do not delete or alter any real models, jobs, datasets, or metrics.

New jobs snapshot the dataset name at submission, and trained models preserve
that name and dataset ID. The model list displays them even if the dataset is
renamed or removed later. Legacy models fall back to the currently available
dataset name or its ID; their historical dataset name was not recorded.
