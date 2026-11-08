// Online features (global leaderboards, players online, ghost racing, live matches) use a
// Firebase Realtime Database. Paste your database URL below to turn them on, e.g.
//   firebaseUrl: 'https://pixel-pioneers-default-rtdb.firebaseio.com'
// Leave it empty and the arcade runs fully offline. Setup steps are in README.md.
//
// firebaseApiKey turns on player accounts (Firebase Authentication). It's the "apiKey" from the
// project's web app config. It is meant to be public: the database rules are what protect the data.
//
// Real-time matches (Rune Rumble) go through the Stickman Battles Socket.io relay instead,
// which already allows this site's GitHub Pages origin. Leave relayUrl empty to hide them.
window.ARCADE_CONFIG = {
  firebaseUrl: 'https://pixel-pioneers-arcade-default-rtdb.firebaseio.com',
  firebaseApiKey: 'AIzaSyBDVaouXVVv34QNxDNt7vdd4SZC5Ipd9Wk',
  relayUrl: 'https://stickman-battles.onrender.com',
};
