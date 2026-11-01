import { test, expect } from "@playwright/test";
import { setupTraining, chooseTraining, job, metric } from "./training-fixture";

test("saved graphs survive reload, navigation and reopening a tab", async ({ page, context }) => {
  await setupTraining(page); await page.goto("/training?job=4");
  const chart = page.getByRole("article", { name: "Loss Graph", exact: true });
  await expect(chart.locator(".recharts-line-dot")).toHaveCount(4);
  await page.reload(); await expect(chart.locator(".recharts-line-dot")).toHaveCount(4);
  await page.getByRole("link", { name: "Models", exact: true }).click(); await page.goBack();
  await expect(chart.locator(".recharts-line-dot")).toHaveCount(4);
  const another = await context.newPage(); await setupTraining(another); await another.goto("/training?job=4");
  await expect(another.getByRole("article", { name: "Accuracy Graph" }).locator(".recharts-line-dot")).toHaveCount(4);
});

test("polls live epochs without duplicates or unchanged chart redraws and loads final completion", async ({ page }) => {
  const state = await setupTraining(page, { jobs: [job(4, "training")] }); await page.goto("/training?job=4");
  const chart = page.getByRole("article", { name: "Loss Graph" }); await expect(chart.locator(".recharts-line-dot")).toHaveCount(4);
  await chart.evaluate(element => { window.chartMutations = 0; new MutationObserver(rows => { window.chartMutations += rows.length; }).observe(element, { subtree: true, childList: true, attributes: true, characterData: true }); });
  const initial = state.detailCalls; await expect.poll(() => state.detailCalls).toBeGreaterThan(initial);
  expect(await page.evaluate(() => window.chartMutations)).toBe(0);
  state.metrics[4].push(metric(3)); state.jobs[0].current_epoch = 3;
  await expect(chart.locator(".recharts-line-dot")).toHaveCount(6);
  state.jobs[0].status = "completed"; state.metrics[4].push(metric(4));
  await expect(chart.locator(".recharts-line-dot")).toHaveCount(8);
});

test("retains saved graphs on network failure and recovers, but clears revoked public results", async ({ page }) => {
  const state = await setupTraining(page, { jobs: [job(4, "training")] }); await page.goto("/training?job=4");
  const chart = page.getByRole("article", { name: "Loss Graph" }); await expect(chart.locator(".recharts-line-dot")).toHaveCount(4);
  state.failDetails = true; await expect(page.getByText("Temporary network failure.")).toBeVisible();
  await expect(chart.locator(".recharts-line-dot")).toHaveCount(4);
  state.failDetails = false; await page.getByRole("button", { name: "Retry results" }).click(); await expect(page.getByText("Temporary network failure.")).toHaveCount(0);
  state.revoked = true; await expect(page.getByText("Training result is private or unavailable.")).toBeVisible(); await expect(chart).toHaveCount(0);
});

test("switching jobs ignores late responses and empty histories are explicit", async ({ page }) => {
  await setupTraining(page, { jobs: [job(4), job(5)], detailDelay: { 4: 1000 }, metrics: { 4: [metric(1)], 5: [] } });
  await page.goto("/training?job=4"); await page.getByRole("button", { name: "View Job #5", exact: true }).click();
  await expect(page.getByRole("region", { name: "Job #5 details" })).toBeVisible();
  await expect(page.getByText("No completed epochs yet.")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Job #4 details" })).toHaveCount(0);
});

test("chooses exact saved version, separates setup sections and selects newly submitted job", async ({ page }) => {
  const state = await setupTraining(page); await page.goto("/training?job=4"); await chooseTraining(page);
  await page.getByLabel("Model version", { exact: true }).selectOption("1");
  await expect(page.getByRole("group", { name: "1. Model", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "2. Dataset", exact: true })).toContainText("2 classes");
  await expect(page.getByRole("group", { name: "3. Parameters", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await expect(page).toHaveURL(/job=99/); await expect(page.getByRole("region", { name: "Job #99 details" })).toBeVisible();
  expect(state.submits[0]).toMatchObject({ model_id: 1, version: 1, dataset_id: 1, total_epochs: 10, batch_size: 32, learning_rate: 0.001 });
});

test("changing model resets to latest version and rejected submission preserves selected history", async ({ page }) => {
  const state = await setupTraining(page); await page.goto("/training?job=4"); await chooseTraining(page);
  await page.getByLabel("Model version", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Choose model", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Public (Community)", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /bob\/Community/ }).click();
  await expect(page.getByLabel("Model version", { exact: true })).toHaveValue("9");
  await expect(page.getByLabel("Model version", { exact: true }).locator("option")).toHaveCount(2);
  state.failSubmit = true; await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await expect(page.getByText("Model is no longer public.")).toBeVisible(); await expect(page).toHaveURL(/job=4/);
});

test("model selector searches and paginates in a bounded popup", async ({ page }) => {
  await setupTraining(page, { manyModels: true }); await page.goto("/training");
  await page.getByRole("button", { name: "Choose model", exact: true }).click(); const modal = page.getByRole("dialog");
  await expect(modal.locator(".training-job-row")).toHaveCount(10); await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByText("alice/Model 11", { exact: true })).toBeVisible();
  await modal.getByRole("searchbox", { name: "Search choices" }).fill("Model 23");
  await expect(modal.locator(".training-job-row")).toHaveCount(1); await expect(modal.getByText("alice/Model 23")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(modal).toHaveCount(0);
});

test("mobile charts and setup fit without horizontal overflow", async ({ page }, testInfo) => {
  await setupTraining(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/training?job=4");
  await expect(page.getByRole("article", { name: "Accuracy Graph" }).locator(".recharts-line-dot")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("training-mobile.png"), fullPage: true });
});
