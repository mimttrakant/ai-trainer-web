import { test, expect } from "@playwright/test";
import process from "node:process";

// Optional read-only smoke check against existing local training history.
// Supply TRAINING_LIVE_OWNER, TRAINING_LIVE_PROJECT and TRAINING_LIVE_JOB.
test("displays existing database history through the running app", async ({ page, request }, testInfo) => {
  const ownerId = Number(process.env.TRAINING_LIVE_OWNER);
  const projectId = Number(process.env.TRAINING_LIVE_PROJECT);
  const jobId = Number(process.env.TRAINING_LIVE_JOB);
  test.skip(!ownerId || !projectId || !jobId, "An existing training job must be explicitly selected.");

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost:8000/**", (route) => (
    ["GET", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort()
  ));
  const response = await request.get(`http://localhost:8000/training/job/${jobId}/metrics?owner_id=${ownerId}`);
  expect(response.ok()).toBe(true);
  const history = await response.json();
  expect(history.success).toBe(true);
  expect(history.metrics.length).toBeGreaterThan(0);

  await page.addInitScript((id) => {
    localStorage.setItem("user", JSON.stringify({ id, username: "Read-only chart check" }));
  }, ownerId);
  await page.goto(`http://localhost:5173/projects/${projectId}/training?job=${jobId}`);
  const section = page.getByRole("region", { name: "Training Graphs" });
  await expect(section.getByText(`Job #${jobId} · ${history.metrics.length} saved epochs`)).toBeVisible();
  for (const [title, fields] of [
    ["Loss Graph", ["train_loss", "val_loss"]],
    ["Accuracy Graph", ["train_accuracy", "val_accuracy"]],
  ]) {
    const points = history.metrics.reduce((total, row) => total + fields.filter((field) => row[field] != null).length, 0);
    await expect(page.getByRole("article", { name: title }).locator(".recharts-line-dot")).toHaveCount(points);
  }
  await section.screenshot({ path: testInfo.outputPath("training-charts-live.png") });
  await page.reload();
  await expect(section.getByText(`Job #${jobId} · ${history.metrics.length} saved epochs`)).toBeVisible();
  expect(errors).toEqual([]);
});
