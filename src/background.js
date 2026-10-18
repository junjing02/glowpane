// Two-window mode: pairs one YouTube watch tab (the "main" tab, video only)
// with one pop-up window (the "companion": a second YouTube page for the
// same video, showing only the description, recommendations and comments).
// A browser window can't display part of another window's page, so the
// companion is a real YouTube page; this worker keeps the two in sync by
// relaying messages between their content scripts:
//   - main tab claims the pairing on each watch page   -> companion follows
//   - link clicked in the companion                    -> main tab navigates
//   - timestamp clicked in the companion               -> main video seeks
//   - companion window closed                          -> mode turns off
//   - main tab closed / mode turned off                -> companion closes
//   - main tab leaves the video (home, channel, other  -> companion closes,
//     site)                                               mode stays on, so
//                                                         the next video
//                                                         reopens it
// The pairing lives in chrome.storage.session, since an MV3 service worker
// can be stopped between events and lose its globals.

const MODE_KEY = "twoWindowMode";
const BOUNDS_KEY = "companionBounds";
const COMPANION_WIDTH = 480;

// Handlers run one at a time, so two quick claims (e.g. a navigation right
// after a page load) can't both decide there's no companion and open two.
let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function getPair() {
  const { pair } = await chrome.storage.session.get("pair");
  return pair || null;
}

async function setPair(pair) {
  if (pair) await chrome.storage.session.set({ pair });
  else await chrome.storage.session.remove("pair");
}

async function getMode() {
  const stored = await chrome.storage.local.get(MODE_KEY);
  return !!stored[MODE_KEY];
}

function videoId(url) {
  try {
    return new URL(url).searchParams.get("v");
  } catch (e) {
    return null;
  }
}

// ytsplit=companion lets the companion's content script take its role
// immediately on load, before the "hello" round trip confirms it.
function companionUrl(url) {
  const u = new URL(url);
  u.searchParams.set("ytsplit", "companion");
  u.searchParams.delete("t");
  return u.href;
}

// A YouTube video page. Reading another tab's URL needs host permission,
// so for any site other than youtube.com tab.url is undefined, which also
// (correctly) counts as "not a video".
function isWatchUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === "/watch";
  } catch (e) {
    return false;
  }
}

// Messages only ever come from this extension's own content scripts (no
// externally_connectable), but URLs are still checked before a tab is
// pointed at them: defense in depth, so nothing but YouTube can ever be
// opened through this worker.
function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.youtube.com";
  } catch (e) {
    return false;
  }
}

function notify(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

// Last position/size the user gave the pop-up, else beside the main window
// (or against the right edge of the screen if there's no room beside it).
async function companionBounds(tab, screen) {
  const saved = (await chrome.storage.local.get(BOUNDS_KEY))[BOUNDS_KEY];
  if (saved) return saved;
  const win = await chrome.windows.get(tab.windowId);
  let left = win.left + win.width;
  if (screen && left + COMPANION_WIDTH > screen.left + screen.width) {
    left = Math.max(screen.left, screen.left + screen.width - COMPANION_WIDTH);
  }
  return { left, top: win.top, width: COMPANION_WIDTH, height: win.height };
}

async function claimMain(tab, url, screen) {
  if (!(await getMode())) return { role: "none" };
  let pair = await getPair();
  if (pair) {
    try {
      await chrome.tabs.get(pair.companionTabId);
    } catch (e) {
      pair = null; // companion is gone
    }
  }

  if (!pair) {
    const bounds = await companionBounds(tab, screen);
    const win = await chrome.windows.create({
      url: companionUrl(url),
      type: "popup",
      focused: false,
      ...bounds,
    });
    await setPair({
      mainTabId: tab.id,
      companionTabId: win.tabs[0].id,
      companionWindowId: win.id,
      video: videoId(url),
    });
    return { role: "main" };
  }

  // Another tab took over (the user switched to a different video tab).
  if (pair.mainTabId !== tab.id) {
    notify(pair.mainTabId, { type: "role", role: "none" });
    pair.mainTabId = tab.id;
  }
  const v = videoId(url);
  if (v && v !== pair.video) {
    pair.video = v;
    await chrome.tabs.update(pair.companionTabId, { url: companionUrl(url) });
  }
  await setPair(pair);
  return { role: "main" };
}

async function handle(msg, sender) {
  const tab = sender.tab;
  if (!msg || !tab) return null;
  const pair = await getPair();
  const fromCompanion = !!pair && tab.id === pair.companionTabId;

  switch (msg.type) {
    case "hello":
      return {
        mode: await getMode(),
        role: fromCompanion ? "companion" : pair && tab.id === pair.mainTabId ? "main" : "none",
      };
    case "claimMain":
      if (!isWatchUrl(msg.url) || !isYouTubeUrl(msg.url)) return { role: "none" };
      return claimMain(tab, msg.url, msg.screen);
    case "navigateMain":
      if (!fromCompanion || !isYouTubeUrl(msg.url)) return null;
      // This is a full page load in the main tab, which would reset the
      // player to 1x; let the main tab save its speed first so it can put
      // it back on the new video (content.js "Playback speed handoff").
      if (isWatchUrl(msg.url)) {
        await chrome.tabs.sendMessage(pair.mainTabId, { type: "savePlaybackRate" }).catch(() => {});
      }
      await chrome.tabs.update(pair.mainTabId, { url: msg.url });
      return null;
    case "seek":
      if (fromCompanion && Number.isFinite(msg.seconds) && msg.seconds >= 0) {
        notify(pair.mainTabId, { type: "seek", seconds: msg.seconds });
      }
      return null;
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  serialized(() => handle(msg, sender)).then(sendResponse, () => sendResponse(null));
  return true; // respond asynchronously
});

// Closing the pop-up is how you leave two-window mode: turn the mode off
// (so it doesn't immediately reopen) and give the main tab its split back.
chrome.windows.onRemoved.addListener((windowId) =>
  serialized(async () => {
    const pair = await getPair();
    if (!pair || windowId !== pair.companionWindowId) return;
    await setPair(null);
    await chrome.storage.local.set({ [MODE_KEY]: false });
    notify(pair.mainTabId, { type: "role", role: "none" });
  })
);

// Main tab closed: close its pop-up too (pairing cleared first, so the
// window closing doesn't also switch the mode off).
chrome.tabs.onRemoved.addListener((tabId) =>
  serialized(async () => {
    const pair = await getPair();
    if (!pair || tabId !== pair.mainTabId) return;
    await setPair(null);
    chrome.windows.remove(pair.companionWindowId).catch(() => {});
  })
);

// Main tab left the video (YouTube's own in-page navigation counts too):
// close the pop-up but keep the mode on; the next video page the user opens
// claims the pairing again and a fresh pop-up opens. Pairing cleared first
// so the window closing doesn't switch the mode off.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  serialized(async () => {
    const pair = await getPair();
    if (!pair || tabId !== pair.mainTabId || isWatchUrl(tab.url || "")) return;
    await setPair(null);
    notify(tabId, { type: "role", role: "none" });
    chrome.windows.remove(pair.companionWindowId).catch(() => {});
  });
});

