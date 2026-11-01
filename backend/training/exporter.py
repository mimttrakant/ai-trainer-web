from __future__ import annotations

import json
from pathlib import Path

import torch
import torch.nn as nn
from training.pt_export import FULL_PT_FILENAME, write_full_model


STORAGE_ROOT = Path("/app/storage")


def get_model_version_folder(
    owner_id: int,
    project_id: int,
    version: int,
) -> Path:
    folder = (
        STORAGE_ROOT
        / "models"
        / f"user_{owner_id}"
        / f"project_{project_id}"
        / f"version_{version}"
    )

    folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    return folder


def get_checkpoint_folder(
    training_job_id: int,
) -> Path:
    folder = (
        STORAGE_ROOT
        / "checkpoints"
        / f"job_{training_job_id}"
    )

    folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    return folder


def save_model_pt(
    model: nn.Module,
    owner_id: int,
    project_id: int,
    version: int,
    architecture_json: str,
    class_names: list[str],
) -> Path:
    folder = get_model_version_folder(
        owner_id=owner_id,
        project_id=project_id,
        version=version,
    )

    output_path = (
        folder
        / FULL_PT_FILENAME
    )

    write_full_model(model.state_dict(), architecture_json, class_names, len(class_names), output_path)

    return output_path


def save_checkpoint(
    model: nn.Module,
    optimizer,
    training_job_id: int,
    epoch: int,
    architecture_json: str,
    class_names: list[str],
    best_val_accuracy: float,
    best_val_loss: float,
) -> Path:
    folder = get_checkpoint_folder(
        training_job_id
    )

    output_path = (
        folder
        / "checkpoint.pt"
    )

    checkpoint = {
        "epoch": epoch,

        "model_state_dict": (
            model.state_dict()
        ),

        "optimizer_state_dict": (
            optimizer.state_dict()
            if optimizer is not None
            else None
        ),

        "architecture_json": (
            architecture_json
        ),

        "class_names": (
            class_names
        ),

        "best_val_accuracy": (
            best_val_accuracy
        ),

        "best_val_loss": (
            best_val_loss
        ),
    }

    torch.save(
        checkpoint,
        output_path,
    )

    return output_path


def save_metadata(
    owner_id: int,
    project_id: int,
    version: int,
    architecture_json: str,
    class_names: list[str],
    best_val_accuracy: float,
    best_val_loss: float,
    epoch: int,
    project_version: int | None = None,
    model_name: str | None = None,
) -> Path:
    folder = get_model_version_folder(
        owner_id=owner_id,
        project_id=project_id,
        version=version,
    )

    output_path = (
        folder
        / "metadata.json"
    )

    metadata = {
        "owner_id": owner_id,
        "project_id": project_id,
        "version": version,
        "project_version": project_version,
        "model_name": model_name,

        "task_type": (
            "image_classification"
        ),

        "class_names": class_names,
        "class_count": len(
            class_names
        ),

        "best_val_accuracy": (
            best_val_accuracy
        ),

        "best_val_loss": (
            best_val_loss
        ),

        "epoch": epoch,

        "architecture_json": (
            architecture_json
        ),
    }

    with output_path.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            metadata,
            file,
            ensure_ascii=False,
            indent=2,
        )

    return output_path


def export_onnx(
    model: nn.Module,
    owner_id: int,
    project_id: int,
    version: int,
    input_channels: int,
    input_height: int,
    input_width: int,
) -> Path:
    folder = get_model_version_folder(
        owner_id=owner_id,
        project_id=project_id,
        version=version,
    )

    output_path = (
        folder
        / "model.onnx"
    )

    device = next(
        model.parameters()
    ).device

    dummy_input = torch.randn(
        1,
        input_channels,
        input_height,
        input_width,
        device=device,
    )

    model.eval()

    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),

        export_params=True,

        opset_version=18,

        do_constant_folding=True,

        input_names=[
            "input"
        ],

        output_names=[
            "logits"
        ],

        dynamic_axes={
            "input": {
                0: "batch_size"
            },

            "logits": {
                0: "batch_size"
            },
        },
    )

    return output_path


def export_trained_model(
    model: nn.Module,
    optimizer,
    owner_id: int,
    project_id: int,
    training_job_id: int,
    version: int,
    epoch: int,
    architecture_json: str,
    class_names: list[str],
    best_val_accuracy: float,
    best_val_loss: float,
    input_channels: int,
    input_height: int,
    input_width: int,
    project_version: int | None = None,
    model_name: str | None = None,
) -> dict:
    """
    Export Model หลัง Train สำเร็จ

    ได้:
    - model-full-v1.pt (downloaded as model.pt: full module + trained weights)
    - checkpoint.pt
    - model.onnx
    - metadata.json
    """

    model_pt_path = save_model_pt(
        model=model,
        owner_id=owner_id,
        project_id=project_id,
        version=version,
        architecture_json=architecture_json,
        class_names=class_names,
    )

    checkpoint_path = (
        save_checkpoint(
            model=model,
            optimizer=optimizer,
            training_job_id=(
                training_job_id
            ),
            epoch=epoch,
            architecture_json=(
                architecture_json
            ),
            class_names=class_names,
            best_val_accuracy=(
                best_val_accuracy
            ),
            best_val_loss=(
                best_val_loss
            ),
        )
    )

    onnx_path = export_onnx(
        model=model,
        owner_id=owner_id,
        project_id=project_id,
        version=version,
        input_channels=(
            input_channels
        ),
        input_height=(
            input_height
        ),
        input_width=(
            input_width
        ),
    )

    metadata_path = save_metadata(
        project_version=project_version,
        model_name=model_name,
        owner_id=owner_id,
        project_id=project_id,
        version=version,
        architecture_json=(
            architecture_json
        ),
        class_names=class_names,
        best_val_accuracy=(
            best_val_accuracy
        ),
        best_val_loss=(
            best_val_loss
        ),
        epoch=epoch,
    )

    return {
        "pt_path": str(
            model_pt_path
        ),

        "checkpoint_path": str(
            checkpoint_path
        ),

        "onnx_path": str(
            onnx_path
        ),

        "metadata_path": str(
            metadata_path
        ),
    }
