import { test, expect } from "@playwright/test";

const epoch = (number) => ({
  epoch: number,
  train_loss: 1 / number,
  val_loss: 1.2 / number,
  train_accuracy: 60 + number * 10,
  val_accuracy: 50 + number * 10,
});

async function setup(page, status = "completed") {
  const state = {
    jobs: [
      { id: 7, owner_id: 2, project_id: 1, dataset_id: 4, status, current_epoch: 2, total_epochs: 3 },
      { id: 6, owner_id: 2, project_id: 1, dataset_id: 4, status: "completed", current_epoch: 1, total_epochs: 1 },
    ],
    history: { 7: [epoch(2), epoch(1)], 6: [epoch(1)] },
    metricCalls: 0,
    fail: false,
    delay: 0,
  };
  await page.addInitScript(() => localStorage.setItem("user", JSON.stringify({ id: 2, username: "Chart test" })));
  await page.route("http://localhost:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let payload;
    if (path.endsWith("/metrics")) {
      state.metricCalls += 1;
      if (state.fail) {
        await route.fulfill({ status: 503, json: { success: false } });
        return;
      }
      const jobId = path.split("/")[3];
      payload = { success: true, job_id: Number(jobId), metrics: [...state.history[jobId]] };
      if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
    } else if (path.endsWith("/jobs")) {
      payload = { success: true, jobs: state.jobs };
    } else if (path.endsWith("/models")) {
      payload = { success: true, models: [] };
    } else {
      payload = { success: true, datasets: [{ id: 4, name: "Test images", supported: true }] };
    }
    await route.fulfill({ json: payload, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  return state;
}

function charts(page) {
  return page.getByRole("region", { name: "Training Graphs" });
}

async function expectEpochs(page, count) {
  await expect(charts(page).getByText(new RegExp(`· ${count} saved epochs$`))).toBeVisible();
  if (count > 0) {
    for (const title of ["Loss Graph", "Accuracy Graph"]) {
      const plot = page.getByRole("article", { name: title });
      await expect(plot.locator(".recharts-line-dot")).toHaveCount(count * 2);
    }
  }
}

test("loads saved history, restores it after reload, navigation and reopening a tab", async ({ page, context }) => {
  const state = await setup(page);
  await page.goto("/projects/1/training");
  await expectEpochs(page, 2);
  await expect(charts(page).getByText("Saved history", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Accuracy Graph" }).getByText("100%", { exact: true })).toBeVisible();
  await charts(page).getByRole("combobox").selectOption("6");
  await expectEpochs(page, 1);
  await expect(page).toHaveURL(/job=6/);
  await page.reload();
  await expectEpochs(page, 1);
  await page.goto("/");
  await page.goto("/projects/1/training?job=7");
  await expectEpochs(page, 2);
  expect(state.metricCalls).toBeGreaterThanOrEqual(4);

  // A fresh page has no React state or chart cache to restore from.
  await page.close();
  const reopened = await context.newPage();
  await setup(reopened);
  await reopened.goto("/projects/1/training?job=7");
  await expectEpochs(reopened, 2);
});

test("updates after each epoch, avoids duplicates and fetches the final completed epoch", async ({ page }) => {
  const state = await setup(page, "queued");
  state.history[7] = [];
  await page.goto("/projects/1/training");
  await expect(charts(page).getByText("Waiting for the first completed epoch…")).toHaveCount(2);
  state.jobs[0].status = "training";
  state.history[7] = [epoch(1)];
  await expectEpochs(page, 1);
  const calls = state.metricCalls;
  await expect.poll(() => state.metricCalls).toBeGreaterThan(calls);
  await expectEpochs(page, 1);
  state.history[7] = [epoch(1), epoch(2), epoch(3)];
  state.jobs[0].status = "completed";
  await expect(charts(page).getByText("Saved history", { exact: true })).toBeVisible();
  await expectEpochs(page, 3);
  const finishedCalls = state.metricCalls;
  await page.waitForTimeout(3500);
  expect(state.metricCalls).toBe(finishedCalls);
});

test("keeps existing graphs on network failure and recovers automatically", async ({ page }) => {
  const state = await setup(page, "training");
  await page.goto("/projects/1/training");
  await expectEpochs(page, 2);
  state.fail = true;
  await expect(charts(page).getByRole("alert")).toContainText("retrying automatically");
  await expectEpochs(page, 2);
  state.fail = false;
  state.history[7] = [epoch(1), epoch(2), epoch(3)];
  await expectEpochs(page, 3);
  await expect(charts(page).getByRole("alert")).toHaveCount(0);
});

test("does not show a late response from the previous selected job", async ({ page }) => {
  const state = await setup(page);
  state.delay = 1500;
  await page.goto("/projects/1/training?job=7");
  await expect.poll(() => state.metricCalls).toBeGreaterThan(0);
  state.delay = 0;
  await charts(page).getByRole("combobox").selectOption("6");
  await expectEpochs(page, 1);
  await page.waitForTimeout(1800);
  await expectEpochs(page, 1);
  await expect(charts(page).getByRole("combobox")).toHaveValue("6");
});

test("shows an honest empty state for old jobs without recorded epochs", async ({ page }) => {
  const state = await setup(page);
  state.history[7] = [];
  await page.goto("/projects/1/training");
  await expect(charts(page).getByText("No epoch history was saved for this job.")).toHaveCount(2);
  await expect(charts(page).locator(".recharts-line")).toHaveCount(0);
});

test("renders both charts on a narrow screen without horizontal overflow", async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects/1/training");
  await expectEpochs(page, 2);
  const loss = await page.getByRole("article", { name: "Loss Graph" }).boundingBox();
  const accuracy = await page.getByRole("article", { name: "Accuracy Graph" }).boundingBox();
  expect(accuracy.y).toBeGreaterThan(loss.y + loss.height);
  expect(loss.x + loss.width).toBeLessThanOrEqual(390);
  expect(accuracy.x + accuracy.width).toBeLessThanOrEqual(390);
  await charts(page).screenshot({ path: testInfo.outputPath("training-charts-mobile.png") });
});
