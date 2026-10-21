// Toolbar panel: every control maps to one key in chrome.storage.local.
// The YouTube tabs and the background worker react to the storage change
// themselves, so this file only reads and writes settings.
const DEFAULTS = {
  splitEnabled: true,
  twoWindowMode: false,
  ambientEnabled: true,
  ambientStrength: 70,
  ambientStrengthLight: 70,
  showDescription: true,
  showRecommendations: true,
  showComments: true,
  sideWidth: "auto",
  paneTransparency: 40,
  rememberLayout: false,
  videoOnRight: false,
};

const controls = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, document.getElementById(key)]));
const options = document.getElementById("options");
const glowSliders = ["ambientStrength", "ambientStrengthLight"];
const sliders = [...glowSliders, "paneTransparency"];

// Switches hold booleans, sliders numbers, the dropdown its option's value.
function read(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "range") return Number(el.value);
  return el.value;
}

function write(el, value) {
  if (el.type === "checkbox") el.checked = !!value;
  else el.value = value;
}

// With the master switch off nothing else applies; with ambient light off
// the strength sliders don't either.
function reflect() {
  for (const key of sliders) {
    document.getElementById(key + "Value").textContent = controls[key].value + "%";
  }
  const on = controls.splitEnabled.checked;
  options.classList.toggle("is-disabled", !on);
  for (const [key, el] of Object.entries(controls)) {
    if (key !== "splitEnabled") el.disabled = !on;
  }
  for (const key of glowSliders) controls[key].disabled = !on || !controls.ambientEnabled.checked;
}

chrome.storage.local.get(DEFAULTS).then((stored) => {
  for (const [key, el] of Object.entries(controls)) write(el, stored[key]);
  reflect();
});

for (const [key, el] of Object.entries(controls)) {
  el.addEventListener(el.type === "range" ? "input" : "change", () => {
    const update = { [key]: read(el) };
    // Two windows is part of the split, so it can't stay on without it.
    if (key === "splitEnabled" && !el.checked) {
      update.twoWindowMode = false;
      controls.twoWindowMode.checked = false;
    }
    chrome.storage.local.set(update);
    reflect();
  });
}

// Keep the controls honest if something else changes a setting while the
// panel is open (a keyboard shortcut, or closing the second window).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, el] of Object.entries(controls)) {
    if (!changes[key]) continue;
    write(el, changes[key].newValue === undefined ? DEFAULTS[key] : changes[key].newValue);
  }
  reflect();
});

document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

// chrome:// pages can't be opened from a plain link.
document.getElementById("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// Reset: everything back to its default, except the two switches that
// turn whole modes on or off (resetting those would close a second window
// or switch the extension back on behind the user's back).
document.getElementById("reset").addEventListener("click", (e) => {
  e.preventDefault();
  const { splitEnabled, twoWindowMode, ...rest } = DEFAULTS;
  for (const [key, value] of Object.entries(rest)) write(controls[key], value);
  chrome.storage.local.set(rest);
  reflect();
});

// Copy diagnostics (no visible control, to keep the panel simple): click
// the version number and the YouTube tab in front describes its layout as
// text, which goes on the clipboard to paste into a bug report.
const version = document.getElementById("version");
version.addEventListener("click", async () => {
  const label = version.textContent;
  const say = (text) => {
    version.textContent = text;
    setTimeout(() => (version.textContent = label), 2000);
  };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const report = await chrome.tabs.sendMessage(tab.id, { type: "diagnose" });
    if (!report) throw new Error("no report");
    await navigator.clipboard.writeText(report);
    say("Diagnostics copied");
  } catch (err) {
    say("Open a YouTube video first");
  }
});
