import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const modelJson = {
  format: "ai-trainer-builder", schema_version: 1, model_name: "Test model v3", source_version: 2, draft: false,
  architecture: { nodes: [{ id: "input", type: "default", position: { x: 0, y: 0 },
    data: { label: "Input", layerType: "Input", properties: { channels: 3, width: 32, height: 32 } } }], edges: [] },
};

async function setup(page) {
  const state = {
    models: [{ id: 9, name: "Test model v3", version: 3, project_version: 2, dataset_id: 5, dataset_name: "Original dataset", has_architecture: true, pt_path: "/model.pt", onnx_path: "/model.onnx", allow_download: true }],
    downloads: [], deletes: 0, failDownload: false, failDelete: false, delay: 0,
  };
  await page.addInitScript(() => localStorage.setItem("user", JSON.stringify({ id: 2, username: "Model test" })));
  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/download/")) {
      state.downloads.push(url.pathname);
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.failDownload) {
        await route.fulfill({ status: 404, json: { detail: "Model file is missing from storage." } });
      } else {
        const pt = url.pathname.endsWith("/pt");
        const json = url.pathname.endsWith("/json");
        await route.fulfill({
          contentType: json ? "application/json" : pt ? "application/octet-stream" : "application/zip",
          headers: {
            "Content-Disposition": `attachment; filename="${json ? "model-builder.json" : pt ? "model-v3.pt" : "model-v3-onnx.zip"}"`,
            "Access-Control-Expose-Headers": "Content-Disposition",
          },
          body: json ? JSON.stringify(modelJson) : pt ? "synthetic PT bytes" : "synthetic ZIP bytes",
        });
      }
      return;
    }
    if (route.request().method() === "DELETE") {
      state.deletes += 1;
      expect(url.pathname).toBe("/training/projects/1/models/9");
      expect(url.searchParams.get("owner_id")).toBe("2");
      if (state.failDelete) {
        await route.fulfill({ status: 503, json: { detail: "Unable to remove this model. Try again." } });
      } else {
        state.models = [];
        await route.fulfill({ json: { success: true } });
      }
      return;
    }
    const payload = url.pathname.endsWith("/versions") ? { latest_version: 2, versions: [{ id: 2, version: 2, model_name: "Test model" }] }
      : url.pathname.endsWith("/models") ? { models: state.models }
      : url.pathname.endsWith("/metrics") ? { metrics: [{ epoch: 1, train_loss: 0.5, val_loss: 0.6, train_accuracy: 80, val_accuracy: 75 }] }
        : url.pathname.endsWith("/jobs") ? { jobs: [{ id: 4, dataset_id: 5, status: "completed", current_epoch: 1, total_epochs: 1 }] }
          : { datasets: [{ id: 5, name: "Test dataset", supported: true }] };
    await route.fulfill({ json: { success: true, ...payload } });
  });
  return state;
}

const models = page => page.getByRole("region", { name: "Trained Models", exact: true });

test("downloads PT, ONNX and Builder JSON with server-provided filenames", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/projects/1/training");
  for (const [format, filename, content] of [["PT", "model-v3.pt", "synthetic PT bytes"], ["ONNX", "model-v3-onnx.zip", "synthetic ZIP bytes"], ["JSON", "model-builder.json", JSON.stringify(modelJson)]]) {
    const pending = page.waitForEvent("download");
    await models(page).getByRole("button", { name: `Download ${format}`, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await readFile(await download.path(), "utf8")).toBe(content);
  }
  expect(state.downloads).toEqual([
    "/training/projects/1/models/9/download/pt", "/training/projects/1/models/9/download/onnx", "/training/projects/1/models/9/download/json",
  ]);
  await expect(models(page).getByText(/Extract all files together/)).toBeVisible();
  await expect(models(page).getByText("Training run 3 · Builder Version 2", { exact: true })).toBeVisible();
  await expect(models(page).getByText("Dataset: Original dataset (#5)", { exact: true })).toBeVisible();
});

test("downloads a trained model's JSON and loads it as a draft in another Builder project", async ({ page }) => {
  await setup(page);
  await page.goto("/projects/1/training");
  const pending = page.waitForEvent("download");
  await models(page).getByRole("button", { name: "Download JSON", exact: true }).click();
  const download = await pending;
  const content = await readFile(await download.path());
  await page.route("http://127.0.0.1:8000/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.includes("/editors/") ? { success: true, active_editors: 1, latest_version: 0 }
      : path.endsWith("/versions") ? { success: true, latest_version: 0, versions: [] }
        : { success: true, project: { id: 2, owner_id: 2, name: "New project", version: 0, architecture_json: "{}" } } });
  });
  await page.goto("/projects/2/builder");
  await expect(page.getByRole("button", { name: "Import JSON", exact: true })).toBeEnabled();
  await page.getByLabel("Import Builder JSON", { exact: true }).setInputFiles({ name: "model-builder.json", mimeType: "application/json", buffer: content });
  await expect(page.getByText("Test model v3", { exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.getByLabel("Builder version", { exact: true })).toContainText("first save creates Version 1");
});

test("confirms removal, supports cancel, and retains training graphs after deletion and reload", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/projects/1/training");
  page.once("dialog", async dialog => {
    expect(dialog.message()).toContain("files and training graphs will be retained");
    await dialog.dismiss();
  });
  await models(page).getByRole("button", { name: "Delete model" }).click();
  expect(state.deletes).toBe(0);
  await expect(models(page).getByRole("article")).toHaveCount(1);
  page.once("dialog", dialog => dialog.accept());
  await models(page).getByRole("button", { name: "Delete model" }).click();
  await expect(models(page).getByText("No trained models yet.")).toBeVisible();
  expect(state.deletes).toBe(1);
  await expect(page.getByText("Job #4 · 1 saved epochs", { exact: true })).toBeVisible();
  await models(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(models(page).getByRole("article")).toHaveCount(0);
  await page.reload();
  await expect(models(page).getByText("No trained models yet.")).toBeVisible();
  await expect(page.getByText("Job #4 · 1 saved epochs", { exact: true })).toBeVisible();
});

test("reports failures without deleting a card and prevents concurrent actions during download", async ({ page }) => {
  const state = await setup(page);
  state.failDownload = true;
  state.delay = 1000;
  await page.goto("/projects/1/training");
  await models(page).getByRole("button", { name: "Download PT", exact: true }).click();
  await expect(models(page).getByRole("button", { name: "Downloading PT…" })).toBeDisabled();
  await expect(models(page).getByRole("button", { name: "Delete model" })).toBeDisabled();
  await expect(models(page).getByRole("alert")).toHaveText("Model file is missing from storage.");
  await expect(models(page).getByRole("button", { name: "Download PT", exact: true })).toBeEnabled();
  state.failDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await models(page).getByRole("button", { name: "Delete model" }).click();
  await expect(models(page).getByRole("alert")).toContainText("Unable to remove this model.");
  await expect(models(page).getByRole("article")).toHaveCount(1);
});

test("disables missing or restricted formats and fits model actions on mobile", async ({ page }) => {
  const state = await setup(page);
  state.models[0].onnx_path = null;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects/1/training");
  await expect(models(page).getByRole("button", { name: "Download ONNX", exact: true })).toBeDisabled();
  const buttons = models(page).locator(".model-actions__buttons");
  const box = await buttons.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await buttons.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  state.models[0].allow_download = false;
  await models(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(models(page).getByRole("button", { name: "Download PT", exact: true })).toBeDisabled();
  expect(state.downloads).toEqual([]);
});
