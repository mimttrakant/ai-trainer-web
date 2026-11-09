import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

async function setup(page) {
  const state = {
    project: { id: 1, owner_id: 2, name: "Project A", model_name: "Project A", version: 0, architecture_json: "{}" },
    saves: [], fail: false, conflict: false, delay: 0,
    revisions: [], activeEditors: 1, remoteVersion: 0,
  };
  await page.addInitScript(() => localStorage.setItem("user", JSON.stringify({ id: 2, username: "Builder test" })));
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/editors/")) {
      await route.fulfill({ json: { success: true, active_editors: state.activeEditors,
        latest_version: Math.max(state.project.version, state.remoteVersion) } });
      return;
    }
    const revisions = state.revisions.length ? state.revisions : state.project.version ? [{ ...state.project }] : [];
    if (url.pathname.endsWith("/versions")) {
      await route.fulfill({ json: { success: true, latest_version: state.project.version,
        versions: revisions.map(row => ({ id: row.version, version: row.version, model_name: row.model_name })) } });
      return;
    }
    if (url.pathname.includes("/versions/")) {
      const revision = revisions.find(row => row.version === Number(url.pathname.split("/").at(-1)));
      await route.fulfill({ json: { success: true, revision, latest_version: state.project.version } });
      return;
    }
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
        state.revisions = [{ ...state.project }, ...revisions];
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

const exampleGraph = () => ({
  nodes: [
    { id: "input", type: "default", position: { x: 10, y: 20 }, data: { label: "Input", layerType: "Input", properties: { channels: 3, width: 32, height: 32 } } },
    { id: "output", type: "default", position: { x: 10, y: 180 }, data: { label: "Output", layerType: "Output", properties: {} } },
  ],
  edges: [{ id: "input-output", source: "input", target: "output" }],
});

const uploadJson = (page, data) => page.getByLabel("Import Builder JSON", { exact: true }).setInputFiles({
  name: "design.json", mimeType: "application/json", buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
});

test("exports the current draft and imports it into a new project with its own version sequence", async ({ page }) => {
  const state = await setup(page);
  state.project.version = 3;
  const legacyGraph = exampleGraph();
  legacyGraph.nodes[1].data.properties = { classes: 2, activation: "softmax" };
  state.project.architecture_json = JSON.stringify(legacyGraph);
  await page.goto("/projects/1/builder");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("Portable classifier");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Portable-classifier-v3-draft.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported.format).toBe("ai-trainer-builder");
  expect(exported.source_version).toBe(3);
  expect(exported.draft).toBe(true);
  expect(exported.architecture).toEqual(exampleGraph());
  expect(exported).not.toHaveProperty("owner_id");
  expect(state.saves).toHaveLength(0);

  state.project = { ...state.project, id: 2, name: "Project B", model_name: "New model", version: 0, architecture_json: "{}" };
  state.revisions = [];
  await page.goto("/projects/2/builder");
  await expect(page.getByRole("button", { name: "Import JSON", exact: true })).toBeEnabled();
  await uploadJson(page, exported);
  await expect(page.getByText(/JSON imported as a draft/)).toBeVisible();
  await expect(page.getByLabel("Builder version", { exact: true })).toContainText("first save");
  await expect(page.getByText("Portable classifier", { exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  expect(state.saves).toHaveLength(0);
  await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 1");
  expect(state.saves[0].expected_version).toBe(0);
  expect(JSON.parse(state.project.architecture_json).edges).toEqual(exampleGraph().edges);
  await page.reload();
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 1");
  await expect(page.getByText("Portable classifier", { exact: true })).toBeVisible();
});

test("rejects malformed, unsupported and oversized imports without replacing the canvas", async ({ page }) => {
  const state = await setup(page);
  state.project.version = 2;
  state.project.architecture_json = JSON.stringify(exampleGraph());
  await page.goto("/projects/1/builder");
  await expect(page.getByRole("button", { name: "Import JSON", exact: true })).toBeEnabled();
  const duplicate = exampleGraph();
  duplicate.nodes[1].id = "input";
  const unknown = exampleGraph();
  unknown.nodes[0].data.layerType = "UnknownLayer";
  const invalidEdge = exampleGraph();
  invalidEdge.edges[0].target = "missing";
  const invalidProperty = exampleGraph();
  invalidProperty.nodes[0].data.properties.width = 1000000000;
  for (const [data, message] of [
    ["not JSON", "This file is not valid JSON."],
    [{ format: "ai-trainer-builder", schema_version: 99 }, "Unsupported Builder JSON format or schema version."],
    [duplicate, "Every layer must have a unique string ID."],
    [unknown, "Unsupported layer type: UnknownLayer"],
    [invalidEdge, "Every connection must refer to existing layers."],
    [invalidProperty, "Invalid Input property: width"],
    [" ".repeat(2_000_001), "JSON files must be no larger than 2 MB."],
  ]) {
    await uploadJson(page, data);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 2");
  }
  expect(state.saves).toHaveLength(0);
});

test("confirms replacement and accepts legacy nodes/edges JSON without changing version on import", async ({ page }) => {
  const state = await setup(page);
  state.project.version = 2;
  state.project.architecture_json = JSON.stringify(exampleGraph());
  await page.goto("/projects/1/builder");
  await expect(page.getByRole("button", { name: "Import JSON", exact: true })).toBeEnabled();
  const imported = { nodes: [exampleGraph().nodes[0]], edges: [] };
  page.once("dialog", dialog => dialog.dismiss());
  await uploadJson(page, imported);
  await expect(page.getByRole("button", { name: "Import JSON", exact: true })).toBeEnabled();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  page.once("dialog", dialog => dialog.accept());
  await uploadJson(page, imported);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 2");
  await expect(page.getByText("Project A", { exact: true })).toBeVisible();
  expect(state.saves).toHaveLength(0);
});

test("loads an older revision and saves a new row after the current head rather than overwriting history", async ({ page }) => {
  const state = await setup(page);
  state.project = { ...state.project, version: 3, model_name: "Latest model", architecture_json: JSON.stringify(exampleGraph()) };
  const original = { ...state.project, version: 1, model_name: "Original model" };
  state.revisions = [{ ...state.project }, original];
  await page.goto("/projects/1/builder");
  await page.getByRole("combobox", { name: "Saved Builder version", exact: true }).selectOption("1");
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 1");
  await expect(page.getByText("Original model", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("Edited original");
  await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 4");
  expect(state.saves[0].expected_version).toBe(3);
  expect(original.model_name).toBe("Original model");
  await expect(page.getByRole("combobox", { name: "Saved Builder version", exact: true })).toHaveValue("4");
});

test("warns about concurrent editors and newer saves without changing a local draft", async ({ page }) => {
  const state = await setup(page);
  state.project = { ...state.project, version: 3, architecture_json: JSON.stringify(exampleGraph()) };
  state.activeEditors = 2;
  await page.goto("/projects/1/builder");
  await expect(page.getByText(/2 active Builder session/)).toBeVisible();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("My unsaved draft");
  state.remoteVersion = 4;
  state.conflict = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("A newer Builder Version 4 exists");
  await expect(page.getByRole("textbox", { name: "Model name" })).toHaveValue("My unsaved draft");
  await page.getByRole("button", { name: "Save Architecture", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved elsewhere");
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText("Builder Version 3");
});
