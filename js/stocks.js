import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, onValue, off, runTransaction, push } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo       = document.getElementById("user-info");
const stockContainer = document.getElementById("stock-container");

// --- Modal elements (injected into page) ---
const modalHTML = `
<div id="stock-modal" style="display:none">
  <div id="stock-modal-inner">
    <h3 id="modal-title"></h3>
    <p id="modal-subtitle"></p>
    <div id="modal-body">
      <label id="modal-qty-label">Quantity:</label>
      <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin:10px 0">
        <button id="modal-qty-down">−</button>
        <input id="modal-qty" type="number" min="1" value="1" />
        <button id="modal-qty-up">+</button>
      </div>
      <p id="modal-total"></p>
    </div>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:15px">
      <button id="modal-confirm">Confirm</button>
      <button id="modal-sell-all" style="display:none">Sell All</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  </div>
</div>`;
document.body.insertAdjacentHTML("beforeend", modalHTML);

const modal        = document.getElementById("stock-modal");
const modalTitle   = document.getElementById("modal-title");
const modalSub     = document.getElementById("modal-subtitle");
const modalQty     = document.getElementById("modal-qty");
const modalTotal   = document.getElementById("modal-total");
const modalConfirm = document.getElementById("modal-confirm");
const modalSellAll = document.getElementById("modal-sell-all");
const modalCancel  = document.getElementById("modal-cancel");
const modalQtyDown = document.getElementById("modal-qty-down");
const modalQtyUp   = document.getElementById("modal-qty-up");

let currentUser       = null;
let currentPoints     = 0;
let currentUserStocks = {};
let allStocksData     = {};
let stocksListener    = null;
let userListener      = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  // Listen to user node directly so quantity updates instantly after buy/sell
  if (userListener) off(ref(database, "users/" + user.uid), "value", userListener);
  userListener = onValue(ref(database, "users/" + user.uid), (snap) => {
    const userData = snap.val();
    if (!userData) return;
    currentPoints     = userData.points;
    currentUserStocks = userData.stocks || {};
    userInfo.textContent = `Balance: $${currentPoints}`;
    if (Object.keys(allStocksData).length > 0) renderStocks(allStocksData, user.uid);
  });

  loadStocks(user.uid);
});

function loadStocks(uid) {
  const stocksRef = ref(database, "stocks");
  if (stocksListener) off(stocksRef, "value", stocksListener);
  stocksListener = onValue(stocksRef, (snapshot) => {
    const stocks = snapshot.val();
    if (!stocks) { stockContainer.innerHTML = "<p>No stocks available.</p>"; return; }
    allStocksData = stocks;
    renderStocks(stocks, uid);
  });
}

