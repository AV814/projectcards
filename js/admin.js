import { database } from "./firebase.js";
import { ref, onValue, update, get, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const stockList     = document.getElementById("stock-list");
const cardList      = document.getElementById("card-list");
const countdownEl   = document.getElementById("countdown");
const forceStocksBtn = document.getElementById("force-stocks");
const weeklyResetBtn = document.getElementById("weekly-reset");
const statusEl      = document.getElementById("status-msg");

const STOCK_INTERVAL = 600;
let countdown = STOCK_INTERVAL;
let running   = false;

// --- Live display: stocks ---
onValue(ref(database, "stocks"), (snap) => {
  const stocks = snap.val();
  if (!stocks) { stockList.innerHTML = "<p>No stocks in DB.</p>"; return; }
  stockList.innerHTML = "";
  for (const [id, data] of Object.entries(stocks)) {
    const ind = data.lastChange === "up" ? "🔺" : data.lastChange === "down" ? "🔻" : "";
    const cls = data.lastChange === "up" ? "up"  : data.lastChange === "down" ? "down" : "";
    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <h3>${data.ticker || id} — ${data.name}</h3>
      <p class="${cls}"><strong>$${data.price}</strong> ${ind}</p>
      <p><small>Original: $${data.original_price} | Range: $${Math.floor(data.original_price*0.4)}–$${Math.ceil(data.original_price*2.5)}</small></p>
    `;
    stockList.appendChild(div);
  }
});

// --- Live display: cards (static prices, show sell chance) ---
onValue(ref(database, "cards"), (snap) => {
  const cards = snap.val();
  if (!cards) { cardList.innerHTML = "<p>No cards in DB.</p>"; return; }
  cardList.innerHTML = "";
  for (const [id, data] of Object.entries(cards)) {
    const chance     = parseFloat(data.sellChance    || 0.5) * 100;
    const multiplier = parseFloat(data.sellMultiplier || 1.5);
    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <h3>${data.name}</h3>
      <p><strong>$${data.price}</strong></p>
      <p><small>Tier ${data.tier || "?"} | Original: $${data.original_price}</small></p>
      <p><small style="color:#fdcb6e">↑ Sell chance: ${chance.toFixed(0)}% (×${multiplier})</small></p>
    `;
    cardList.appendChild(div);
  }
});

function setStatus(msg, color = "#fdcb6e") {
  if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
  console.log(msg);
}

function getVolatility(tier) {
  return [0, 0.05, 0.10, 0.20, 0.35, 0.50][parseInt(tier)] || 0.10;
}

function calcNewPrice(current, original, tier) {
  const min = Math.max(Math.floor(original * 0.4), 1);
  const max = Math.ceil(original * 2.5);
  const v   = getVolatility(tier);
  const pct = (Math.random() * v * 2) - v;
  return Math.max(min, Math.min(max, Math.round(current * (1 + pct))));
}

// --- Update STOCK prices only (cards stay fixed during the week) ---
async function updateStockPrices() {
  if (running) return;
  running = true;
  forceStocksBtn.disabled = true;
  setStatus("⏳ Updating stock prices...");

  try {
    const [stocksSnap, txSnap] = await Promise.all([
      get(ref(database, "stocks")),
      get(ref(database, "transactions")),
    ]);
    const stocks = stocksSnap.val();
    if (!stocks) { setStatus("No stocks found.", "#d63031"); return; }

    const txList = Object.values(txSnap.val() || {});
    const batch  = {};

    for (const [id, stock] of Object.entries(stocks)) {
      const cur  = parseInt(stock.price);
      const orig = parseInt(stock.original_price);
      const tier = stock.tier || 2;
      let newPrice = calcNewPrice(cur, orig, tier);

      const buys  = txList.filter(t => t.stockId === id && t.action === "buy").length;
      const sells = txList.filter(t => t.stockId === id && t.action === "sell").length;
      let demand  = 0;
      if (buys > sells)       demand += 0.05 * orig;
      else if (sells > buys)  demand -= 0.05 * orig;

      newPrice = Math.max(
        Math.max(Math.floor(orig * 0.4), 1),
        Math.min(Math.ceil(orig * 2.5), Math.round(newPrice + demand))
      );

      batch[`stocks/${id}/price`]      = String(newPrice);
      batch[`stocks/${id}/lastChange`] = newPrice > cur ? "up" : newPrice < cur ? "down" : "same";
    }

    await update(ref(database), batch);
    await remove(ref(database, "transactions"));
    countdown = STOCK_INTERVAL;
    setStatus("✅ Stock prices updated!", "#00b894");
  } catch (err) {
    setStatus("❌ " + err.message, "#d63031");
  } finally {
    running = false;
    forceStocksBtn.disabled = false;
  }
}

// --- Weekly reset ---
// Each card has:
//   sellChance    (0–1)  — probability of the "good" outcome
//   sellMultiplier (>1)  — how much higher the good price is  (e.g. 1.5 = +50%)
//   sellPenalty   (0–1)  — multiplier for the bad outcome     (e.g. 0.7 = -30%)
// One roll per card, universal: everyone with that card gets the same outcome.
async function weeklyReset() {
  if (!confirm("⚠️ Weekly reset: roll sell outcomes, pay out all players, reset market. Continue?")) return;
  weeklyResetBtn.disabled = true;
  setStatus("⏳ Running weekly reset...");

  try {
    const [cardsSnap, usersSnap] = await Promise.all([
      get(ref(database, "cards")),
      get(ref(database, "users")),
    ]);
    if (!cardsSnap.exists() || !usersSnap.exists()) {
      setStatus("❌ Missing data!", "#d63031"); return;
    }

    const cards = cardsSnap.val();
    const users = usersSnap.val();
    const batch = {};
    const weekLabel = new Date().toLocaleDateString("en-US",
      { month: "short", day: "numeric", year: "numeric" });

    // --- Roll outcomes once per card (universal) ---
    const cardOutcomes = {}; // cardId -> { finalPrice, outcome: "up"|"down", roll }
    for (const [cardId, card] of Object.entries(cards)) {
      const basePrice     = parseInt(card.price);
      const sellChance    = parseFloat(card.sellChance    || 0.5);
      const sellMultiplier = parseFloat(card.sellMultiplier || 1.5);
      const sellPenalty   = parseFloat(card.sellPenalty   || 0.7);
      const roll          = Math.random();
      const hit           = roll < sellChance;
      const finalPrice    = hit
        ? Math.round(basePrice * sellMultiplier)
        : Math.round(basePrice * sellPenalty);
      cardOutcomes[cardId] = { finalPrice, outcome: hit ? "up" : "down", roll: roll.toFixed(3) };
    }

    // --- Pay out all players using rolled prices ---
    for (const [userId, userData] of Object.entries(users)) {
      const ownedCards = userData.cards || {};
      let earnings = 0;
      const reportLines = [];

      for (const [cardId, qty] of Object.entries(ownedCards)) {
        const card    = cards[cardId];
        const outcome = cardOutcomes[cardId];
        if (!card || !outcome || parseInt(qty) <= 0) continue;

        const saleTotal = outcome.finalPrice * parseInt(qty);
        earnings += saleTotal;
        reportLines.push({
          name:       card.name,
          qty:        parseInt(qty),
          basePrice:  parseInt(card.price),
          finalPrice: outcome.finalPrice,
          outcome:    outcome.outcome,
          total:      saleTotal,
        });
      }

      batch[`users/${userId}/points`]          = (userData.points || 0) + earnings;
      batch[`users/${userId}/cards`]           = {};
      batch[`users/${userId}/lastWeeklyReport`] = {
        week:     weekLabel,
        earnings,
        soldAt:   Date.now(),
        lines:    reportLines,
        outcomes: cardOutcomes, // full outcome table so players can see every card's result
      };
    }

    // --- Reset cards to original price/stock, clear lastChange ---
    for (const [cardId, card] of Object.entries(cards)) {
      batch[`cards/${cardId}/price`]      = parseInt(card.original_price);
      batch[`cards/${cardId}/stock`]      = parseInt(card.original_stock);
      batch[`cards/${cardId}/lastChange`] = "reset";
    }

    batch["trades"]       = null;
    batch["transactions"] = null;

    await update(ref(database), batch);

    // Show outcome summary in admin
    const outcomeLines = Object.entries(cardOutcomes).map(([cardId, o]) => {
      const card = cards[cardId];
      const emoji = o.outcome === "up" ? "🔺" : "🔻";
      return `${emoji} ${card?.name}: base $${card?.price} → $${o.finalPrice} (roll: ${o.roll})`;
    }).join("\n");

    setStatus("✅ Weekly reset done!", "#00b894");
    alert("✅ Weekly reset complete!\n\nSell outcomes:\n" + outcomeLines);
  } catch (err) {
    setStatus("❌ Reset failed: " + err.message, "#d63031");
  } finally {
    weeklyResetBtn.disabled = false;
  }
}

setInterval(() => {
  countdown--;
  countdownEl.textContent = countdown;
  if (countdown <= 0) updateStockPrices();
}, 1000);

forceStocksBtn.addEventListener("click", updateStockPrices);
weeklyResetBtn.addEventListener("click", weeklyReset);
