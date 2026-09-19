import { test, expect } from "@playwright/test";

async function setup(page) {
  const state = {
    project: { id: 1, owner_id: 2, name: "Project A", model_name: "Project A", version: 0, architecture_json: "{}" },
    saves: [], fail: false, conflict: false, delay: 0,
  };
  await page.addInitScript(() => localStorage.setItem("user", JSON.stringify({ id: 2, username: "Builder test" })));
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      state.saves.push(body);
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.fail || state.conflict) {
        await route.fulfill({ status: state.conflict ? 409 : 503, json: { detail: state.conflict
          ? "This project was saved elsewhere. Export your draft before reloading the latest version." : "Unable to save architecture." } });
      } else {
        expect(body.owner_id).toBe(2);
        expect(body.expected_version).toBe(state.project.version);
        state.project = { ...state.project, architecture_json: body.architecture_json, model_name: body.model_name, version: state.project.version + 1 };
        await route.fulfill({ json: { success: true, version: state.project.version, model_name: state.project.model_name } });
      }
    } else {
      await route.fulfill({ json: { success: true, project: state.project } });
    }
  });
  return state;
}

test("names the model and increments Builder versions on each save, including after reload", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/projects/1/builder");
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Not saved yet · first save creates Version 1");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("My classifier");
  await page.getByRole("button", { name: "+ Input", exact: true }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  for (const version of [1, 2, 3]) {
    await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
    await expect(page.getByLabel("Builder version", { exact: true })).toHaveText(`Builder Version ${version}`);
  }
  expect(state.saves).toHaveLength(3);
  await page.reload();
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 3");
  await expect(page.getByText("My classifier", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("disables repeated save clicks and keeps the draft and version after failures or conflicts", async ({ page }) => {
  const state = await setup(page);
  state.delay = 1000;
  state.fail = true;
  await page.goto("/projects/1/builder");
  await page.getByRole("button", { name: "+ Input", exact: true }).click();
  await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Unable to save architecture.");
  await expect(page.getByLabel("Builder version", { exact: true })).toContainText("first save");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  state.fail = false;
  state.conflict = true;
  state.delay = 0;
  await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved elsewhere");
  await expect(page.getByLabel("Builder version", { exact: true })).toContainText("first save");
  expect(state.saves).toHaveLength(2);
});

test("does not increment for renaming until Save and rejects a blank name", async ({ page }) => {
  const state = await setup(page);
  state.project.version = 4;
  state.project.architecture_json = JSON.stringify({ nodes: [{ id: "input", type: "default", position: { x: 100, y: 100 }, data: { label: "Input", layerType: "Input", properties: {} } }], edges: [] });
  await page.goto("/projects/1/builder");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill(" ");
  await expect(page.getByRole("button", { name: "Save Architecture", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Model name" }).fill("Renamed model");
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 4");
  expect(state.saves).toHaveLength(0);
  await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 5");
});
