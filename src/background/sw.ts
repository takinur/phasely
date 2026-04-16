chrome.runtime.onInstalled.addListener(() => {
  // Background service worker entry point.
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  sendResponse({ ok: true, message });
  return true;
});