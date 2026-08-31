// ============================================
// FIREBASE CONFIGURATION
// ============================================
// Replace these values with your own Firebase config
// Go to: https://console.firebase.google.com
// Create project -> Add web app -> Copy config

const firebaseConfig = {
    apiKey: "AIzaSyB33jHFA95_h9B6hUpNOZUhIdqPjlY36nw",
    authDomain: "paopoint-8f729.firebaseapp.com",
    projectId: "paopoint-8f729",
    storageBucket: "paopoint-8f729.firebasestorage.app",
    messagingSenderId: "657655176843",
    appId: "1:657655176843:web:68f9358b76c62ebf33be8e"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Services (only Firestore, no Firebase Auth needed)
const db = firebase.firestore();

// ============================================
// BOT CONFIGURATION
// ============================================
// Change this to your Telegram bot username (without @)
const BOT_NAME = "PaoPoint";

// App Settings (admin configurable via localStorage)
const APP_SETTINGS = {
    coinPerTap: 1,
    maxTapsPerRound: 50,
    tapResetMinutes: 30,
    dailyCheckinBase: 10,
    dailyCheckinMaxBonus: 50,
    referralReward: 100,
    referralBonus: 50,
    adReward: 5,
    adDailyLimit: 10,
    adDuration: 15, // seconds
};

// Load admin settings if saved
function loadAdminSettings() {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
        try {
            Object.assign(APP_SETTINGS, JSON.parse(saved));
        } catch (e) {}
    }
}
loadAdminSettings();
