import axios from "axios";

export const API_URL = "http://127.0.0.1:8000";
export function getUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }
const apiOrigins = new Set([API_URL, "http://localhost:8000"]);

// Legacy Builder uses axios; other pages use fetch. Never send credentials to download-source URLs.
export function configureApiAuth() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (!apiOrigins.has(url.origin)) return originalFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const token = localStorage.getItem("access_token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await originalFetch(input, { ...init, headers });
    if (response.status === 401 && url.pathname !== "/login") expireSession();
    return response;
  };
  axios.interceptors.request.use(config => {
    if (apiOrigins.has(new URL(config.url, API_URL).origin)) {
      const token = localStorage.getItem("access_token");
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  axios.interceptors.response.use(response => response, error => {
    if (error.response?.status === 401) expireSession();
    return Promise.reject(error);
  });
}

function expireSession() {
  localStorage.removeItem("user"); localStorage.removeItem("access_token");
  if (location.pathname !== "/login") location.assign("/login");
}

export async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers };
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const message = result.detail || result.message;
    throw new Error(typeof message === "string" ? message : `Request failed (${response.status}). Check backend logs.`);
  }
  return result;
}

export async function download(path, filename) {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.detail || "Download failed.");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const name = disposition.match(/filename="([^"]+)"/)?.[1] || filename;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
