# backend/training/model_builder.py

from __future__ import annotations

import json
from dataclasses import dataclass

import torch
import torch.nn as nn


SUPPORTED_LAYERS = {
    "Input",
    "Conv2D",
    "MaxPool2D",
    "AveragePool2D",
    "AdaptiveMaxPool2D",
    "GlobalAveragePool2D",
    "GlobalMaxPool2D",
    "BatchNorm2D",
    "Flatten",
    "Dense",
    "Dropout",
    "Output",
}


@dataclass
class BuiltModel:
    model: nn.Module

    input_channels: int
    input_width: int
    input_height: int

    num_classes: int

    ordered_layer_types: list[str]


class GlobalAveragePool2D(nn.Module):
    def __init__(self):
        super().__init__()

        self.pool = nn.AdaptiveAvgPool2d((1, 1))

    def forward(self, x):
        x = self.pool(x)

        # [B, C, 1, 1] -> [B, C]
        return torch.flatten(x, 1)


class GlobalMaxPool2D(nn.Module):
    def __init__(self):
        super().__init__()

        self.pool = nn.AdaptiveMaxPool2d((1, 1))

    def forward(self, x):
        x = self.pool(x)

        # [B, C, 1, 1] -> [B, C]
        return torch.flatten(x, 1)


def parse_architecture(
    architecture_json: str | dict,
) -> dict:
    if isinstance(architecture_json, dict):
        architecture = architecture_json

    elif isinstance(architecture_json, str):
        if not architecture_json.strip():
            raise ValueError(
                "Architecture is empty."
            )

        try:
            architecture = json.loads(
                architecture_json
            )

        except json.JSONDecodeError as exc:
            raise ValueError(
                "Architecture JSON is invalid."
            ) from exc

    else:
        raise TypeError(
            "architecture_json must be a JSON string "
            "or dictionary."
        )

    nodes = architecture.get("nodes")
    edges = architecture.get("edges")

    if not isinstance(nodes, list):
        raise ValueError(
            "Architecture does not contain a valid nodes list."
        )

    if not isinstance(edges, list):
        raise ValueError(
            "Architecture does not contain a valid edges list."
        )

    if not nodes:
        raise ValueError(
            "Architecture contains no layers."
        )

    return {
        "nodes": nodes,
        "edges": edges,
    }


def get_layer_type(node: dict) -> str:
    data = node.get("data") or {}

    layer_type = data.get("layerType")

    if not layer_type:
        raise ValueError(
            f"Node {node.get('id')} has no layerType."
        )

    return str(layer_type)


def get_properties(node: dict) -> dict:
    data = node.get("data") or {}
    properties = data.get("properties")

    if not isinstance(properties, dict):
        return {}

    return properties


def validate_supported_layers(
    nodes: list[dict],
) -> None:
    unsupported = []

    for node in nodes:
        layer_type = get_layer_type(node)

        if layer_type not in SUPPORTED_LAYERS:
            unsupported.append(layer_type)

    if unsupported:
        names = ", ".join(
            sorted(set(unsupported))
        )

        raise ValueError(
            "These layers are not supported by the "
            f"Image Classification trainer yet: {names}"
        )


def order_nodes_by_edges(
    nodes: list[dict],
    edges: list[dict],
) -> list[dict]:
    """
    เรียง Layer ตามเส้น Connection ของ React Flow

    Version แรกของ Training Engine รองรับ
    architecture แบบเส้นตรงเท่านั้น

    Input -> Conv2D -> Pool -> ... -> Output
    """

    node_by_id = {}

    for node in nodes:
        node_id = str(node.get("id"))

        if not node_id:
            raise ValueError(
                "A node is missing its id."
            )

        node_by_id[node_id] = node

    incoming = {
        node_id: []
        for node_id in node_by_id
    }

    outgoing = {
        node_id: []
        for node_id in node_by_id
    }

    for edge in edges:
        source = str(edge.get("source"))
        target = str(edge.get("target"))

        if (
            source not in node_by_id
            or target not in node_by_id
        ):
            raise ValueError(
                "Architecture contains an edge "
                "connected to an unknown layer."
            )

        outgoing[source].append(target)
        incoming[target].append(source)

    # ป้องกัน architecture แตกแขนง
    for node_id in node_by_id:
        if len(outgoing[node_id]) > 1:
            raise ValueError(
                "Branching architectures are not supported yet. "
                "Each layer may connect to only one next layer."
            )

        if len(incoming[node_id]) > 1:
            raise ValueError(
                "Merge architectures are not supported yet. "
                "Each layer may receive input from only one layer."
            )

    start_nodes = [
        node_id
        for node_id in node_by_id
        if len(incoming[node_id]) == 0
    ]

    if len(start_nodes) != 1:
        raise ValueError(
            "Architecture must contain exactly one "
            "starting layer."
        )

    ordered = []
    visited = set()

    current_id = start_nodes[0]

    while True:
        if current_id in visited:
            raise ValueError(
                "Architecture contains a cycle."
            )

        visited.add(current_id)

        ordered.append(
            node_by_id[current_id]
        )

        next_nodes = outgoing[current_id]

        if not next_nodes:
            break

        current_id = next_nodes[0]

    if len(visited) != len(nodes):
        raise ValueError(
            "Some layers are disconnected. "
            "Connect all layers before training."
        )

    return ordered


