import { test, expect } from "@playwright/test";

async function setup(page, username = "alice") {
  await page.addInitScript(name => {
    if (!sessionStorage.getItem("navigation-fixture")) {
      localStorage.setItem("user", JSON.stringify({ id: 1, username: name }));
      localStorage.setItem("access_token", "test-token");
      sessionStorage.setItem("navigation-fixture", "ready");
    }
  }, username);
  const state = { logouts: 0 };
  await page.route("http://127.0.0.1:8000/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/logout") state.logouts += 1;
    return route.fulfill({ json: { success: true, items: [], total: 0, versions: [], latest_version: 0,
      active_editors: 1, project: { id: 1, owner_id: 1, name: "Fruit classifier", model_name: "Fruit classifier",
        description: "A simple image classification model", version: 0, architecture_json: "{}" } } });
  });
  return state;
}

test("navigation marks only the current section and Back to Models works", async ({ page }, testInfo) => {
  await setup(page); await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/models/1/builder");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Models", exact: true })).toHaveAttribute("aria-current", "page");
  const back = page.getByRole("link", { name: "Back to Models", exact: true });
  await expect(back).toBeVisible(); await expect(back).toHaveCSS("text-decoration-line", "none");
  await expect(page.getByRole("heading", { name: "alice/Fruit classifier", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("builder-navigation-desktop.png") });
  await back.click(); await expect(page).toHaveURL(/\/models$/);
  for (const [label, path] of [["Home", "/"], ["Datasets", "/datasets"], ["Training", "/training"]]) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.goto("/projects/1/builder");
  await expect(nav.getByRole("link", { name: "Models", exact: true })).toHaveAttribute("aria-current", "page");
});

test("mobile navbar fits narrow screens and long usernames", async ({ page }, testInfo) => {
  await setup(page, "a_very_long_username_that_should_not_push_buttons_offscreen");
  await page.setViewportSize({ width: 320, height: 720 }); await page.goto("/models");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const label of ["Home", "Models", "Datasets", "Training"]) {
    const link = nav.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible(); const box = await link.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await expect(nav.getByRole("button", { name: "Logout" })).toBeVisible();
  expect(await nav.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await nav.screenshot({ path: testInfo.outputPath("navbar-mobile.png") });
});

test("keyboard focus remains visible and logout still clears the session", async ({ page }) => {
  const state = await setup(page); await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await page.keyboard.press("Tab");
  const brand = nav.getByRole("link", { name: "AI Trainer", exact: true });
  await expect(brand).toBeFocused(); await expect(brand).toHaveCSS("outline-style", "solid");
  await nav.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Login", exact: true })).toBeVisible();
  expect(state.logouts).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("access_token"))).toBeNull();
});
