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
