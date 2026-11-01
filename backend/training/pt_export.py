"""Full, CPU-portable PyTorch modules, built only from saved architecture snapshots."""
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

import torch
from torch import nn

from training.model_builder import build_classification_model, GlobalAveragePool2D, GlobalMaxPool2D

FULL_PT_FILENAME = "model-full-v1.pt"


def standard_layers(module):
    # Avoid pickle references to application-specific Python classes. These
    # replacements have the same forward operation and no learned parameters.
    if isinstance(module, GlobalAveragePool2D):
        return nn.Sequential(nn.AdaptiveAvgPool2d((1, 1)), nn.Flatten(1))
    if isinstance(module, GlobalMaxPool2D):
        return nn.Sequential(nn.AdaptiveMaxPool2d((1, 1)), nn.Flatten(1))
    for name, child in list(module.named_children()):
        module._modules[name] = standard_layers(child)
    if not type(module).__module__.startswith("torch.nn."):
        raise ValueError("Cannot export a custom Python layer as a standalone PT model.")
    return module


def write_full_model(state_dict, architecture_json, class_names, class_count, destination):
    if not isinstance(class_names, list) or any(not isinstance(name, str) for name in class_names):
        raise ValueError("Invalid saved class labels.")
    if class_names and len(class_names) != class_count:
        raise ValueError("Saved class labels do not match the output size.")
    # Reconstruct on CPU, without copying or moving the live GPU training model.
    built = build_classification_model(architecture_json, num_classes=class_count)
    built.model.load_state_dict(state_dict, strict=True)
    model = standard_layers(built.model).cpu().eval()
    model.class_names = list(class_names)
    model.input_shape = (built.input_channels, built.input_height, built.input_width)
    model.pt_export_format = "ai-trainer-full-module-v1"
    model.export_torch_version = str(torch.__version__)
    destination = Path(destination)
    with NamedTemporaryFile(dir=destination.parent, prefix=".pt-export-", suffix=".tmp", delete=False) as temporary:
        temp_path = Path(temporary.name)
    try:
        torch.save(model, temp_path)
        os.replace(temp_path, destination)  # Readers never see a partial archive.
    finally:
        temp_path.unlink(missing_ok=True)
    return destination
