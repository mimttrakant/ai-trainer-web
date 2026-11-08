import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { setupTraining, job, metric } from "./training-fixture";

const logs = page => page.getByRole("region", { name: "My Training Jobs", exact: true });

test("hiding a log preserves data, persists on reload, fills pagination and isolates accounts", async ({ page }) => {
  const state = await setupTraining(page, { jobs: Array.from({ length: 12 }, (_, i) => job(i + 1)) });
  await page.goto("/training?job=12");
  await expect(logs(page).getByRole("button", { name: /^View Job/ })).toHaveCount(10);
  await logs(page).getByRole("button", { name: "Hide Job #12 log", exact: true }).click();
  await expect(page).not.toHaveURL(/job=12/);
  await expect(logs(page).getByRole("button", { name: "View Job #12", exact: true })).toHaveCount(0);
  await expect(logs(page).getByRole("button", { name: "View Job #2", exact: true })).toBeVisible();
  await expect(logs(page)).toContainText("11 items");
  await page.reload();
  await expect(logs(page)).toContainText("11 items");
  expect(state.jobs).toHaveLength(12); expect(state.deletes).toBe(0);
  await page.evaluate(() => { localStorage.setItem("user", JSON.stringify({ id: 2, username: "bob" })); });
  // Navigate within the SPA to remount the workspace under the other account.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Training", exact: true }).click();
  await expect(logs(page).getByRole("button", { name: "View Job #12", exact: true })).toBeVisible();
});

test("Delete log clears every page despite search, keeps results and allows new jobs", async ({ page }) => {
  const state = await setupTraining(page, { jobs: Array.from({ length: 23 }, (_, i) => job(i + 1)) });
  await page.goto("/training?job=4");
  await page.getByRole("searchbox", { name: "Search jobs", exact: true }).fill("4");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Delete log", exact: true }).click();
  await expect(logs(page).getByRole("button", { name: "View Job #4", exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete log", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search jobs", exact: true }).fill("");
  await expect(logs(page)).toContainText("No training jobs found.");
  await page.reload(); await expect(logs(page)).toContainText("No training jobs found.");
  expect(state.jobs).toHaveLength(23); expect(state.deletes).toBe(0);
  await page.goto("/training?job=4");
  await expect(page.getByRole("article", { name: "Loss Graph" }).locator(".recharts-line-dot")).toHaveCount(4);
  state.jobs.push(job(24, "queued"));
  await page.getByRole("button", { name: "Refresh jobs and weights", exact: true }).click();
  await expect(logs(page).getByRole("button", { name: "View Job #24", exact: true })).toBeVisible();
});

test("CSV exports saved numeric epochs and handles empty histories and download failure", async ({ page }) => {
  const state = await setupTraining(page, { jobs: [job(4), job(5, "queued")], metrics: { 4: [metric(1), metric(2)], 5: [] } });
  await page.goto("/training?job=4");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = await pending;
  expect(csv.suggestedFilename()).toBe("job-4-metrics.csv");
  expect(await readFile(await csv.path(), "utf8")).toBe("epoch,train_loss,val_loss,train_accuracy,val_accuracy\r\n1,2,2.5,51,46\r\n2,1,1.25,52,47\r\n");
  state.failCsv = true;
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  await expect(page.getByText("CSV export failed. Retry.")).toBeVisible();
  await page.getByRole("button", { name: "View Job #5", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export CSV", exact: true })).toBeDisabled();
});

test("active jobs can be hidden but cannot be deleted; failed jobs without weights can be deleted", async ({ page }) => {
  const state = await setupTraining(page, { jobs: [job(4, "training"), job(5, "failed")] });
  await page.goto("/training?job=4");
  await expect(page.getByRole("button", { name: "Delete Job", exact: true })).toBeDisabled();
  await logs(page).getByRole("button", { name: "Hide Job #4 log", exact: true }).click();
  expect(state.deletes).toBe(0);
  await logs(page).getByRole("button", { name: "View Job #5", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete Job", exact: true }).click();
  await expect(page.getByRole("region", { name: "Job #5 details", exact: true })).toHaveCount(0);
  expect(state.jobs.map(j => j.id)).toEqual([4]);
});
