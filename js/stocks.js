import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, onValue, off, runTransaction, push } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo       = document.getElementById("user-info");
const stockContainer = document.getElementById("stock-container");

let currentUser       = null;
let currentPoints     = 0;
let currentUserStocks = {};
let stocksListener    = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  const snap = await get(ref(database, "users/" + user.uid));
  const userData = snap.val();
  if (!userData) return;
  currentPoints     = userData.points;
  currentUserStocks = userData.stocks || {};
  userInfo.textContent = `Balance: $${currentPoints}`;
  loadStocks(user.uid);
});

function loadStocks(uid) {
  const stocksRef = ref(database, "stocks");
  if (stocksListener) off(stocksRef, "value", stocksListener);
  stocksListener = onValue(stocksRef, async (snapshot) => {
    const stocks = snapshot.val();
    if (!stocks) { stockContainer.innerHTML = "<p>No stocks available.</p>"; return; }
    // Re-fetch user data fresh on every update
    const snap = await get(ref(database, "users/" + uid));
    const userData = snap.val();
    currentUserStocks = userData.stocks || {};
    currentPoints     = userData.points;
    userInfo.textContent = `Balance: $${currentPoints}`;
    renderStocks(stocks, uid);
  });
}

function renderStocks(stocks, uid) {
  stockContainer.innerHTML = "";
  for (const [id, data] of Object.entries(stocks)) {
    const owned        = parseInt(currentUserStocks[id] || 0);
    const price        = parseInt(data.price);
    const indicator    = data.lastChange === "up" ? "🔺" : data.lastChange === "down" ? "🔻" : "";
    const indClass     = data.lastChange === "up" ? "up"  : data.lastChange === "down" ? "down" : "";
    const minPrice     = Math.max(Math.floor(parseInt(data.original_price) * 0.4), 1);
    const maxPrice     = Math.ceil(parseInt(data.original_price) * 2.5);
    const cantAfford   = currentPoints < price;

    const div = document.createElement("div");
    div.classList.add("stock-item");
    div.innerHTML = `
      <div class="stock-ticker">${data.ticker || id.toUpperCase()}</div>
      <div class="stock-name">${data.name}</div>
      <div class="stock-price ${indClass}">$${price} ${indicator}</div>
      <div class="stock-range">Range: $${minPrice} – $${maxPrice}</div>
      <div class="stock-owned">You own: <strong>${owned}</strong> share${owned !== 1 ? "s" : ""}</div>
      <div class="stock-value">${owned > 0 ? `Value: $${owned * price}` : ""}</div>
      <div class="stock-buttons">
        <button class="buy-stock-btn" data-id="${id}" data-price="${price}" ${cantAfford ? "disabled" : ""}>
          ${cantAfford ? "Can't afford" : "Buy $" + price}
        </button>
        <button class="sell-stock-btn" data-id="${id}" data-price="${price}" ${owned <= 0 ? "disabled" : ""}>
          ${owned <= 0 ? "None owned" : "Sell $" + price}
        </button>
      </div>
    `;
    stockContainer.appendChild(div);
  }

  document.querySelectorAll(".buy-stock-btn").forEach(btn => {
    btn.onclick = () => buyStock(uid, btn.dataset.id, parseInt(btn.dataset.price));
  });
  document.querySelectorAll(".sell-stock-btn").forEach(btn => {
    btn.onclick = () => sellStock(uid, btn.dataset.id, parseInt(btn.dataset.price));
  });
}

// --- BUY — price passed in directly to avoid stale read inside transaction ---
async function buyStock(uid, stockId, price) {
  const userRef = ref(database, "users/" + uid);

  // Pre-check with a fresh read before attempting the transaction
  const userSnap = await get(userRef);
  const userData = userSnap.val();
  if (!userData) return alert("Could not load your account.");
  if (userData.points < price) return alert("Not enough funds!");

  try {
    await runTransaction(userRef, (user) => {
      if (!user) return user;              // let Firebase retry — do NOT abort on null
      if (user.points < price) return;    // genuinely can't afford — abort
      user.points -= price;
      if (!user.stocks) user.stocks = {};
      user.stocks[stockId] = (parseInt(user.stocks[stockId]) || 0) + 1;
      return user;
    });
    await push(ref(database, "transactions"), { stockId, action: "buy" });
  } catch (err) {
    console.error("Buy stock failed:", err);
    alert("Purchase failed: " + err.message);
  }
}

// --- SELL ---
async function sellStock(uid, stockId, price) {
  const userRef = ref(database, "users/" + uid);

  const userSnap = await get(userRef);
  const userData = userSnap.val();
  if (!userData) return alert("Could not load your account.");
  const owned = parseInt(userData.stocks?.[stockId] || 0);
  if (owned <= 0) return alert("You don't own any shares of this stock!");

  try {
    await runTransaction(userRef, (user) => {
      if (!user) return user;
      const qty = parseInt(user.stocks?.[stockId] || 0);
      if (qty <= 0) return;               // don't own it anymore — abort
      user.points += price;
      user.stocks[stockId] = qty - 1;
      if (user.stocks[stockId] <= 0) delete user.stocks[stockId];
      return user;
    });
    await push(ref(database, "transactions"), { stockId, action: "sell" });
  } catch (err) {
    console.error("Sell stock failed:", err);
    alert("Sale failed: " + err.message);
  }
}
