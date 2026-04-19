// signup.js — completely standalone, no redirectIfLoggedIn, no shared auth listener
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// Initialise Firebase directly here — avoids any shared state with other modules
const firebaseConfig = {
  apiKey: "AIzaSyD4YBiTeK92QN_BkUSj9haPl_Cfb0CTgAg",
  authDomain: "projectcards-b6b53.firebaseapp.com",
  databaseURL: "https://projectcards-b6b53-default-rtdb.firebaseio.com",
  projectId: "projectcards-b6b53",
  storageBucket: "projectcards-b6b53.firebasestorage.app",
  messagingSenderId: "625461773361",
  appId: "1:625461773361:web:b47ae17ec449966a418110"
};

const app = initializeApp(firebaseConfig, "signup-instance");
const auth = getAuth(app);
const database = getDatabase(app);

const signupForm = document.getElementById("signup-form");
const signupBtn = document.getElementById("signup-btn");
const statusEl = document.getElementById("signup-status");

function setStatus(msg, color = "#ccc") {
  statusEl.style.color = color;
  statusEl.textContent = msg;
}

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupBtn.disabled = true;
  signupBtn.textContent = "Creating account...";
  setStatus("");

  const username = document.getElementById("signup-username").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value.trim();

  if (!username || !email || !password) {
    setStatus("Please fill out all fields.", "#d63031");
    signupBtn.disabled = false;
    signupBtn.textContent = "Create Account";
    return;
  }

  if (password.length < 6) {
    setStatus("Password must be at least 6 characters.", "#d63031");
    signupBtn.disabled = false;
    signupBtn.textContent = "Create Account";
    return;
  }

  try {
    // Step 1: Create the Firebase Auth user
    setStatus("Creating account...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log("Auth user created:", user.uid);

    // Step 2: Write user record to Realtime Database
    setStatus("Saving your profile...");
    const userRef = ref(database, "users/" + user.uid);
    await set(userRef, {
      username: username,
      email: email,
      points: 500,
      cards: {},
      profilePicture: ""
    });
    console.log("Database write complete for:", user.uid);

    // Step 3: Confirm data is readable
    setStatus("Verifying...");
    const verify = await get(userRef);
    if (!verify.exists()) {
      setStatus("❌ Profile saved but couldn't verify. Check Firebase rules.", "#d63031");
      signupBtn.disabled = false;
      signupBtn.textContent = "Create Account";
      return;
    }
    console.log("Verified in DB:", verify.val());

    // Step 4: Sign out of the signup instance so login.js handles the session cleanly
    await auth.signOut();

    setStatus("✅ Account created! Redirecting to login...", "#00b894");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);

  } catch (err) {
    console.error("Signup error:", err.code, err.message);
    if (err.code === "auth/email-already-in-use") {
      setStatus("That email is already registered.", "#d63031");
    } else if (err.code === "auth/weak-password") {
      setStatus("Password is too weak.", "#d63031");
    } else {
      setStatus("Error: " + err.message, "#d63031");
    }
    signupBtn.disabled = false;
    signupBtn.textContent = "Create Account";
  }
});