def build_activation(
    activation_name: str | None,
) -> nn.Module | None:
    name = str(
        activation_name or "none"
    ).lower()

    if name == "relu":
        return nn.ReLU()

    if name == "leaky_relu":
        return nn.LeakyReLU(
            negative_slope=0.01
        )

    if name == "gelu":
        return nn.GELU()

    if name == "silu":
        return nn.SiLU()

    if name == "sigmoid":
        return nn.Sigmoid()

    if name == "tanh":
        return nn.Tanh()

    if name in {
        "none",
        "linear",
        "",
    }:
        return None

    raise ValueError(
        f"Unsupported activation: {name}"
    )


def append_activation(
    modules: list[nn.Module],
    activation_name,
) -> None:
    activation = build_activation(
        activation_name
    )

    if activation is not None:
        modules.append(activation)


def build_classification_model(
    architecture_json: str | dict,
    num_classes: int,
) -> BuiltModel:
    """
    แปลง Architecture จากหน้า Builder
    เป็น PyTorch nn.Module จริง

    num_classes มาจาก Dataset
    ไม่ใช้ค่า classes ใน Output Node
    """

    if num_classes < 2:
        raise ValueError(
            "Image Classification requires "
            "at least 2 classes."
        )

    architecture = parse_architecture(
        architecture_json
    )

    nodes = architecture["nodes"]
    edges = architecture["edges"]

    validate_supported_layers(nodes)

    ordered_nodes = order_nodes_by_edges(
        nodes,
        edges,
    )

    ordered_types = [
        get_layer_type(node)
        for node in ordered_nodes
    ]

    # -----------------------------------
    # ตรวจ Input / Output
    # -----------------------------------

    if ordered_types[0] != "Input":
        raise ValueError(
            "The first layer must be Input."
        )

    if ordered_types[-1] != "Output":
        raise ValueError(
            "The last layer must be Output."
        )

    if ordered_types.count("Input") != 1:
        raise ValueError(
            "Architecture must contain exactly "
            "one Input layer."
        )

    if ordered_types.count("Output") != 1:
        raise ValueError(
            "Architecture must contain exactly "
            "one Output layer."
        )

    input_properties = get_properties(
        ordered_nodes[0]
    )

    input_channels = int(
        input_properties.get(
            "channels",
            3,
        )
    )

    input_width = int(
        input_properties.get(
            "width",
            128,
        )
    )

    input_height = int(
        input_properties.get(
            "height",
            128,
        )
    )

    if input_channels not in {
        1,
        3,
        4,
    }:
        raise ValueError(
            "Input channels must be 1, 3, or 4."
        )

    if (
        input_width < 1
        or input_height < 1
    ):
        raise ValueError(
            "Input width and height must "
            "be greater than 0."
        )

    modules: list[nn.Module] = []

    # ใช้สำหรับ BatchNorm2D
    current_channels = input_channels

    # -----------------------------------
    # สร้าง Layer ทีละตัว
    # -----------------------------------

    for node in ordered_nodes[1:]:
        layer_type = get_layer_type(node)
        properties = get_properties(node)

        # ================================
        # Conv2D
        # ================================

        if layer_type == "Conv2D":
            filters = int(
                properties.get(
                    "filters",
                    32,
                )
            )

            kernel_size = int(
                properties.get(
                    "kernel_size",
                    3,
                )
            )

            stride = int(
                properties.get(
                    "stride",
                    1,
                )
            )

            padding = int(
                properties.get(
                    "padding",
                    0,
                )
            )

            dilation = int(
                properties.get(
                    "dilation",
                    1,
                )
            )

            modules.append(
                nn.Conv2d(
                    in_channels=current_channels,
                    out_channels=filters,
                    kernel_size=kernel_size,
                    stride=stride,
                    padding=padding,
                    dilation=dilation,
                )
            )

            current_channels = filters

            append_activation(
                modules,
                properties.get(
                    "activation",
                    "relu",
                ),
            )

        # ================================
        # MaxPool2D
        # ================================

        elif layer_type == "MaxPool2D":
            modules.append(
                nn.MaxPool2d(
                    kernel_size=int(
                        properties.get(
                            "pool_size",
                            2,
                        )
                    ),
                    stride=int(
                        properties.get(
                            "stride",
                            2,
                        )
                    ),
                    padding=int(
                        properties.get(
                            "padding",
                            0,
                        )
                    ),
                )
            )

        # ================================
        # AveragePool2D
        # ================================

        elif layer_type == "AveragePool2D":
            modules.append(
                nn.AvgPool2d(
                    kernel_size=int(
                        properties.get(
                            "pool_size",
                            2,
                        )
                    ),
                    stride=int(
                        properties.get(
                            "stride",
                            2,
                        )
                    ),
                    padding=int(
                        properties.get(
                            "padding",
                            0,
                        )
                    ),
                )
            )

        # ================================
        # AdaptiveMaxPool2D
        # ================================

        elif layer_type == "AdaptiveMaxPool2D":
            output_size = int(
                properties.get(
                    "output_size",
                    1,
                )
            )

            modules.append(
                nn.AdaptiveMaxPool2d(
                    (
                        output_size,
                        output_size,
                    )
                )
            )

        # ================================
        # Global Average Pool
        # ================================

        elif layer_type == "GlobalAveragePool2D":
            modules.append(
                GlobalAveragePool2D()
            )

        # ================================
        # Global Max Pool
        # ================================

        elif layer_type == "GlobalMaxPool2D":
            modules.append(
                GlobalMaxPool2D()
            )

        # ================================
        # BatchNorm2D
        # ================================

        elif layer_type == "BatchNorm2D":
            modules.append(
                nn.BatchNorm2d(
                    num_features=current_channels,
                    eps=float(
                        properties.get(
                            "epsilon",
                            0.00001,
                        )
                    ),
                    momentum=float(
                        properties.get(
                            "momentum",
                            0.1,
                        )
                    ),
                    affine=bool(
                        properties.get(
                            "affine",
                            True,
                        )
                    ),
                )
            )

        # ================================
        # Flatten
        # ================================

        elif layer_type == "Flatten":
            modules.append(
                nn.Flatten()
            )

        # ================================
        # Dense
        # ================================

        elif layer_type == "Dense":
            units = int(
                properties.get(
                    "units",
                    128,
                )
            )

            # LazyLinear จะหาขนาด input
            # ให้อัตโนมัติจาก Tensor จริง
            modules.append(
                nn.LazyLinear(units)
            )

            append_activation(
                modules,
                properties.get(
                    "activation",
                    "relu",
                ),
            )

        # ================================
        # Dropout
        # ================================

        elif layer_type == "Dropout":
            rate = float(
                properties.get(
                    "rate",
                    0.5,
                )
            )

            if not 0 <= rate < 1:
                raise ValueError(
                    "Dropout rate must be "
                    "between 0 and 1."
                )

            modules.append(
                nn.Dropout(p=rate)
            )

        # ================================
        # Output
        # ================================

        elif layer_type == "Output":
            # จำนวน Output มาจาก Dataset
            # ไม่ใช้ properties["classes"]
            modules.append(
                nn.LazyLinear(
                    num_classes
                )
            )

            # สำคัญ:
            # ไม่ใส่ Softmax ตรงนี้
            #
            # ตอน Train จะใช้
            # nn.CrossEntropyLoss()
            # ซึ่งรับ raw logits โดยตรง

        elif layer_type == "Input":
            raise ValueError(
                "Input layer may only appear "
                "as the first layer."
            )

    model = nn.Sequential(
        *modules
    )

    # -----------------------------------
    # Materialize LazyLinear + ทดสอบ Shape
    # -----------------------------------

    dummy_input = torch.zeros(
        1,
        input_channels,
        input_height,
        input_width,
    )

    try:
        model.eval()

        with torch.no_grad():
            dummy_output = model(
                dummy_input
            )

    except Exception as exc:
        raise ValueError(
            "The architecture could not process "
            "the configured input shape "
            f"({input_channels}, "
            f"{input_height}, "
            f"{input_width}). "
            f"PyTorch error: {exc}"
        ) from exc

    if dummy_output.ndim != 2:
        raise ValueError(
            "Model Output must have shape "
            "[batch_size, num_classes]. "
            f"Current output shape is "
            f"{tuple(dummy_output.shape)}."
        )

    if dummy_output.shape[1] != num_classes:
        raise ValueError(
            "Output size does not match "
            "the Dataset class count."
        )

    return BuiltModel(
        model=model,
        input_channels=input_channels,
        input_width=input_width,
        input_height=input_height,
        num_classes=num_classes,
        ordered_layer_types=ordered_types,
    )
    
    