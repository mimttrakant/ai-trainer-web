import { test, expect } from "@playwright/test";
import process from "node:process";

// Optional read-only smoke check against existing local training history.
// Supply TRAINING_LIVE_OWNER, TRAINING_LIVE_JOB and a valid TRAINING_LIVE_TOKEN.
test("displays existing database history through the running app", async ({ page, request }, testInfo) => {
  const ownerId = Number(process.env.TRAINING_LIVE_OWNER);
  const jobId = Number(process.env.TRAINING_LIVE_JOB);
  const token = process.env.TRAINING_LIVE_TOKEN;
  test.skip(!ownerId || !jobId || !token, "An existing training job and valid session must be explicitly selected.");

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/http:\/\/(localhost|127\.0\.0\.1):8000\//, (route) => (
    ["GET", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort()
  ));
  const response = await request.get(`http://127.0.0.1:8000/library/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBe(true);
  const history = await response.json();
  expect(history.success).toBe(true);
  expect(history.metrics.length).toBeGreaterThan(0);

  await page.addInitScript(({ id, token }) => {
    localStorage.setItem("user", JSON.stringify({ id, username: "Read-only chart check" }));
    localStorage.setItem("access_token", token);
  }, { id: ownerId, token });
  await page.goto(`http://localhost:5173/training?job=${jobId}`);
  const section = page.getByRole("region", { name: `Job #${jobId} details` });
  await expect(section.getByText(`${history.metrics.length} saved epochs`, { exact: false })).toBeVisible();
  for (const [title, fields] of [
    ["Loss Graph", ["train_loss", "val_loss"]],
    ["Accuracy Graph", ["train_accuracy", "val_accuracy"]],
  ]) {
    const points = history.metrics.reduce((total, row) => total + fields.filter((field) => row[field] != null).length, 0);
    await expect(page.getByRole("article", { name: title }).locator(".recharts-line-dot")).toHaveCount(points);
  }
  await section.screenshot({ path: testInfo.outputPath("training-charts-live.png") });
  await page.reload();
  await expect(section.getByText(`${history.metrics.length} saved epochs`, { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
