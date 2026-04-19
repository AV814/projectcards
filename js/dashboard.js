import { auth, database, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref as dbRef, get, onValue, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const userInfo = document.getElementById("user-info");
const cardContainer = document.getElementById("card-container");
const logoutBtn = document.getElementById("logout");
const changePfpBtn = document.getElementById("change-pfp");
const uploadPfpInput = document.getElementById("upload-pfp");
const profilePic = document.getElementById("profile-pic");

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;
  const userRef = dbRef(database, "users/" + user.uid);

  try {
    // Retry up to 5 times with 800ms gaps — handles race condition on new signups
    let userSnap = null;
    for (let i = 0; i < 5; i++) {
      userSnap = await get(userRef);
      if (userSnap.exists()) break;
      await new Promise(res => setTimeout(res, 800));
    }

    if (!userSnap.exists()) {
      alert("Your account data could not be found. Please sign up again.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    const userData = userSnap.val();

    userInfo.innerHTML = `
      ${userData.username}<br>
      <span class="points">$${userData.points}</span>
    `;

    profilePic.src = userData.profilePicture || "";

    // Live-update cards if prices change
    const cardsRef = dbRef(database, "cards");
    onValue(cardsRef, (cardsSnap) => {
      loadUserCards(userData.cards || {}, cardsSnap.val());
    });

    // Also re-fetch user cards on any user data change (after buys/sells)
    onValue(userRef, (updatedSnap) => {
      const updatedUser = updatedSnap.val();
      if (!updatedUser) return;
      userInfo.innerHTML = `
        ${updatedUser.username}<br>
        <span class="points">$${updatedUser.points}</span>
      `;
      get(cardsRef).then((cardsSnap) => {
        loadUserCards(updatedUser.cards || {}, cardsSnap.val());
      });
    });

  } catch (err) {
    console.error("Error fetching user data:", err);
    alert("Failed to load your data. Please try again.");
  }
});

// Load user's owned cards
function loadUserCards(userCards, allCards) {
  cardContainer.innerHTML = "";

  if (!userCards || Object.keys(userCards).length === 0) {
    cardContainer.innerHTML = "<p>Inventory is currently empty.</p>";
    return;
  }

  if (!allCards) return;

  let totalCardValue = 0;

  for (const [id, quantity] of Object.entries(userCards)) {
    if (!quantity || quantity <= 0) continue;
    const cardData = allCards[id];
    if (!cardData) continue;

    const cardValue = parseInt(cardData.price) * parseInt(quantity);
    totalCardValue += cardValue;

    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <h3>${cardData.name}</h3>
      <img src="${cardData.image}" alt="${cardData.name}" class="card-image" />
      <p>Qty: ${quantity}</p>
      <p class="card-value">Value: $${cardValue}</p>
    `;
    cardContainer.appendChild(div);
  }

  // Show total card portfolio value
  const totalEl = document.getElementById("total-card-value");
  if (totalEl) totalEl.textContent = `Cards value: $${totalCardValue}`;
}

// Profile picture upload
changePfpBtn.addEventListener("click", () => uploadPfpInput.click());

uploadPfpInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;

  const filePath = `profile_pictures/${currentUser.uid}.jpg`;
  const fileRef = storageRef(storage, filePath);

  try {
    await uploadBytes(fileRef, file);
    const downloadURL = await getDownloadURL(fileRef);

    await update(dbRef(database, "users/" + currentUser.uid), {
      profilePicture: downloadURL,
    });

    profilePic.src = downloadURL;
    alert("Profile picture updated!");
  } catch (err) {
    console.error("Error uploading profile picture:", err);
    alert("Failed to upload profile picture. Please try again.");
  }
});

// Logout
logoutBtn.addEventListener("click", () => {
  signOut(auth).then(() => {
    window.location.href = "index.html";
  });
});