// Mode switched off from the toolbar: close the pop-up, restore the split.
// (Switching it on needs no work here: the visible watch tab's content
// script sees the change and claims the pairing itself.)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[MODE_KEY] || changes[MODE_KEY].newValue) return;
  serialized(async () => {
    const pair = await getPair();
    if (!pair) return;
    await setPair(null);
    notify(pair.mainTabId, { type: "role", role: "none" });
    chrome.windows.remove(pair.companionWindowId).catch(() => {});
  });
});

// Remember where the user puts the pop-up.
chrome.windows.onBoundsChanged.addListener((win) =>
  serialized(async () => {
    const pair = await getPair();
    if (!pair || win.id !== pair.companionWindowId) return;
    await chrome.storage.local.set({
      [BOUNDS_KEY]: { left: win.left, top: win.top, width: win.width, height: win.height },
    });
  })
);

// Removing Glowpane opens a short goodbye page on its website: why it was
// removed (feedback), quick fixes, and a way back. Nothing is sent with it.
chrome.runtime.setUninstallURL("https://junjing02.github.io/glowpane/bye.html");

// A new install: YouTube tabs that are already open don't get the content
// scripts until their next page load, so Glowpane looked broken until the
// user reloaded (most people install from the store with YouTube open).
// Add them now. Fresh installs only: after an update the old copy is still
// running in those tabs, and a second copy would fight it over the page.
// early.js is left out; it only matters in a second window, and there is
// none yet.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
  for (const tab of tabs) {
    if (tab.discarded) continue;
    const target = { tabId: tab.id };
    try {
      await chrome.scripting.insertCSS({ target, files: ["src/content.css"] });
      await chrome.scripting.executeScript({ target, files: ["src/content.js"] });
      await chrome.scripting.executeScript({ target, files: ["src/page.js"], world: "MAIN" });
    } catch (e) {
      // Tab closed or still loading: it gets the scripts on its next load.
    }
  }
});

// Keyboard shortcuts (manifest "commands"; users can rebind them at
// chrome://extensions/shortcuts). Two of them only flip the stored settings; the
// tabs and the handlers above react to the storage change, exactly as if
// the toolbar panel's switches had been used.
// Runs in the tab (content.js's world), so it must be self-contained.
// content.js normally provides glowpaneTogglePip(); the fallback covers a
// tab whose content script isn't there.
function togglePipInTab() {
  if (typeof globalThis.glowpaneTogglePip === "function") {
    globalThis.glowpaneTogglePip();
    return;
  }
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
    return;
  }
  let best = null;
  let bestArea = 0;
  for (const video of document.querySelectorAll("video")) {
    const rect = video.getBoundingClientRect();
    const visible =
      Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    if (video.readyState >= 1 && visible > bestArea) {
      best = video;
      bestArea = visible;
    }
  }
  if (best) best.requestPictureInPicture().catch(() => {});
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  // Picture-in-picture needs a user gesture in the page. A command counts as
  // one, so the script is injected right away, before any await.
  if (command === "toggle-pip") {
    if (tab && tab.id != null && isYouTubeUrl(tab.url)) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: togglePipInTab }).catch(() => {});
    }
    return;
  }
  // Video only is a per-tab view, not a stored setting: ask the tab in
  // front to hide or show its side pane.
  if (command === "toggle-video-only") {
    if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: "toggleVideoOnly" }).catch(() => {});
    return;
  }
  const stored = await chrome.storage.local.get({ splitEnabled: true, [MODE_KEY]: false });
  if (command === "toggle-split") {
    const splitEnabled = !stored.splitEnabled;
    // Two windows is part of the split; it can't stay on without it.
    await chrome.storage.local.set(splitEnabled ? { splitEnabled } : { splitEnabled, [MODE_KEY]: false });
  } else if (command === "toggle-two-windows") {
    const on = !stored[MODE_KEY];
    await chrome.storage.local.set(on ? { [MODE_KEY]: true, splitEnabled: true } : { [MODE_KEY]: false });
  }
});

