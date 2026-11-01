# Download PT: complete model + weights (Phase 17)

The PT download endpoints return `model.pt`: a CPU `torch.nn.Module`, not a
state_dict. Layers, trained parameters, buffers (including BatchNorm statistics),
`class_names`, `input_shape` (C, H, W), and the exporting PyTorch version are saved.
The module is in eval mode. Global pooling wrappers are replaced with equivalent
standard PyTorch layers, so loading does not require this repository's classes.

Load only a trusted export, with a compatible PyTorch version:

```python
import torch

model = torch.load("model.pt", map_location="cpu", weights_only=False)
model.eval()
print(model.class_names, model.input_shape)
with torch.inference_mode():
    logits = model(preprocessed_images)  # [N, C, H, W] float tensor
    class_indices = logits.argmax(dim=1)
```

Full-module files use pickle: loading an untrusted file with `weights_only=False`
can execute code. The server never uses that option when reading old artifacts;
legacy state_dicts are loaded with `weights_only=True`. Do not enable arbitrary
user-supplied full-module uploads without a separate security design.
See https://docs.pytorch.org/tutorials/beginner/saving_loading_models .

Preprocessing is not baked into the forward method: match the training pipeline
(RGB, resize, ToTensor, ImageNet normalization for the current RGB loader). No
random horizontal flip at inference. Input size comes from `model.input_shape`.
Optimizer state, training graphs, datasets and resume state are not in this file;
the original `checkpoint.pt` continues to serve the checkpoint purpose.

New exports use the internal filename `model-full-v1.pt`; browsers receive
`model.pt`. Existing weight-only exports are converted on their first authorized
download, using only the architecture and class information saved with that
trained ModelVersion. They are cached next to the original, without overwriting
old weights, checkpoints or DB paths. Missing/incompatible saved metadata yields
409, never today's project architecture or a misleading weight-only download.
Conversion temporarily needs additional RAM and disk space. File publication is
atomic; later downloads reuse the cache. ONNX behavior and access rules are unchanged.

Tests use temporary models: verify identical predictions at different batch sizes,
BatchNorm buffers, both global pooling variants, loading in an isolated Python
process with no application imports, cached legacy conversion, failed exports,
ownership and public/private revocation. Restart idle workers after deploying.

Phase 17 verification also exercised the complete export bundle (PT, checkpoint,
metadata and ONNX checker) on local PyTorch 2.6 CPU. Docker was unresponsive during
this change, so live-container / PostgreSQL integration was not rerun; those tests
remain explicitly skipped, not reported as passing. Browser download checks use
synthetic responses; actual PT bytes are validated by the backend round-trip tests.
