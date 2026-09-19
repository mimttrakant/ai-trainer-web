from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import torch
import torch.nn as nn
from torch.optim import Adam, AdamW, SGD
from torch.utils.data import DataLoader


@dataclass
class EpochMetrics:
    epoch: int

    train_loss: float
    train_accuracy: float

    val_loss: float
    val_accuracy: float


@dataclass
class TrainingResult:
    history: list[EpochMetrics]

    best_epoch: int
    best_val_accuracy: float
    best_val_loss: float

    final_train_loss: float
    final_train_accuracy: float

    final_val_loss: float
    final_val_accuracy: float


def get_device() -> torch.device:
    """
    เลือก GPU ถ้ามี
    ถ้าไม่มีจะใช้ CPU
    """
    if torch.cuda.is_available():
        return torch.device("cuda")

    return torch.device("cpu")


def build_optimizer(
    model: nn.Module,
    optimizer_name: str,
    learning_rate: float,
):
    name = optimizer_name.lower().strip()

    if learning_rate <= 0:
        raise ValueError(
            "Learning rate must be greater than 0."
        )

    if name == "adam":
        return Adam(
            model.parameters(),
            lr=learning_rate,
        )

    if name == "adamw":
        return AdamW(
            model.parameters(),
            lr=learning_rate,
        )

    if name == "sgd":
        return SGD(
            model.parameters(),
            lr=learning_rate,
            momentum=0.9,
        )

    raise ValueError(
        "Unsupported optimizer. "
        "Use adam, adamw, or sgd."
    )


def calculate_accuracy(
    logits: torch.Tensor,
    targets: torch.Tensor,
) -> tuple[int, int]:
    predictions = torch.argmax(
        logits,
        dim=1,
    )

    correct = (
        predictions == targets
    ).sum().item()

    total = targets.size(0)

    return correct, total


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer,
    device: torch.device,
) -> tuple[float, float]:
    model.train()

    total_loss = 0.0
    total_correct = 0
    total_samples = 0

    for images, labels in loader:
        images = images.to(
            device,
            non_blocking=True,
        )

        labels = labels.to(
            device,
            non_blocking=True,
        )

        optimizer.zero_grad()

        logits = model(images)

        loss = criterion(
            logits,
            labels,
        )

        loss.backward()

        optimizer.step()

        batch_size = labels.size(0)

        total_loss += (
            loss.item() * batch_size
        )

        correct, count = calculate_accuracy(
            logits,
            labels,
        )

        total_correct += correct
        total_samples += count

    if total_samples == 0:
        raise ValueError(
            "Training DataLoader contains no samples."
        )

    average_loss = (
        total_loss / total_samples
    )

    accuracy = (
        total_correct / total_samples
    ) * 100.0

    return (
        average_loss,
        accuracy,
    )


@torch.no_grad()
def validate_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
) -> tuple[float, float]:
    model.eval()

    total_loss = 0.0
    total_correct = 0
    total_samples = 0

    for images, labels in loader:
        images = images.to(
            device,
            non_blocking=True,
        )

        labels = labels.to(
            device,
            non_blocking=True,
        )

        logits = model(images)

        loss = criterion(
            logits,
            labels,
        )

        batch_size = labels.size(0)

        total_loss += (
            loss.item() * batch_size
        )

        correct, count = calculate_accuracy(
            logits,
            labels,
        )

        total_correct += correct
        total_samples += count

    if total_samples == 0:
        raise ValueError(
            "Validation DataLoader contains no samples."
        )

    average_loss = (
        total_loss / total_samples
    )

    accuracy = (
        total_correct / total_samples
    ) * 100.0

    return (
        average_loss,
        accuracy,
    )


def train_classification_model(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    total_epochs: int,
    learning_rate: float,
    optimizer_name: str = "adam",
    epoch_callback: Callable[
        [EpochMetrics],
        None
    ] | None = None,
) -> TrainingResult:
    """
    Train Image Classification Model จริง

    epoch_callback:
    จะถูกเรียกหลังจบแต่ละ Epoch

    เดี๋ยว worker.py จะใช้ callback นี้
    เพื่ออัปเดต PostgreSQL
    """

    if total_epochs < 1:
        raise ValueError(
            "total_epochs must be at least 1."
        )

    device = get_device()

    model = model.to(device)

    criterion = nn.CrossEntropyLoss()

    optimizer = build_optimizer(
        model=model,
        optimizer_name=optimizer_name,
        learning_rate=learning_rate,
    )

    history: list[EpochMetrics] = []

    best_epoch = 0
    best_val_accuracy = float("-inf")
    best_val_loss = float("inf")

    for epoch in range(
        1,
        total_epochs + 1,
    ):
        train_loss, train_accuracy = (
            train_one_epoch(
                model=model,
                loader=train_loader,
                criterion=criterion,
                optimizer=optimizer,
                device=device,
            )
        )

        val_loss, val_accuracy = (
            validate_one_epoch(
                model=model,
                loader=val_loader,
                criterion=criterion,
                device=device,
            )
        )

        metrics = EpochMetrics(
            epoch=epoch,
            train_loss=round(
                train_loss,
                6,
            ),
            train_accuracy=round(
                train_accuracy,
                4,
            ),
            val_loss=round(
                val_loss,
                6,
            ),
            val_accuracy=round(
                val_accuracy,
                4,
            ),
        )

        history.append(metrics)

        if (
            val_accuracy
            > best_val_accuracy
        ):
            best_val_accuracy = (
                val_accuracy
            )

            best_val_loss = (
                val_loss
            )

            best_epoch = epoch

        if epoch_callback is not None:
            epoch_callback(metrics)

        print(
            f"[Trainer] "
            f"Epoch {epoch}/{total_epochs} | "
            f"Train Loss: "
            f"{metrics.train_loss:.4f} | "
            f"Train Acc: "
            f"{metrics.train_accuracy:.2f}% | "
            f"Val Loss: "
            f"{metrics.val_loss:.4f} | "
            f"Val Acc: "
            f"{metrics.val_accuracy:.2f}%"
        )

    final = history[-1]

    return TrainingResult(
        history=history,

        best_epoch=best_epoch,
        best_val_accuracy=round(
            best_val_accuracy,
            4,
        ),
        best_val_loss=round(
            best_val_loss,
            6,
        ),

        final_train_loss=(
            final.train_loss
        ),

        final_train_accuracy=(
            final.train_accuracy
        ),

        final_val_loss=(
            final.val_loss
        ),

        final_val_accuracy=(
            final.val_accuracy
        ),
    )