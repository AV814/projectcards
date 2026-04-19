import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  ref,
  update,
  get,
  onValue,
  off,
  runTransaction,
  push,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo = document.getElementById("user-info");
const cardContainer = document.getElementById("card-container");

let currentUser = null;
let currentPoints = 0;
let currentUserCards = {};
let cardsListener = null;

// Track login state
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userSnap = await get(ref(database, "users/" + user.uid));
    const userData = userSnap.val();
    if (!userData) return;

    currentPoints = userData.points;
    currentUserCards = userData.cards || {};
    userInfo.textContent = `Balance: $${userData.points}`;
    loadStore(user.uid);
  } else {
    window.location.href = "index.html";
  }
});

// Load store with live listener
function loadStore(uid) {
  const cardsRef = ref(database, "cards");

  if (cardsListener) off(cardsRef, "value", cardsListener);

  cardsListener = onValue(cardsRef, async (snapshot) => {
    const cards = snapshot.val();
    if (!cards) return;

    // Refresh user data on every price update
    const userSnap = await get(ref(database, "users/" + uid));
    const userData = userSnap.val();
    currentUserCards = userData.cards || {};
    currentPoints = userData.points;
    userInfo.textContent = `Balance: $${currentPoints}`;

    renderStore(cards, uid);
  });
}

// Render store cards
function renderStore(cards, uid) {
  cardContainer.innerHTML = "";

  for (const [id, data] of Object.entries(cards)) {
    const div = document.createElement("div");
    div.classList.add("card-item");

    const indicator =
      data.lastChange === "up"
        ? "🔺"
        : data.lastChange === "down"
        ? "🔻"
        : "";

    const indicatorClass =
      data.lastChange === "up"
        ? "up"
        : data.lastChange === "down"
        ? "down"
        : "";

    const ownedCount = currentUserCards[id] || 0;
    const price = parseInt(data.price);
    const sellPrice = Math.floor(price * 0.9);
    const outOfStock = parseInt(data.stock) <= 0;
    const cantAfford = currentPoints < price;

    div.innerHTML = `
      <h3>${data.name}</h3>
      <img src="${data.image}" alt="${data.name}" class="card-image" />
      <p class="${indicatorClass}">Price: $${price} ${indicator}</p>
      <p class="sell-price-hint">Sell back: $${sellPrice}</p>
      <p>Stock: ${outOfStock ? "<span style='color:#d63031'>Sold out</span>" : data.stock}</p>
      <p>You own: <strong>${ownedCount}</strong></p>
      <button class="buy-btn" data-id="${id}" ${outOfStock || cantAfford ? "disabled" : ""}>
        ${cantAfford && !outOfStock ? "Can't afford" : "Buy"}
      </button>
      <button class="sell-btn" data-id="${id}" ${ownedCount <= 0 ? "disabled" : ""}>Sell</button>
    `;

    cardContainer.appendChild(div);
  }

  document.querySelectorAll(".buy-btn").forEach((btn) => {
    btn.onclick = () => buyCard(uid, btn.dataset.id);
  });
  document.querySelectorAll(".sell-btn").forEach((btn) => {
    btn.onclick = () => sellCard(uid, btn.dataset.id);
  });
}

// --- BUY CARD ---
async function buyCard(uid, cardId) {
  const userRef = ref(database, "users/" + uid);
  const cardRef = ref(database, "cards/" + cardId);

  try {
    const cardSnap = await get(cardRef);
    const cardData = cardSnap.val();
    if (!cardData) return alert("Card not found.");
    if (parseInt(cardData.stock) <= 0) return alert("Sorry, that card is out of stock!");

    const price = parseInt(cardData.price);

    let purchaseFailed = false;
    await runTransaction(userRef, (userData) => {
      if (!userData) return userData;
      if (userData.points < price) {
        purchaseFailed = true;
        return; // abort
      }
      userData.points -= price;
      if (!userData.cards) userData.cards = {};
      userData.cards[cardId] = (userData.cards[cardId] || 0) + 1;
      return userData;
    });

    if (purchaseFailed) {
      return alert("Not enough points to buy this card!");
    }

    await runTransaction(cardRef, (cardData) => {
      if (!cardData) return cardData;
      if (cardData.stock > 0) cardData.stock -= 1;
      return cardData;
    });

    await push(ref(database, "transactions"), {
      card: cardData.name,
      action: "buy",
      timestamp: serverTimestamp(),
    });

  } catch (err) {
    console.error("Buy transaction failed:", err);
    alert("Purchase failed. Please try again.");
  }
}

// --- SELL CARD ---
async function sellCard(uid, cardId) {
  const userRef = ref(database, "users/" + uid);
  const cardRef = ref(database, "cards/" + cardId);

  try {
    const cardSnap = await get(cardRef);
    const cardData = cardSnap.val();
    if (!cardData) return alert("Card not found.");

    const sellPrice = Math.floor(parseInt(cardData.price) * 0.9);

    let sellFailed = false;
    await runTransaction(userRef, (userData) => {
      if (!userData || !userData.cards || !userData.cards[cardId]) {
        sellFailed = true;
        return;
      }
      userData.points += sellPrice;
      userData.cards[cardId] -= 1;
      if (userData.cards[cardId] <= 0) delete userData.cards[cardId];
      return userData;
    });

    if (sellFailed) {
      return alert("You don't own that card!");
    }

    await runTransaction(cardRef, (cardData) => {
      if (!cardData) return cardData;
      cardData.stock += 1;
      return cardData;
    });

    await push(ref(database, "transactions"), {
      card: cardData.name,
      action: "sell",
      timestamp: serverTimestamp(),
    });

  } catch (err) {
    console.error("Sell transaction failed:", err);
    alert("Sale failed. Please try again.");
  }
}
