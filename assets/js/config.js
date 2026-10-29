// Online features (global leaderboards, players online, ghost racing, live matches) use a
// Firebase Realtime Database. Paste your database URL below to turn them on, e.g.
//   firebaseUrl: 'https://pixel-pioneers-default-rtdb.firebaseio.com'
// Leave it empty and the arcade runs fully offline. Setup steps are in README.md.
//
// Real-time matches (Rune Rumble) go through the Stickman Battles Socket.io relay instead,
// which already allows this site's GitHub Pages origin. Leave relayUrl empty to hide them.
window.ARCADE_CONFIG = {
  firebaseUrl: '',
  relayUrl: 'https://stickman-battles.onrender.com',
};
