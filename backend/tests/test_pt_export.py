"""Round-trip full modules, including custom pooling, outside the application."""
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import torch
from training.model_builder import build_classification_model
from training.pt_export import FULL_PT_FILENAME, write_full_model
from training import exporter
from unittest.mock import patch


def architecture(pool):
    layers = [("input", "Input", {"channels": 3, "width": 8, "height": 8}),
              ("norm", "BatchNorm2D", {}), ("pool", pool, {}), ("out", "Output", {})]
    return json.dumps({"nodes": [{"id": name, "data": {"layerType": kind, "properties": props}} for name, kind, props in layers],
                       "edges": [{"source": a[0], "target": b[0]} for a, b in zip(layers, layers[1:])]})


class FullPTExportTests(unittest.TestCase):
    def test_training_export_bundle_keeps_full_pt_checkpoint_and_onnx_separate(self):
        with TemporaryDirectory() as temporary:
            graph = architecture("Flatten")
            original = build_classification_model(graph, 2).model.eval()
            with patch.object(exporter, "STORAGE_ROOT", Path(temporary)):
                paths = exporter.export_trained_model(
                    model=original, optimizer=None, owner_id=1, project_id=1, training_job_id=1,
                    version=1, epoch=1, architecture_json=graph, class_names=["a", "b"],
                    best_val_accuracy=75, best_val_loss=0.4, input_channels=3, input_height=8,
                    input_width=8, project_version=2, model_name="Tiny model")
            loaded = torch.load(paths["pt_path"], weights_only=False, map_location="cpu")
            self.assertIsInstance(loaded, torch.nn.Module)
            checkpoint = torch.load(paths["checkpoint_path"], weights_only=True)
            self.assertEqual(checkpoint["architecture_json"], graph)
            self.assertEqual(checkpoint["class_names"], ["a", "b"])
            sample = torch.randn(2, 3, 8, 8)
            with torch.no_grad():
                torch.testing.assert_close(loaded(sample), original(sample))
            import onnx
            onnx.checker.check_model(paths["onnx_path"])
            self.assertEqual(json.loads(Path(paths["metadata_path"]).read_text())["project_version"], 2)

    def test_export_loads_without_repo_classes_and_matches_predictions(self):
        for pool in ["GlobalAveragePool2D", "GlobalMaxPool2D", "Flatten"]:
            with self.subTest(pool=pool), TemporaryDirectory() as temporary:
                graph = architecture(pool)
                original = build_classification_model(graph, 2).model.eval()
                original[0].running_mean.fill_(0.3)
                with patch.object(exporter, "STORAGE_ROOT", Path(temporary)):
                    path = exporter.save_model_pt(original, 1, 1, 1, graph, ["apple", "banana"])
                self.assertEqual(path.name, FULL_PT_FILENAME)
                loaded = torch.load(path, map_location="cpu", weights_only=False)
                self.assertIsInstance(loaded, torch.nn.Module)
                self.assertFalse(loaded.training)
                self.assertEqual(loaded.input_shape, (3, 8, 8))
                self.assertEqual(loaded.class_names, ["apple", "banana"])
                for batch in [1, 3]:
                    sample = torch.randn(batch, 3, 8, 8)
                    with torch.no_grad():
                        torch.testing.assert_close(loaded(sample), original(sample))
                result = subprocess.run([sys.executable, "-I", "-c",
                    "import sys,torch; m=torch.load(sys.argv[1],map_location='cpu',weights_only=False); "
                    "assert isinstance(m,torch.nn.Module); assert m(torch.zeros(2,*m.input_shape)).shape==(2,2); "
                    "assert not any(k.startswith('training') for k in sys.modules); print('standalone OK')", str(path)],
                    cwd=temporary, capture_output=True, text=True, timeout=45)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("standalone OK", result.stdout)

    def test_invalid_class_information_does_not_publish_file(self):
        with TemporaryDirectory() as temporary:
            graph = architecture("Flatten")
            original = build_classification_model(graph, 2).model
            path = Path(temporary) / FULL_PT_FILENAME
            with self.assertRaises(ValueError):
                write_full_model(original.state_dict(), graph, ["only one"], 2, path)
            self.assertFalse(path.exists())

    def test_failed_serialization_does_not_replace_existing_artifact(self):
        with TemporaryDirectory() as temporary:
            graph = architecture("Flatten")
            original = build_classification_model(graph, 2).model
            path = Path(temporary) / FULL_PT_FILENAME
            path.write_bytes(b"previous artifact")
            with patch("training.pt_export.torch.save", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    write_full_model(original.state_dict(), graph, ["a", "b"], 2, path)
            self.assertEqual(path.read_bytes(), b"previous artifact")
            self.assertEqual(list(Path(temporary).glob(".pt-export-*")), [])