function renderStocks(stocks, uid) {
  stockContainer.innerHTML = "";
  for (const [id, data] of Object.entries(stocks)) {
    const owned      = parseInt(currentUserStocks[id] || 0);
    const price      = parseInt(data.price);
    const indicator  = data.lastChange === "up" ? "🔺" : data.lastChange === "down" ? "🔻" : "";
    const indClass   = data.lastChange === "up" ? "up"  : data.lastChange === "down" ? "down" : "";
    const minPrice   = Math.max(Math.floor(parseInt(data.original_price) * 0.4), 1);
    const maxPrice   = Math.ceil(parseInt(data.original_price) * 2.5);
    const cantAfford = currentPoints < price;

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
        <button class="buy-stock-btn" data-id="${id}" data-price="${price}" data-name="${data.name}" ${cantAfford ? "disabled" : ""}>
          ${cantAfford ? "Can't afford" : "Buy"}
        </button>
        <button class="sell-stock-btn" data-id="${id}" data-price="${price}" data-name="${data.name}" data-owned="${owned}" ${owned <= 0 ? "disabled" : ""}>
          ${owned <= 0 ? "None owned" : "Sell"}
        </button>
      </div>
    `;
    stockContainer.appendChild(div);
  }

  document.querySelectorAll(".buy-stock-btn").forEach(btn => {
    btn.onclick = () => openBuyModal(uid, btn.dataset.id, parseInt(btn.dataset.price), btn.dataset.name);
  });
  document.querySelectorAll(".sell-stock-btn").forEach(btn => {
    btn.onclick = () => openSellModal(uid, btn.dataset.id, parseInt(btn.dataset.price), btn.dataset.name, parseInt(btn.dataset.owned));
  });
}

// --- Modal helpers ---
function updateModalTotal(price, isBuy) {
  const qty = Math.max(1, parseInt(modalQty.value) || 1);
  const total = qty * price;
  if (isBuy) {
    const after = currentPoints - total;
    modalTotal.textContent = `Total cost: $${total} → Balance after: $${after}`;
    modalTotal.style.color = after < 0 ? "#d63031" : "#aaa";
  } else {
    modalTotal.textContent = `Total return: $${total}`;
    modalTotal.style.color = "#00b894";
  }
}

function openBuyModal(uid, stockId, price, name) {
  const maxAffordable = Math.floor(currentPoints / price);
  modalTitle.textContent = `Buy ${name}`;
  modalSub.textContent = `$${price} per share — you can afford up to ${maxAffordable}`;
  modalQty.value = 1;
  modalQty.max = maxAffordable;
  modalSellAll.style.display = "none";
  modalConfirm.textContent = "Buy";
  modalConfirm.style.background = "#2d6a4f";
  updateModalTotal(price, true);

  modalQty.oninput = () => updateModalTotal(price, true);
  modalQtyDown.onclick = () => { modalQty.value = Math.max(1, parseInt(modalQty.value) - 1); updateModalTotal(price, true); };
  modalQtyUp.onclick   = () => { modalQty.value = Math.min(maxAffordable, parseInt(modalQty.value) + 1); updateModalTotal(price, true); };

  modalConfirm.onclick = async () => {
    const qty = Math.max(1, parseInt(modalQty.value) || 1);
    closeModal();
    await buyStock(uid, stockId, price, qty);
  };

  modal.style.display = "flex";
}

function openSellModal(uid, stockId, price, name, owned) {
  modalTitle.textContent = `Sell ${name}`;
  modalSub.textContent = `$${price} per share — you own ${owned}`;
  modalQty.value = 1;
  modalQty.max = owned;
  modalSellAll.style.display = "inline-block";
  modalConfirm.textContent = "Sell";
  modalConfirm.style.background = "#613535";
  updateModalTotal(price, false);

  modalQty.oninput = () => updateModalTotal(price, false);
  modalQtyDown.onclick = () => { modalQty.value = Math.max(1, parseInt(modalQty.value) - 1); updateModalTotal(price, false); };
  modalQtyUp.onclick   = () => { modalQty.value = Math.min(owned, parseInt(modalQty.value) + 1); updateModalTotal(price, false); };

  modalConfirm.onclick = async () => {
    const qty = Math.max(1, Math.min(owned, parseInt(modalQty.value) || 1));
    closeModal();
    await sellStock(uid, stockId, price, qty);
  };

  modalSellAll.onclick = async () => {
    closeModal();
    await sellStock(uid, stockId, price, owned);
  };

  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
  modalConfirm.onclick = null;
  modalSellAll.onclick = null;
}

modalCancel.onclick = closeModal;
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

// --- BUY ---
async function buyStock(uid, stockId, price, qty) {
  const userRef  = ref(database, "users/" + uid);
  const totalCost = price * qty;

  const userSnap = await get(userRef);
  const userData = userSnap.val();
  if (!userData) return alert("Could not load your account.");
  if (userData.points < totalCost) return alert(`Not enough funds! Need $${totalCost}, have $${userData.points}.`);

  try {
    await runTransaction(userRef, (user) => {
      if (!user) return user;
      if (user.points < totalCost) return;
      user.points -= totalCost;
      if (!user.stocks) user.stocks = {};
      user.stocks[stockId] = (parseInt(user.stocks[stockId]) || 0) + qty;
      return user;
    });
    for (let i = 0; i < qty; i++) {
      await push(ref(database, "transactions"), { stockId, action: "buy" });
    }
  } catch (err) {
    console.error("Buy stock failed:", err);
    alert("Purchase failed: " + err.message);
  }
}

// --- SELL ---
async function sellStock(uid, stockId, price, qty) {
  const userRef     = ref(database, "users/" + uid);
  const totalReturn = price * qty;

  const userSnap = await get(userRef);
  const userData = userSnap.val();
  if (!userData) return alert("Could not load your account.");
  const owned = parseInt(userData.stocks?.[stockId] || 0);
  if (owned < qty) return alert(`You only own ${owned} shares.`);

  try {
    await runTransaction(userRef, (user) => {
      if (!user) return user;
      const cur = parseInt(user.stocks?.[stockId] || 0);
      if (cur < qty) return;
      user.points += totalReturn;
      user.stocks[stockId] = cur - qty;
      if (user.stocks[stockId] <= 0) delete user.stocks[stockId];
      return user;
    });
    for (let i = 0; i < qty; i++) {
      await push(ref(database, "transactions"), { stockId, action: "sell" });
    }
  } catch (err) {
    console.error("Sell stock failed:", err);
    alert("Sale failed: " + err.message);
  }
}
