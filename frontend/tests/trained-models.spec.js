import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { setupTraining } from "./training-fixture";

const weight = { id: 9, name: "Classifier", display_name: "alice/Classifier", project_version: 2, dataset_name: "alice/Fruit", training_job_id: 4, has_pt: true, has_onnx: true, allow_download: true, is_owner: true, visibility: "private" };
const weights = page => page.getByRole("region", { name: "Trained Weights", exact: true });

test("downloads PT and ONNX with server filenames and no JSON action", async ({ page }) => {
  const state = await setupTraining(page, { weights: [{ ...weight }] }); await page.goto("/training");
  for (const [format, filename, bytes] of [["PT", "model.pt", "synthetic PT"], ["ONNX", "model-onnx.zip", "synthetic ZIP"]]) {
    const pending = page.waitForEvent("download"); await weights(page).getByRole("button", { name: `Download ${format}`, exact: true }).click(); const file = await pending;
    expect(file.suggestedFilename()).toBe(filename); expect(await readFile(await file.path(), "utf8")).toBe(bytes);
  }
  expect(state.downloads).toEqual(["/library/weights/9/download/pt", "/library/weights/9/download/onnx"]);
  await expect(page.getByRole("button", { name: "Download JSON", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Model", exact: true })).toHaveCount(0);
});

test("delete confirms, supports cancel, removes only weight and preserves graphs after reload", async ({ page }) => {
  const state = await setupTraining(page, { weights: [{ ...weight }] }); await page.goto("/training?job=4");
  page.once("dialog", dialog => dialog.dismiss()); await weights(page).getByRole("button", { name: "Delete Weight", exact: true }).click(); expect(state.deletes).toBe(0);
  page.once("dialog", dialog => dialog.accept()); await weights(page).getByRole("button", { name: "Delete Weight", exact: true }).click();
  await expect(weights(page).getByText("No trained weights found in this section.")).toBeVisible();
  await page.reload(); await expect(page.getByRole("article", { name: "Loss Graph" }).locator(".recharts-line-dot")).toHaveCount(4); expect(state.deletes).toBe(1);
});

test("sharing exposes graphs and downloads, community users cannot delete others' weights", async ({ page }) => {
  const state = await setupTraining(page, { weights: [{ ...weight }, { ...weight, id: 10, display_name: "bob/Shared", is_owner: false, visibility: "public" }] }); await page.goto("/training");
  page.once("dialog", dialog => dialog.accept()); await weights(page).getByRole("switch").click();
  await expect(weights(page).getByRole("switch")).toHaveAttribute("aria-checked", "true"); expect(state.weights[0].visibility).toBe("public");
  await weights(page).getByRole("button", { name: "Public (Community)", exact: true }).click();
  const row = weights(page).getByRole("article").filter({ has: page.getByRole("heading", { name: "bob/Shared", exact: true }) });
  await expect(row.getByRole("button", { name: "Delete Weight", exact: true })).toHaveCount(0); await expect(row.getByRole("switch")).toHaveCount(0);
  await row.getByRole("button", { name: "View results", exact: true }).click(); await expect(page.getByRole("article", { name: "Loss Graph" }).locator(".recharts-line-dot")).toHaveCount(4);
});

test("failed operations keep weight and disable concurrent actions during download", async ({ page }) => {
  const state = await setupTraining(page, { weights: [{ ...weight }], failDownload: true, downloadDelay: 700 }); await page.goto("/training");
  await weights(page).getByRole("button", { name: "Download PT", exact: true }).click();
  await expect(weights(page).getByRole("button", { name: "Delete Weight", exact: true })).toBeDisabled();
  await expect(weights(page).getByText("Weight file is missing.")).toBeVisible();
  state.failDelete = true; page.once("dialog", dialog => dialog.accept()); await weights(page).getByRole("button", { name: "Delete Weight", exact: true }).click();
  await expect(weights(page).getByText("Unable to delete weight. Retry.")).toBeVisible(); await expect(weights(page).getByRole("heading", { name: "alice/Classifier", exact: true })).toBeVisible();
});

test("missing formats are disabled and actions fit mobile width", async ({ page }, testInfo) => {
  await setupTraining(page, { weights: [{ ...weight, has_onnx: false }] }); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/training");
  await expect(weights(page).getByRole("button", { name: "Download ONNX", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("weights-mobile.png"), fullPage: true });
});
