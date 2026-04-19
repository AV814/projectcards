import { auth, database } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// If already logged in, skip straight to menu
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "menu.html";
});

const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    const userSnap = await get(ref(database, "users/" + user.uid));
    if (!userSnap.exists()) {
      alert("No account data found. Please sign up.");
      window.location.href = "signup.html";
      return;
    }

    window.location.href = "menu.html";
  } catch (err) {
    console.error("Login error:", err);
    alert("Login failed: " + err.message);
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
});
