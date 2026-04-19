import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, push, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const playerNameEl  = document.getElementById("player-name");
const playerPointsEl = document.getElementById("player-points");
const playerPfpEl   = document.getElementById("player-pfp");
const cardListEl    = document.getElementById("card-list");
const tradeSection  = document.getElementById("trade-section");

const offerItemsEl  = document.getElementById("offer-items");
const wantItemsEl   = document.getElementById("want-items");
const addOfferBtn   = document.getElementById("add-offer-btn");
const addWantBtn    = document.getElementById("add-want-btn");
const sendTradeBtn  = document.getElementById("send-trade-btn");
const tradeTargetName = document.getElementById("trade-target-name");
const tradeIntroEl  = document.getElementById("trade-intro");

const params = new URLSearchParams(window.location.search);
const profileUid = params.get("id");

let currentUser   = null;
let allCards      = {};
let myCards       = {};     // viewer's cards
let theirCards    = {};     // profile owner's cards
let profileData   = null;

// Rows the user has built up in the trade form
// Each entry: { cardId, qty }
let offerRows = [];
let wantRows  = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  if (!profileUid) { playerNameEl.textContent = "Invalid profile link."; return; }

  const [userSnap, profileSnap, cardsSnap] = await Promise.all([
    get(ref(database, "users/" + user.uid)),
    get(ref(database, "users/" + profileUid)),
    get(ref(database, "cards")),
  ]);

  allCards    = cardsSnap.val() || {};
  myCards     = userSnap.val()?.cards || {};
  profileData = profileSnap.val();

  if (!profileData) { playerNameEl.textContent = "User not found."; return; }

  theirCards = profileData.cards || {};
  const theirStocks = profileData.stocks || {};

  // --- Render profile header ---
  playerNameEl.textContent  = profileData.username || "Unknown Player";
  playerPointsEl.textContent = `$${profileData.points || 0}`;
  const pfp = profileData.profilePicture;
  if (pfp && (pfp.startsWith("http://") || pfp.startsWith("https://"))) {
    playerPfpEl.src = pfp;
  }

  // --- Render their card inventory ---
  renderTheirCards();

  // --- Render their stock holdings ---
  renderTheirStocks(theirStocks);

  // --- Show trade form only if viewing someone else's profile ---
  if (profileUid !== currentUser.uid) {
    tradeSection.style.display = "block";
    tradeTargetName.textContent = profileData.username;
    tradeIntroEl.textContent =
      `You can offer cards from your inventory in exchange for cards from ${profileData.username}'s inventory. Both sides can include multiple cards with custom quantities.`;
    addOfferRow();   // start with one blank row each side
    addWantRow();
  }
});

// --- Render their inventory ---
function renderTheirCards() {
  cardListEl.innerHTML = "";
  const entries = Object.entries(theirCards).filter(([, qty]) => parseInt(qty) > 0);

  if (entries.length === 0) {
    cardListEl.innerHTML = "<p style='text-align:center'>This player has no cards yet.</p>";
    return;
  }

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;gap:15px;margin:15px;";

  for (const [id, quantity] of entries) {
    const card = allCards[id];
    if (!card) continue;
    const div = document.createElement("div");
    div.classList.add("card-item");
    const chance  = parseFloat(card.sellChance    || 0.5) * 100;
    const mult    = parseFloat(card.sellMultiplier || 1.5);
    const upPrice = Math.round(parseInt(card.price) * mult);
    div.innerHTML = `
      <img src="${card.image}" alt="${card.name}" class="card-image" />
      <h3>${card.name}</h3>
      <p style="color:#aaa;font-size:0.8em">Tier ${card.tier}</p>
      <p>Qty: <strong>${quantity}</strong></p>
      <p class="card-value">$${parseInt(card.price) * parseInt(quantity)}</p>
      <p class="sell-chance-tag">🎲 ${chance.toFixed(0)}% → $${upPrice}</p>
    `;
    wrap.appendChild(div);
  }
  cardListEl.appendChild(wrap);
}

// --- Render their stock holdings ---
async function renderTheirStocks(userStocks) {
  const el = document.getElementById("their-stock-holdings");
  if (!el) return;
  const entries = Object.entries(userStocks).filter(([, qty]) => parseInt(qty) > 0);
  if (entries.length === 0) { el.innerHTML = "<p>No stocks held.</p>"; return; }

  const stocksSnap = await get(ref(database, "stocks"));
  const allStocks  = stocksSnap.val() || {};
  let html = `<div class="holdings-table">`;
  let total = 0;
  for (const [id, qty] of entries) {
    const stock = allStocks[id];
    if (!stock) continue;
    const val = parseInt(stock.price) * parseInt(qty);
    total += val;
    html += `<div class="stock-holding-row">
      <span class="holding-ticker">${stock.ticker || id}</span>
      <span class="holding-name">${stock.name}</span>
      <span class="holding-qty">${qty} shares</span>
      <span class="holding-price">@ $${stock.price}</span>
      <span class="holding-val"><strong>$${val}</strong></span>
    </div>`;
  }
  html += `<div class="holdings-total">Total: <strong>$${total}</strong></div></div>`;
  el.innerHTML = html;
}

