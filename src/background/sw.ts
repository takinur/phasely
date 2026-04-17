chrome.runtime.onInstalled.addListener(() => {
  // Background service worker entry point.
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    sendResponse({ ok: true, message });
    return true;
  },
);

// CLAUDE_INTEGRATION: dormant — activate in next feature release
// const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })