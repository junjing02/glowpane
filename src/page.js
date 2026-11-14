// Runs in the YouTube page's own JavaScript world (manifest "world":
// "MAIN"), unlike content.js, which runs isolated and can't reach YouTube's
// player API. content.js asks for a playback speed by dispatching a DOM
// event (the detail is a plain string, which crosses worlds safely); this
// applies it through the player itself, so YouTube's own speed menu shows
// it too, rather than only changing the <video> element underneath.
document.addEventListener("ytsplit:set-playback-rate", (e) => {
  const rate = Number(e.detail);
  // Shorts have their own player element.
  const player = document.getElementById(location.pathname.startsWith("/shorts/") ? "shorts-player" : "movie_player");
  if (!Number.isFinite(rate) || rate <= 0 || !player || typeof player.setPlaybackRate !== "function") return;
  player.setPlaybackRate(rate);
});

// A live stream more than the given number of seconds behind the live
// point moves to it (content.js "Live streams continue at the live point
// after a reload"). Player methods from memory; the <video> element's
// seekable range as a fallback.
document.addEventListener("ytsplit:catch-up-live", (e) => {
  const behind = Number(e.detail) || 20;
  const player = document.getElementById("movie_player");
  if (!player) return;
  const video = player.querySelector("video");
  const state = typeof player.getProgressState === "function" ? player.getProgressState() : null;
  let end = state && Number.isFinite(state.seekableEnd) ? state.seekableEnd : null;
  let current = state && Number.isFinite(state.current) ? state.current : null;
  if ((end === null || current === null) && video && video.seekable.length) {
    end = video.seekable.end(video.seekable.length - 1);
    current = video.currentTime;
  }
  if (end === null || current === null || end - current <= behind) return;
  if (typeof player.seekToLiveHead === "function") player.seekToLiveHead();
  else if (typeof player.seekTo === "function") player.seekTo(end, true);
  else if (video) video.currentTime = end;
});
