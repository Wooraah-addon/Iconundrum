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

export const GAME = {
  pack: 'items',
  iconRounds: 5,
  iconTimerSec: 10,
  valueRounds: 5,
  valueTimerSec: 20,
  // Higher/Lower: adjacent cards must differ by at least this price ratio,
  // so calls are defensible and never stale-data coin-flips.
  hlMinSeparation: 1.25,
  // Items must be worth at least this many gold to appear in price modes.
  priceModeMinGold: 5,
  maxNameLen: 20,
};
