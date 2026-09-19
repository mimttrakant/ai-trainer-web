import { test, expect } from "@playwright/test";

const fruit = { id: 7, name: "Fruit", description: "Fruit classification", status: "ready", source_type: "upload",
  class_count: 2, image_count: 3, split_type: "auto_split", created_at: "2026-09-19T00:00:00Z" };
const counts = [{ name: "apple", image_count: 2, splits: {} }, { name: "banana", image_count: 1, splits: {} }];

async function setup(page, dataset = fruit, classes = counts) {
  const state = { datasets: [{ ...dataset }], classes, detailCalls: 0, fail: false, unassigned: 0, delay: 0 };
  await page.addInitScript(() => localStorage.setItem("user", JSON.stringify({ id: 2, username: "Dataset test" })));
  await page.route("http://127.0.0.1:8000/**", async route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe("GET");
    if (url.pathname.endsWith("/details")) {
      state.detailCalls += 1;
      expect(url.searchParams.get("owner_id")).toBe("2");
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      await route.fulfill(state.fail ? { status: 503, json: { detail: "Unable to read dataset files. Please try again." } } : {
        json: { success: true, dataset_id: 7, classes: state.classes, detected_class_count: state.classes.length,
          classified_image_count: state.classes.reduce((total, row) => total + row.image_count, 0), unassigned_image_count: state.unassigned },
      });
    } else {
      expect(url.pathname).toBe("/datasets/2");
      await route.fulfill({ json: { success: true, datasets: state.datasets } });
    }
  });
  await page.goto("/datasets");
  await expect(page.getByRole("button", { name: "ดูรายละเอียด Fruit", exact: true })).toBeVisible();
  return state;
}

const openDetails = page => page.getByRole("button", { name: "ดูรายละเอียด Fruit", exact: true }).click();
const dialog = page => page.getByRole("dialog", { name: "รายละเอียด Dataset: Fruit", exact: true });

