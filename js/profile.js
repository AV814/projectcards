import { database } from "./firebase.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const playerNameEl = document.getElementById("player-name");
const playerPointsEl = document.getElementById("player-points");
const playerPfpEl = document.getElementById("player-pfp");
const cardListEl = document.getElementById("card-list");

// Get UID from URL
const params = new URLSearchParams(window.location.search);
const uid = params.get("id");

if (!uid) {
  playerNameEl.textContent = "Invalid profile link.";
} else {
  loadProfile(uid);
}

async function loadProfile(uid) {
  const userRef = ref(database, "users/" + uid);
  const cardsRef = ref(database, "cards");

  try {
    const [userSnap, cardsSnap] = await Promise.all([get(userRef), get(cardsRef)]);
    const userData = userSnap.val();
    const allCards = cardsSnap.val();

    if (!userData) {
      playerNameEl.textContent = "User not found.";
      return;
    }

    // 🧍 Display username, points, and profile picture
    playerNameEl.textContent = userData.username || "Unknown Player";
    playerPointsEl.textContent = `$${userData.points || 0}`;

    // ✅ Profile picture
    const pfp = userData.profilePicture;
    playerPfpEl.src =
      pfp && (pfp.startsWith("http://") || pfp.startsWith("https://"))
        ? pfp
        : "images/default-pfp.png";

    // 🎴 Display cards (same style as dashboard)
    const userCards = userData.cards || {};
    renderCards(userCards, allCards);
  } catch (err) {
    console.error("Error loading profile:", err);
    playerNameEl.textContent = "Error loading profile.";
  }
}

// ✅ This matches the dashboard style exactly
function renderCards(userCards, allCards) {
  cardListEl.innerHTML = "";

  if (!userCards || Object.keys(userCards).length === 0) {
    cardListEl.innerHTML = "<p>This player has no cards yet.</p>";
    return;
  }

  for (const [id, quantity] of Object.entries(userCards)) {
    const cardData = allCards[id];
    if (!cardData) continue;

    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <h3>${cardData.name}</h3>
      <img src="${cardData.image}" alt="${cardData.name}" class="card-image" />
      <p>Quantity: ${quantity}</p>
    `;
    cardListEl.appendChild(div);
  }
}
