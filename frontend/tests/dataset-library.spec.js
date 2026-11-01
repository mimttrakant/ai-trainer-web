import { test, expect } from "@playwright/test";

async function setup(page) {
  const state = { downloads: 0, imports: [], scopes: [], detailCalls: 0, visibility: "private" };
  await page.addInitScript(() => { localStorage.setItem("user", JSON.stringify({ id: 1, username: "alice" })); localStorage.setItem("access_token", "fixture-token"); });
  await page.route("http://127.0.0.1:8000/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    expect(request.headers().authorization).toBe("Bearer fixture-token");
    if (url.pathname === "/datasets/url") { state.imports.push(request.postDataJSON()); return route.fulfill({ json: { success: true } }); }
    if (url.pathname.endsWith("/visibility")) { state.visibility = request.postDataJSON().visibility; return route.fulfill({ json: { success: true } }); }
    if (url.pathname.endsWith("/download")) { state.downloads++; return route.fulfill({ contentType: "application/zip", body: "zip fixture" }); }
    if (url.pathname.endsWith("/details")) {
      state.detailCalls++;
      return route.fulfill({ json: { success: true, classes: [{ name: "apple", image_count: 30, splits: {} }, { name: "banana", image_count: 20, splits: {} }], detected_class_count: 2, classified_image_count: 50, unassigned_image_count: 0 } });
    }
    const scope = url.searchParams.get("scope"); state.scopes.push(scope);
    const isMine = scope === "mine";
    const name = isMine ? "alice/Fruit" : "bob/Flowers";
    const match = !url.searchParams.get("q") || name.toLowerCase().includes(url.searchParams.get("q").toLowerCase());
    return route.fulfill({ json: { success: true, total: match ? 1 : 0, items: match ? [{ id: isMine ? 1 : 2, name: isMine ? "Fruit" : "Flowers", display_name: name, owner_username: isMine ? "alice" : "bob", owner_id: isMine ? 1 : 2, is_owner: isMine, visibility: isMine ? state.visibility : "public", status: "ready", split_type: "auto_split", class_count: 2, image_count: 50 }] : [] } });
  });
  await page.goto("/datasets");
  await expect(page.getByRole("heading", { name: "alice/Fruit", exact: true })).toBeVisible();
  return state;
}

test("dataset scopes hide each other and search the selected scope", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Public (Community)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "bob/Flowers", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "alice/Fruit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search datasets" }).fill("missing");
  await expect(page.getByText("No datasets found in this section.")).toBeVisible();
});

test("dataset URL import has immutable owner prefix and explicit source", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Import URL", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Owner prefix")).toHaveText("alice/");
  await modal.getByLabel("Dataset name").fill("New dataset");
  await modal.getByLabel("Other URL", { exact: true }).check();
  await modal.getByLabel("Dataset URL", { exact: true }).fill("https://example.com/data.zip");
  await modal.getByRole("button", { name: "Import Dataset", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(state.imports[0]).toMatchObject({ name: "New dataset", owner_id: 1, provider: "other", source_url: "https://example.com/data.zip" });
});

test("dataset visibility defaults private, confirms public and supports ZIP download", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  expect((await pending).suggestedFilename()).toBe("dataset-1.zip");
  expect(state.downloads).toBe(1);
});

test("stored class details are loaded on demand and searched without refetch", async ({ page }) => {
  const state = await setup(page);
  expect(state.detailCalls).toBe(0);
  await page.getByRole("button", { name: "ดูรายละเอียด alice/Fruit", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText("50 ภาพในคลาส", { exact: true })).toBeVisible();
  await modal.getByLabel("ค้นหาชื่อคลาส").fill("APP");
  await expect(modal.getByRole("rowheader", { name: "apple", exact: true })).toBeVisible();
  await expect(modal.getByRole("rowheader", { name: "banana", exact: true })).toHaveCount(0);
  expect(state.detailCalls).toBe(1);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("guide and library remain usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator("#dataset-guide summary").click();
  await expect(page.getByText("ชื่อโฟลเดอร์คือชื่อคลาส", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
