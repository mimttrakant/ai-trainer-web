import { expect } from "@playwright/test";

export const metric = epoch => ({ epoch, train_loss: 2 / epoch, val_loss: 2.5 / epoch, train_accuracy: 50 + epoch, val_accuracy: 45 + epoch });
export const job = (id, status = "completed") => ({ id, owner_id: 1, project_id: 1, project_version: 2, model_name: "alice/Classifier", dataset_name: "alice/Fruit", dataset_id: 1, status, current_epoch: 2, total_epochs: 5, batch_size: 8, learning_rate: 0.002, optimizer: "adam" });

export async function setupTraining(page, state = {}) {
  Object.assign(state, { jobs: state.jobs || [job(4)], metrics: state.metrics || { 4: [metric(1), metric(2)] }, weights: state.weights || [], submits: [], downloads: [], deletes: 0, detailCalls: 0 });
  await page.addInitScript(() => { localStorage.setItem("user", JSON.stringify({ id: 1, username: "alice" })); localStorage.setItem("access_token", "test-token"); });
  await page.route("http://127.0.0.1:8000/**", async route => {
    const url = new URL(route.request().url()); const path = url.pathname; const method = route.request().method();
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    const ok = payload => route.fulfill({ json: { success: true, ...payload } });
    if (path.includes("/download/")) {
      state.downloads.push(path); if (state.downloadDelay) await new Promise(resolve => setTimeout(resolve, state.downloadDelay));
      if (state.failDownload) return route.fulfill({ status: 404, json: { detail: "Weight file is missing." } });
      const pt = path.endsWith("/pt");
      return route.fulfill({ contentType: pt ? "application/octet-stream" : "application/zip", headers: { "Content-Disposition": `attachment; filename="${pt ? "model.pt" : "model-onnx.zip"}"`, "Access-Control-Expose-Headers": "Content-Disposition" }, body: pt ? "synthetic PT" : "synthetic ZIP" });
    }
    if (path.match(/\/weights\/\d+\/visibility$/)) {
      const id = Number(path.split("/")[3]); state.weights.find(w => w.id === id).visibility = route.request().postDataJSON().visibility; return ok({});
    }
    if (method === "DELETE") {
      state.deletes += 1;
      if (state.failDelete) return route.fulfill({ status: 503, json: { detail: "Unable to delete weight. Retry." } });
      state.weights = state.weights.filter(w => w.id !== Number(path.split("/").pop())); return ok({});
    }
    if (path === "/library/jobs" && method === "POST") {
      state.submits.push(route.request().postDataJSON());
      if (state.failSubmit) return route.fulfill({ status: 409, json: { detail: "Model is no longer public." } });
      const next = { ...job(99, "queued"), current_epoch: 0 }; state.jobs.unshift(next); state.metrics[99] = []; return ok({ job: next });
    }
    if (path.match(/\/jobs\/\d+$/)) {
      state.detailCalls += 1;
      const id = Number(path.split("/").pop());
      if (state.detailDelay?.[id]) await new Promise(resolve => setTimeout(resolve, state.detailDelay[id]));
      if (state.revoked) return route.fulfill({ status: 404, json: { detail: "Training result is private or unavailable." } });
      if (state.failDetails) return route.fulfill({ status: 503, json: { detail: "Temporary network failure." } });
      return ok({ job: state.jobs.find(j => j.id === id), metrics: state.metrics[id] || [], weights: state.weights.filter(w => w.training_job_id === id) });
    }
    if (path.endsWith("/versions")) {
      const versions = path.includes("/2/") ? [{ version: 9, model_name: "Community" }, { version: 5, model_name: "Older" }] : [{ version: 2, model_name: "Classifier" }, { version: 1, model_name: "Original" }];
      return ok({ versions });
    }
    const scope = url.searchParams.get("scope");
    let items = path === "/library/jobs" ? state.jobs : path === "/library/weights" ? state.weights.filter(w => scope === "public" ? w.visibility === "public" : w.is_owner)
      : path === "/library/models" ? (scope === "public" ? [{ id: 2, display_name: "bob/Community", version: 9 }] : [{ id: 1, display_name: "alice/Classifier", version: 2 }])
      : path === "/library/datasets" ? [{ id: 1, display_name: "alice/Fruit", class_count: 2, image_count: 20 }] : [];
    if (state.manyModels && path === "/library/models") items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, display_name: `alice/Model ${i + 1}`, version: 2 }));
    const q = url.searchParams.get("q")?.toLowerCase(); if (q) items = items.filter(row => JSON.stringify(row).toLowerCase().includes(q));
    const total = items.length; const start = (Number(url.searchParams.get("page") || 1) - 1) * 10;
    return ok({ items: items.slice(start, start + 10), total });
  });
  return state;
}

export async function chooseTraining(page) {
  await page.getByRole("button", { name: "Choose model", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /alice\/Classifier/ }).click();
  await expect(page.getByLabel("Model version", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Choose dataset", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /alice\/Fruit/ }).click();
}
