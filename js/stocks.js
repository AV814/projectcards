import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, onValue, off, runTransaction, push } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo = document.getElementById("user-info");
const stockContainer = document.getElementById("stock-container");

let currentUser = null;
let currentPoints = 0;
let currentUserStocks = {};
let stocksListener = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  const snap = await get(ref(database, "users/" + user.uid));
  const userData = snap.val();
  if (!userData) return;
  currentPoints = userData.points;
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
    const snap = await get(ref(database, "users/" + uid));
    const userData = snap.val();
    currentUserStocks = userData.stocks || {};
    currentPoints = userData.points;
    userInfo.textContent = `Balance: $${currentPoints}`;
    renderStocks(stocks, uid);
  });
}

function renderStocks(stocks, uid) {
  stockContainer.innerHTML = "";
  for (const [id, data] of Object.entries(stocks)) {
    const owned = currentUserStocks[id] || 0;
    const price = parseInt(data.price);
    const indicator = data.lastChange === "up" ? "🔺" : data.lastChange === "down" ? "🔻" : "";
    const indicatorClass = data.lastChange === "up" ? "up" : data.lastChange === "down" ? "down" : "";
    const minPrice = Math.max(Math.floor(parseInt(data.original_price) * 0.4), 1);
    const maxPrice = Math.ceil(parseInt(data.original_price) * 2.5);
    const cantAfford = currentPoints < price;

    const div = document.createElement("div");
    div.classList.add("stock-item");
    div.innerHTML = `
      <div class="stock-ticker">${data.ticker || id.toUpperCase()}</div>
      <div class="stock-name">${data.name}</div>
      <div class="stock-price ${indicatorClass}">$${price} ${indicator}</div>
      <div class="stock-range">Range: $${minPrice} – $${maxPrice}</div>
      <div class="stock-owned">You own: <strong>${owned}</strong> share${owned !== 1 ? "s" : ""}</div>
      <div class="stock-value">${owned > 0 ? `Value: $${owned * price}` : ""}</div>
      <div class="stock-buttons">
        <button class="buy-stock-btn" data-id="${id}" ${cantAfford ? "disabled" : ""}>
          ${cantAfford ? "Can't afford" : "Buy $" + price}
        </button>
        <button class="sell-stock-btn" data-id="${id}" ${owned <= 0 ? "disabled" : ""}>
          ${owned <= 0 ? "None owned" : "Sell $" + price}
        </button>
      </div>
    `;
    stockContainer.appendChild(div);
  }

  document.querySelectorAll(".buy-stock-btn").forEach(btn => {
    btn.onclick = () => buyStock(uid, btn.dataset.id);
  });
  document.querySelectorAll(".sell-stock-btn").forEach(btn => {
    btn.onclick = () => sellStock(uid, btn.dataset.id);
  });
}

async function buyStock(uid, stockId) {
  const userRef = ref(database, "users/" + uid);
  const stockRef = ref(database, "stocks/" + stockId);
  const [userSnap, stockSnap] = await Promise.all([get(userRef), get(stockRef)]);
  const userData = userSnap.val();
  const stockData = stockSnap.val();
  if (!stockData) return alert("Stock not found.");
  const price = parseInt(stockData.price);
  if (userData.points < price) return alert("Not enough funds!");

  await runTransaction(userRef, (user) => {
    if (!user || user.points < price) return;
    user.points -= price;
    if (!user.stocks) user.stocks = {};
    user.stocks[stockId] = (user.stocks[stockId] || 0) + 1;
    return user;
  });
  await push(ref(database, "transactions"), { stockId, action: "buy" });
}

async function sellStock(uid, stockId) {
  const userRef = ref(database, "users/" + uid);
  const stockRef = ref(database, "stocks/" + stockId);
  const [userSnap, stockSnap] = await Promise.all([get(userRef), get(stockRef)]);
  const userData = userSnap.val();
  const stockData = stockSnap.val();
  if (!stockData) return alert("Stock not found.");
  const owned = parseInt(userData.stocks?.[stockId] || 0);
  if (owned <= 0) return alert("You don't own any shares of this stock!");
  const price = parseInt(stockData.price);

  await runTransaction(userRef, (user) => {
    if (!user || !user.stocks || !user.stocks[stockId]) return;
    user.points += price;
    user.stocks[stockId] -= 1;
    if (user.stocks[stockId] <= 0) delete user.stocks[stockId];
    return user;
  });
  await push(ref(database, "transactions"), { stockId, action: "sell" });
}
