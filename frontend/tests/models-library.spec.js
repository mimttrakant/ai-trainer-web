import { test, expect } from "@playwright/test";

async function setup(page) {
  const state = { clones: [], mine: [{ id: 1, name: "Mine", display_name: "alice/Mine", description: "My architecture", version: 1, visibility: "private", is_owner: true }] };
  await page.addInitScript(() => { localStorage.setItem("user", JSON.stringify({ id: 1, username: "alice" })); localStorage.setItem("access_token", "test-token"); });
  await page.route("http://127.0.0.1:8000/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/clone")) {
      state.clones.push(route.request().postDataJSON());
      const model = { id: 3, name: "Shared", display_name: "alice/Shared", version: 1, visibility: "private", is_owner: true };
      state.mine.unshift(model); return route.fulfill({ json: { success: true, model } });
    }
    if (url.pathname.endsWith("/versions")) return route.fulfill({ json: { success: true, versions: [{ version: 5, model_name: "Latest" }, { version: 2, model_name: "Older" }] } });
    if (url.pathname === "/library/models" && route.request().method() === "POST") return route.fulfill({ json: { success: true, model: { id: 9 } } });
    if (url.pathname === "/project/9") return route.fulfill({ json: { success: true, project: { id: 9, owner_id: 1, name: "Fresh", model_name: "Fresh", description: "Demo", version: 0, architecture_json: "{}" } } });
    if (url.pathname.includes("/editors/")) return route.fulfill({ json: { success: true, active_editors: 1, latest_version: 0 } });
    const items = url.searchParams.get("scope") === "public" ? [{ id: 2, name: "Shared", display_name: "bob/Shared", description: "Public architecture", version: 5, visibility: "public", is_owner: false }] : state.mine;
    return route.fulfill({ json: { success: true, total: items.length, items } });
  });
  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "alice/Mine", exact: true })).toBeVisible();
  return state;
}

test("My Models uses rows with Edit, delete and visibility but no Train action", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveAttribute("href", "/models/1/builder");
  await expect(page.getByRole("button", { name: "Train", exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch")).toBeVisible();
  await page.getByRole("button", { name: "Public (Community)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "bob/Shared", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});

test("cloning an older version places an independent Version 1 in My Models", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Public (Community)", exact: true }).click();
  await page.getByRole("button", { name: "Clone", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Model version", { exact: true })).toHaveValue("5");
  await modal.getByLabel("Model version", { exact: true }).selectOption("2");
  await expect(modal.getByLabel("Owner prefix")).toHaveText("alice/");
  await modal.getByRole("button", { name: "Clone selected version", exact: true }).click();
  await expect(page.getByRole("heading", { name: "alice/Shared", exact: true })).toBeVisible();
  expect(state.clones).toEqual([{ version: 2, name: "Shared" }]);
  await expect(page.getByRole("button", { name: "My Models", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Create New Model navigates directly into Builder with the supplied name", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Create New Model", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Model name").fill("Fresh");
  await page.getByRole("button", { name: "Create and Edit", exact: true }).click();
  await expect(page).toHaveURL(/\/models\/9\/builder$/);
  await expect(page.getByRole("heading", { name: "alice/Fresh", exact: true })).toBeVisible();
});
