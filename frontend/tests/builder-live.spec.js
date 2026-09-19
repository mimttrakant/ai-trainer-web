import { test, expect } from "@playwright/test";
import process from "node:process";
import { readFile } from "node:fs/promises";

test("reads the existing Builder version and exports JSON without saving the real project", async ({ page, request }) => {
  const ownerId = Number(process.env.TRAINING_LIVE_OWNER);
  const projectId = Number(process.env.TRAINING_LIVE_PROJECT);
  test.skip(!ownerId || !projectId, "Explicitly select an existing project for this read-only check.");
  const result = await request.get(`http://127.0.0.1:8000/project/${projectId}`);
  expect(result.ok()).toBe(true);
  const { project } = await result.json();
  expect(project.owner_id).toBe(ownerId);
  const original = JSON.parse(project.architecture_json);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/http:\/\/(localhost|127\.0\.0\.1):8000\//, route => (
    ["GET", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort()
  ));
  await page.addInitScript(id => localStorage.setItem("user", JSON.stringify({ id, username: "Read-only Builder check" })), ownerId);
  await page.goto(`http://localhost:5173/projects/${projectId}/builder`);
  await expect(page.getByLabel("Builder version", { exact: true })).toHaveText(`Builder Version ${project.version}`);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await pending;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported.model_name).toBe(project.model_name);
  expect(exported.source_version).toBe(project.version);
  expect(exported.architecture.nodes).toHaveLength(original.nodes.length);
  expect(exported.architecture.edges).toHaveLength(original.edges.length);
  expect(exported.draft).toBe(false);
  const after = (await (await request.get(`http://127.0.0.1:8000/project/${projectId}`)).json()).project;
  expect(after.version).toBe(project.version);
  expect(after.architecture_json).toBe(project.architecture_json);
  expect(errors).toEqual([]);
});
