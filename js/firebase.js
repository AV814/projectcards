// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// Your Firebase configuration (replace with your own)
const firebaseConfig = {
  apiKey: "AIzaSyD4YBiTeK92QN_BkUSj9haPl_Cfb0CTgAg",
  authDomain: "projectcards-b6b53.firebaseapp.com",
  databaseURL: "https://projectcards-b6b53-default-rtdb.firebaseio.com",
  projectId: "projectcards-b6b53",
  storageBucket: "projectcards-b6b53.firebasestorage.app",
  messagingSenderId: "625461773361",
  appId: "1:625461773361:web:b47ae17ec449966a418110",
  measurementId: "G-FV690XG2R7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
export const storage = getStorage(app);

export { app, auth, database };
