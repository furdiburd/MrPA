"use strict";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "rpu-fetch" || typeof message.url !== "string") return;

  (async () => {
    try {
      const response = await fetch(message.url, { credentials: "omit" });
      const text = await response.text();
      sendResponse({ ok: response.ok, status: response.status, text });
    } catch (err) {
      sendResponse({ ok: false, status: 0, error: String(err?.message || err || "unknown error") });
    }
  })();

  return true;
});