test("guide explains class folders, both layouts, upload and URL requirements without fetching details", async ({ page }) => {
  const state = await setup(page);
  await page.locator("#dataset-guide summary").click();
  const guide = page.locator("#dataset-guide");
  await expect(guide.getByText("ชื่อโฟลเดอร์คือชื่อคลาส", { exact: true })).toBeVisible();
  await expect(guide.getByLabel("ตัวอย่างโครงสร้างแยกโฟลเดอร์คลาส")).toContainText("apple_01.jpg");
  await expect(guide.getByLabel("ตัวอย่างโครงสร้างแบ่งชุดข้อมูล")).toContainText("train/");
  await expect(guide.getByText(/อย่างน้อย 2 โฟลเดอร์คลาส/)).toBeVisible();
  await expect(guide.getByText(/Anyone with the link/)).toBeVisible();
  await expect(guide.getByText(/ไม่ใช่การรับรองว่าไฟล์ภาพทุกไฟล์/)).toBeVisible();
  await page.getByRole("button", { name: "+ Upload ZIP", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/ใช้ ZIP ที่ไม่ตั้งรหัสผ่าน/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Import URL", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/ไม่รองรับลิงก์โฟลเดอร์/)).toBeVisible();
  expect(state.detailCalls).toBe(0);
});

test("cards summarize counts and details support search, Escape and focus restoration", async ({ page }) => {
  const state = await setup(page);
  const card = page.getByRole("article");
  await expect(card.getByText("Classes / คลาส").locator("..")).toHaveText("Classes / คลาส2");
  await expect(card.getByText("Images / ภาพ").locator("..")).toHaveText("Images / ภาพ3");
  await openDetails(page);
  await expect(dialog(page).getByText("2 คลาสที่ตรวจพบ", { exact: true })).toBeVisible();
  await expect(dialog(page).getByText("3 ภาพในคลาส", { exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("row", { name: "apple 2", exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("columnheader", { name: "Train", exact: true })).toHaveCount(0);
  await dialog(page).getByLabel("ค้นหาชื่อคลาส").fill("APP");
  await expect(dialog(page).getByRole("rowheader", { name: "apple", exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("rowheader", { name: "banana", exact: true })).toHaveCount(0);
  await dialog(page).getByLabel("ค้นหาชื่อคลาส").fill("no-match");
  await expect(dialog(page).getByText("ไม่พบชื่อคลาสที่ค้นหา", { exact: true })).toBeVisible();
  expect(state.detailCalls).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ดูรายละเอียด Fruit", exact: true })).toBeFocused();
});

test("many classes are paginated and search covers every page", async ({ page }) => {
  const classes = Array.from({ length: 25 }, (_, index) => ({ name: `class-${String(index + 1).padStart(2, "0")}`, image_count: index + 1, splits: {} }));
  await setup(page, { ...fruit, class_count: 25 }, classes);
  await openDetails(page);
  await expect(dialog(page).getByRole("rowheader")).toHaveCount(10);
  await expect(dialog(page).getByText("หน้า 1 / 3 · 25 คลาส")).toBeVisible();
  await dialog(page).getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(dialog(page).getByRole("rowheader", { name: "class-11", exact: true })).toBeVisible();
  await dialog(page).getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(dialog(page).getByRole("rowheader")).toHaveCount(5);
  await expect(dialog(page).getByRole("button", { name: "ถัดไป", exact: true })).toBeDisabled();
  await dialog(page).getByLabel("ค้นหาชื่อคลาส").fill("class-02");
  await expect(dialog(page).getByRole("row", { name: "class-02 2", exact: true })).toBeVisible();
  await expect(dialog(page).getByText("หน้า 1 / 1 · 1 คลาส")).toBeVisible();
});

test("pre-split datasets show per-class train validation test and unmatched image counts", async ({ page }) => {
  const state = await setup(page, { ...fruit, split_type: "pre_split", image_count: 8 }, [
    { name: "apple", image_count: 4, splits: { train: 2, val: 1, test: 1 } },
    { name: "banana", image_count: 3, splits: { train: 2, val: 1 } },
  ]);
  state.unassigned = 1;
  await openDetails(page);
  await expect(dialog(page).getByRole("row", { name: "apple 4 2 1 1", exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("row", { name: "banana 3 2 1 0", exact: true })).toBeVisible();
  await expect(dialog(page).getByText(/อีก 1 ภาพไม่ได้อยู่ในโครงสร้างคลาส/)).toBeVisible();
});

test("detail errors are retryable without presenting fabricated zero counts", async ({ page }) => {
  const state = await setup(page);
  state.fail = true;
  await openDetails(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Unable to read dataset files");
  await expect(dialog(page).getByText(/คลาสที่ตรวจพบ/)).toHaveCount(0);
  state.fail = false;
  await dialog(page).getByRole("button", { name: "ลองโหลดใหม่", exact: true }).click();
  await expect(dialog(page).getByText("2 คลาสที่ตรวจพบ", { exact: true })).toBeVisible();
  expect(state.detailCalls).toBe(2);
});

test("processing datasets wait for polling to finish before requesting counts", async ({ page }) => {
  const state = await setup(page, { ...fruit, status: "processing", class_count: 0, image_count: 0 });
  await openDetails(page);
  await expect(dialog(page).getByRole("status")).toContainText("กำลังนำเข้าและสแกน Dataset");
  expect(state.detailCalls).toBe(0);
  state.datasets = [{ ...fruit }];
  await expect(dialog(page).getByText("2 คลาสที่ตรวจพบ", { exact: true })).toBeVisible();
  expect(state.detailCalls).toBe(1);
});

test("failed and unsupported datasets explain problems without guessing class folders", async ({ page }) => {
  const state = await setup(page, { ...fruit, status: "failed", error_message: "Invalid ZIP" });
  await openDetails(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Invalid ZIP");
  expect(state.detailCalls).toBe(0);
  await page.keyboard.press("Escape");
  state.datasets = [{ ...fruit, status: "unsupported", unsupported_reason: "At least 2 class folders are required.", class_count: 0 }];
  state.classes = [];
  state.unassigned = 3;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("article").getByText(/Unsupported$/)).toBeVisible();
  await openDetails(page);
  await expect(dialog(page).getByText("ไม่พบคลาสในโครงสร้างที่ระบบตรวจจับได้", { exact: true })).toBeVisible();
  await expect(dialog(page).getByText("At least 2 class folders are required.", { exact: true })).toBeVisible();
});

test("details stay within mobile bounds and cancel safely while loading", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, { ...fruit, split_type: "pre_split" });
  await page.locator("#dataset-guide summary").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.delay = 500;
  await openDetails(page);
  await expect(dialog(page).getByRole("status")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  state.delay = 0;
  await openDetails(page);
  await expect(dialog(page).getByRole("table")).toBeVisible();
  const bounds = await dialog(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.height).toBeLessThanOrEqual(844);
  await dialog(page).getByRole("button", { name: "ปิดรายละเอียด Dataset", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
});
