// Iconundrum configuration.
// The Firebase web config is public-by-design — security lives in Firestore rules.

export const firebaseConfig = {
  apiKey: "AIzaSyCg89Enwd1VNyI_abBY528gRBtx8KKdJXo",
  authDomain: "iconundrum.firebaseapp.com",
  projectId: "iconundrum",
  storageBucket: "iconundrum.firebasestorage.app",
  messagingSenderId: "229519071531",
  appId: "1:229519071531:web:2cad41e1d541ccf3620d6e",
};

// Mode defaults/limits live in cfg.js (they encode into challenge links).
export const GAME = {
  // Items must be worth at least this many gold to appear in price modes.
  priceModeMinGold: 5,
  maxNameLen: 20,
};