// --- Build a card selector row ---
function makeCardRow(cardPool, defaultCardId, defaultQty, onRemove) {
  const row = document.createElement("div");
  row.classList.add("card-row");

  // Card dropdown
  const sel = document.createElement("select");
  sel.innerHTML = `<option value="">-- choose card --</option>`;
  for (const [cardId, qty] of Object.entries(cardPool)) {
    const card = allCards[cardId];
    if (!card || parseInt(qty) <= 0) continue;
    const opt = document.createElement("option");
    opt.value = cardId;
    opt.textContent = `${card.name} (Tier ${card.tier}) — have ${qty}`;
    if (cardId === defaultCardId) opt.selected = true;
    sel.appendChild(opt);
  }

  // Qty input
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min  = 1;
  qtyInput.value = defaultQty || 1;
  qtyInput.placeholder = "Qty";

  // Remove button
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "✕";
  removeBtn.classList.add("remove-card-btn");
  removeBtn.onclick = onRemove;

  row.appendChild(sel);
  row.appendChild(qtyInput);
  row.appendChild(removeBtn);
  return { row, sel, qtyInput };
}

// --- Offer rows (my cards) ---
function addOfferRow() {
  const entry = { cardId: "", qty: 1, row: null, sel: null, qtyInput: null };
  const { row, sel, qtyInput } = makeCardRow(myCards, "", 1, () => {
    offerRows = offerRows.filter(e => e !== entry);
    row.remove();
  });
  entry.row = row; entry.sel = sel; entry.qtyInput = qtyInput;
  offerRows.push(entry);
  offerItemsEl.appendChild(row);
}

// --- Want rows (their cards) ---
function addWantRow() {
  const entry = { cardId: "", qty: 1, row: null, sel: null, qtyInput: null };
  const { row, sel, qtyInput } = makeCardRow(theirCards, "", 1, () => {
    wantRows = wantRows.filter(e => e !== entry);
    row.remove();
  });
  entry.row = row; entry.sel = sel; entry.qtyInput = qtyInput;
  wantRows.push(entry);
  wantItemsEl.appendChild(row);
}

addOfferBtn.addEventListener("click", addOfferRow);
addWantBtn.addEventListener("click",  addWantRow);

// --- Send trade ---
sendTradeBtn.addEventListener("click", async () => {
  // Collect and validate offer side
  const offerCards = [];
  for (const entry of offerRows) {
    const cardId = entry.sel.value;
    const qty    = parseInt(entry.qtyInput.value);
    if (!cardId) continue;
    if (isNaN(qty) || qty < 1) return alert("Quantity must be at least 1.");
    const maxOwned = parseInt(myCards[cardId] || 0);
    if (qty > maxOwned) {
      return alert(`You only own ${maxOwned}x ${allCards[cardId]?.name}.`);
    }
    offerCards.push({ cardId, qty });
  }

  // Collect and validate want side
  const wantCards = [];
  for (const entry of wantRows) {
    const cardId = entry.sel.value;
    const qty    = parseInt(entry.qtyInput.value);
    if (!cardId) continue;
    if (isNaN(qty) || qty < 1) return alert("Quantity must be at least 1.");
    const maxOwned = parseInt(theirCards[cardId] || 0);
    if (qty > maxOwned) {
      return alert(`${profileData.username} only owns ${maxOwned}x ${allCards[cardId]?.name}.`);
    }
    wantCards.push({ cardId, qty });
  }

  if (offerCards.length === 0) return alert("Add at least one card to offer.");
  if (wantCards.length === 0) return alert("Add at least one card to request.");

  // Merge duplicate cardIds (if user picked same card in two rows)
  const mergeCards = (arr) => {
    const map = {};
    for (const { cardId, qty } of arr) {
      map[cardId] = (map[cardId] || 0) + qty;
    }
    return Object.entries(map).map(([cardId, qty]) => ({ cardId, qty }));
  };

  const merged = {
    fromUid:    currentUser.uid,
    toUid:      profileUid,
    offerCards: mergeCards(offerCards),
    wantCards:  mergeCards(wantCards),
    status:     "pending",
    createdAt:  Date.now(),
  };

  sendTradeBtn.disabled = true;
  sendTradeBtn.textContent = "Sending...";

  try {
    await push(ref(database, "trades"), merged);
    alert(`Trade offer sent to ${profileData.username}!`);

    // Reset form
    offerRows = []; wantRows = [];
    offerItemsEl.innerHTML = ""; wantItemsEl.innerHTML = "";
    addOfferRow(); addWantRow();
  } catch (err) {
    alert("Failed to send trade: " + err.message);
  } finally {
    sendTradeBtn.disabled = false;
    sendTradeBtn.textContent = "Send Trade Offer";
  }
});
