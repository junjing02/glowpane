// Runs in the YouTube page's own JavaScript world (manifest "world":
// "MAIN"), unlike content.js, which runs isolated and can't reach YouTube's
// player API. content.js asks for a playback speed by dispatching a DOM
// event (the detail is a plain string, which crosses worlds safely); this
// applies it through the player itself, so YouTube's own speed menu shows
// it too, rather than only changing the <video> element underneath.
document.addEventListener("ytsplit:set-playback-rate", (e) => {
  const rate = Number(e.detail);
  const player = document.getElementById("movie_player");
  if (!Number.isFinite(rate) || rate <= 0 || !player || typeof player.setPlaybackRate !== "function") return;
  player.setPlaybackRate(rate);
});

// Auto picture-in-picture (Chrome 134+): Chrome calls the media session's
// "enterpictureinpicture" action when the user switches to another tab
// while a video plays with sound. That is the only time a page may open
// picture-in-picture without a click. content.js turns it on or off with
// the data-ytsplit-auto-pip attribute on <html> (the DOM is shared between
// worlds) and a "ytsplit:auto-pip" event when it changes.
(() => {
  let registered = false;
  let autoOpened = null; // the <video> this code put in picture-in-picture

  // TEMPORARY log while the "video missing after coming back" report is
  // diagnosed. Remove before release.
  const log = (...args) => console.info("[Glowpane PiP]", ...args);
  const describe = (video) =>
    video
      ? `${video.className || "video"} ${video.videoWidth}x${video.videoHeight} paused=${video.paused} connected=${video.isConnected}`
      : "none";
  for (const type of ["enterpictureinpicture", "leavepictureinpicture"]) {
    document.addEventListener(type, (e) => log(type, describe(e.target)), true);
  }

  // The playing video with the biggest box: the watch page's player, or the
  // Short in view (the reel keeps several <video> elements).
  function playingVideo() {
    let best = null;
    let bestArea = 0;
    for (const video of document.querySelectorAll("video")) {
      if (video.paused || video.ended || video.readyState < 2 || !video.videoWidth) continue;
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return best;
  }

  async function enter() {
    const video = playingVideo();
    log("Chrome asked to open. videos:", document.querySelectorAll("video").length, "picked:", describe(video), "already open:", describe(document.pictureInPictureElement));
    if (!video || document.pictureInPictureElement) return;
    try {
      await video.requestPictureInPicture();
      autoOpened = video;
      log("opened");
    } catch (err) {
      console.debug("[Glowpane] auto picture-in-picture refused:", err && err.message);
    }
  }

  function sync() {
    const wanted = document.documentElement.dataset.ytsplitAutoPip === "on";
    if (wanted === registered || !navigator.mediaSession) return;
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", wanted ? enter : null);
      registered = wanted;
    } catch (err) {
      // Older Chrome or another browser: the action doesn't exist. Do nothing.
    }
  }

  // Back on the tab: Chrome closes an automatic picture-in-picture window
  // itself. Closing it from here at the same moment left the video stuck
  // (reported: exitPictureInPicture() never settled, no leave event, the
  // page kept showing "Playing in picture-in-picture"). So only close it if
  // Chrome hasn't after a second, and only if this code opened it.
  let closeTimer = 0;
  document.addEventListener("visibilitychange", () => {
    log("tab", document.visibilityState, "open now:", describe(document.pictureInPictureElement), "ours:", describe(autoOpened));
    clearTimeout(closeTimer);
    if (document.visibilityState !== "visible" || !autoOpened) return;
    const video = autoOpened;
    closeTimer = setTimeout(() => {
      log("1s later, open now:", describe(document.pictureInPictureElement));
      if (document.visibilityState !== "visible" || autoOpened !== video) return;
      autoOpened = null;
      if (document.pictureInPictureElement !== video) return;
      document.exitPictureInPicture().then(
        () => log("closed it"),
        (err) => log("close failed:", err && err.message)
      );
    }, 1000);
  });

  // Forget the window once it closes, however it closed.
  document.addEventListener(
    "leavepictureinpicture",
    (e) => {
      if (e.target === autoOpened) autoOpened = null;
    },
    true
  );

  document.addEventListener("ytsplit:auto-pip", sync);
  sync();
})();
