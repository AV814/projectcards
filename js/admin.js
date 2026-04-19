import { database } from "./firebase.js";
import {
  ref, onValue, update, get, remove,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const cardList = document.getElementById("card-list");
const countdownEl = document.getElementById("countdown");
const forceBtn = document.getElementById("force-update");
const resetBtn = document.getElementById("force-sell");
const statusEl = document.getElementById("status-msg");

// How often prices auto-update (seconds)
const INTERVAL_SECONDS = 3600;
let countdown = INTERVAL_SECONDS;
let updateRunning = false;

const cardsRef = ref(database, "cards");
const usersRef = ref(database, "users");

// --- Display all cards ---
onValue(cardsRef, (snapshot) => {
  const cards = snapshot.val();
  if (!cards) { cardList.innerHTML = "<p>No cards found in database.</p>"; return; }
  cardList.innerHTML = "";

  for (const [id, data] of Object.entries(cards)) {
    const indicator = data.lastChange === "up" ? "🔺" : data.lastChange === "down" ? "🔻" : data.lastChange === "reset" ? "🔄" : "";
    const indicatorClass = data.lastChange === "up" ? "up" : data.lastChange === "down" ? "down" : "";
    const tierDisplay = data.tier ? `Tier ${data.tier}` : "Tier ?";
    const minPrice = Math.max(Math.floor(parseInt(data.original_price) * 0.4), 1);
    const maxPrice = Math.ceil(parseInt(data.original_price) * 2.5);

    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <h3>${data.name}</h3>
      <p class="${indicatorClass}"><strong>$${data.price}</strong> ${indicator}</p>
      <p>Stock: ${data.stock} / ${data.original_stock}</p>
      <p><small>Original: $${data.original_price} &nbsp;|&nbsp; ${tierDisplay}</small></p>
      <p><small style="color:#888">Range: $${minPrice} – $${maxPrice}</small></p>
    `;
    cardList.appendChild(div);
  }
});

// --- Tier volatility ---
function getTierVolatility(tier) {
  switch (parseInt(tier)) {
    case 1: return 0.05;
    case 2: return 0.10;
    case 3: return 0.20;
    case 4: return 0.35;
    case 5: return 0.50;
    default: return 0.10;
  }
}

// --- Generate new price ---
function getNewPrice(currentPrice, originalPrice, tier) {
  const minPrice = Math.max(Math.floor(originalPrice * 0.4), 1);
  const maxPrice = Math.ceil(originalPrice * 2.5);
  const volatility = getTierVolatility(tier);
  const changePercent = (Math.random() * volatility * 2) - volatility;
  const newPrice = Math.round(currentPrice * (1 + changePercent));
  return Math.max(minPrice, Math.min(maxPrice, newPrice));
}

function setStatus(msg, color = "#fdcb6e") {
  if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
  console.log(msg);
}

// --- Price update ---
async function updatePrices() {
  if (updateRunning) return;
  updateRunning = true;
  forceBtn.disabled = true;
  setStatus("⏳ Updating prices...");

  try {
    const [cardsSnap, usersSnap, txSnap] = await Promise.all([
      get(cardsRef),
      get(usersRef),
      get(ref(database, "transactions")),
    ]);

    const cards = cardsSnap.val();
    if (!cards) { setStatus("No cards found.", "#d63031"); return; }

    const users = usersSnap.val() || {};
    const transactions = txSnap.val() || {};
    const txList = Object.values(transactions);

    const batchUpdate = {};

    for (const [id, card] of Object.entries(cards)) {
      const currentPrice = parseInt(card.price);
      const originalPrice = parseInt(card.original_price);
      const tier = card.tier || 1;
      let newPrice = getNewPrice(currentPrice, originalPrice, tier);

      // Demand: match transactions by cardId (set by store.js)
      const cardTxs = txList.filter((tx) => tx.cardId === id);
      const buys = cardTxs.filter((t) => t.action === "buy").length;
      const sells = cardTxs.filter((t) => t.action === "sell").length;

      let demand = 0;
      if (buys > sells) demand += 0.05 * originalPrice;
      else if (sells > buys) demand -= 0.05 * originalPrice;

      // Stock pressure: low stock nudges price up
      const stockRatio = parseInt(card.stock) / parseInt(card.original_stock || 1);
      demand += originalPrice * (1 - stockRatio) * 0.1;

      // Monopoly pressure: if one player owns >50% of original stock, price drops
      let maxOwnership = 0;
      for (const userData of Object.values(users)) {
        const qty = (userData.cards && userData.cards[id]) || 0;  // FIX: use card ID not name
        const ratio = qty / parseInt(card.original_stock || 1);
        if (ratio > maxOwnership) maxOwnership = ratio;
      }
      if (maxOwnership > 0.5 || parseInt(card.stock) === 0) {
        demand -= originalPrice * 0.15;
      }

      newPrice = Math.round(newPrice + demand);
      const minPrice = Math.max(Math.floor(originalPrice * 0.4), 1);
      const maxPrice = Math.ceil(originalPrice * 2.5);
      newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));

      batchUpdate[`cards/${id}/price`] = String(newPrice);
      batchUpdate[`cards/${id}/lastChange`] = newPrice > currentPrice ? "up" : newPrice < currentPrice ? "down" : "same";
    }

    await update(ref(database), batchUpdate);
    await remove(ref(database, "transactions"));

    countdown = INTERVAL_SECONDS;
    setStatus("✅ Prices updated!", "#00b894");
  } catch (err) {
    console.error("Price update failed:", err);
    setStatus("❌ Update failed: " + err.message, "#d63031");
  } finally {
    updateRunning = false;
    forceBtn.disabled = false;
  }
}

// --- Force Sell & Reset Market ---
async function forceSellAndReset() {
  if (!confirm("⚠️ This will sell ALL players' cards at current prices and reset the market. Are you sure?")) return;

  resetBtn.disabled = true;
  setStatus("⏳ Selling all cards and resetting market...");

  try {
    const [cardsSnap, usersSnap] = await Promise.all([
      get(ref(database, "cards")),
      get(ref(database, "users")),
    ]);

    if (!cardsSnap.exists() || !usersSnap.exists()) {
      setStatus("❌ Missing cards or users data!", "#d63031");
      return;
    }

    const cards = cardsSnap.val();
    const users = usersSnap.val();
    const batchUpdate = {};

    // Pay out all players for their cards
    for (const [userId, userData] of Object.entries(users)) {
      let points = userData.points || 0;
      const ownedCards = userData.cards || {};

      for (const [cardId, quantity] of Object.entries(ownedCards)) {
        const card = cards[cardId];  // FIX: look up by card ID, not name
        if (!card) continue;
        points += parseInt(card.price) * parseInt(quantity);
      }

      batchUpdate[`users/${userId}/points`] = points;
      batchUpdate[`users/${userId}/cards`] = {};
    }

    // Reset all cards to original price and stock
    for (const [cardId, card] of Object.entries(cards)) {
      batchUpdate[`cards/${cardId}/price`] = parseInt(card.original_price);
      batchUpdate[`cards/${cardId}/stock`] = parseInt(card.original_stock);
      batchUpdate[`cards/${cardId}/lastChange`] = "reset";
    }

    // Clear transactions too
    batchUpdate["transactions"] = null;

    await update(ref(database), batchUpdate);
    setStatus("✅ Market reset! All players paid out.", "#00b894");
    alert("✅ All players' cards sold and market reset!");
  } catch (err) {
    console.error("Reset failed:", err);
    setStatus("❌ Reset failed: " + err.message, "#d63031");
  } finally {
    resetBtn.disabled = false;
  }
}

// --- Countdown ---
setInterval(() => {
  countdown--;
  countdownEl.textContent = countdown;
  if (countdown <= 0) updatePrices();
}, 1000);

forceBtn.addEventListener("click", updatePrices);
resetBtn.addEventListener("click", forceSellAndReset);
