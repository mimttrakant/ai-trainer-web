import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image


MODEL_DIR = Path(
    "/app/storage/models/user_2/project_1/version_4"
)

MODEL_PATH = MODEL_DIR / "model.onnx"
METADATA_PATH = MODEL_DIR / "metadata.json"

# เปลี่ยนเป็นรูปที่ต้องการทดสอบ
IMAGE_PATH = Path(
    "/app/storage/test_images/test.jpg"
)


# --------------------------------------
# อ่านชื่อ Class
# --------------------------------------

with METADATA_PATH.open(
    "r",
    encoding="utf-8",
) as file:
    metadata = json.load(file)

class_names = metadata["class_names"]

print("Classes:", class_names)


# --------------------------------------
# โหลดรูป
# --------------------------------------

image = Image.open(
    IMAGE_PATH
).convert("RGB")

image = image.resize(
    (224, 224)
)

image = np.asarray(
    image,
    dtype=np.float32,
) / 255.0


# --------------------------------------
# Normalize
# ต้องเหมือน Dataset Loader ตอน Train
# --------------------------------------

mean = np.array(
    [0.485, 0.456, 0.406],
    dtype=np.float32,
)

std = np.array(
    [0.229, 0.224, 0.225],
    dtype=np.float32,
)

image = (
    image - mean
) / std


# HWC -> CHW

image = np.transpose(
    image,
    (2, 0, 1),
)

# เพิ่ม Batch dimension

image = np.expand_dims(
    image,
    axis=0,
)


# --------------------------------------
# ONNX Runtime
# --------------------------------------

session = ort.InferenceSession(
    str(MODEL_PATH)
)

input_name = (
    session
    .get_inputs()[0]
    .name
)

outputs = session.run(
    None,
    {
        input_name: image
    },
)

logits = outputs[0][0]


# --------------------------------------
# Softmax
# --------------------------------------

exp_values = np.exp(
    logits - np.max(logits)
)

probabilities = (
    exp_values /
    np.sum(exp_values)
)


# --------------------------------------
# Prediction
# --------------------------------------

predicted_index = int(
    np.argmax(probabilities)
)

predicted_class = (
    class_names[
        predicted_index
    ]
)

confidence = float(
    probabilities[
        predicted_index
    ]
)


print()
print(
    "Prediction:",
    predicted_class
)

print(
    "Confidence:",
    f"{confidence * 100:.2f}%"
)

print()

for index, class_name in enumerate(
    class_names
):
    print(
        f"{class_name}: "
        f"{probabilities[index] * 100:.2f}%"
    )