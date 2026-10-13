// Second window (two-window mode) only. Runs at document_start, long
// before content.js (document_idle), because YouTube starts playing the
// video as soon as its player is ready: for a moment the pop-up showed the
// video and played a blip of sound before content.js could hide and pause
// it (reported). The pop-up's URL carries ytsplit=companion, so its role
// is known immediately. early.css hides the player while the class below
// is set; content.js removes the class if this turns out not to be the
// second window after all.
(function () {
  if (window.top !== window) return;
  if (new URLSearchParams(location.search).get("ytsplit") !== "companion") return;
  const EARLY_CLASS = "yt-split-early-companion";
  const root = document.documentElement;
  root.classList.add(EARLY_CLASS);
  // Media events don't bubble, but they can be caught on the way down.
  // "play" fires when playback is requested, before any sound comes out.
  const stop = (e) => {
    const video = e.target;
    if (!(video instanceof HTMLVideoElement)) return;
    if (!root.classList.contains(EARLY_CLASS)) return;
    if (!video.paused) video.pause();
  };
  for (const type of ["play", "playing", "canplay", "timeupdate"]) {
    document.addEventListener(type, stop, true);
  }
})();
