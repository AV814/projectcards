import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, onValue, push, update, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo = document.getElementById("user-info");
const myCardsEl = document.getElementById("my-cards");
const incomingEl = document.getElementById("incoming-trades");
const outgoingEl = document.getElementById("outgoing-trades");
const newTradeForm = document.getElementById("new-trade-form");
const offerCardSel = document.getElementById("offer-card");
const wantCardSel = document.getElementById("want-card");
const targetPlayerSel = document.getElementById("target-player");

let currentUser = null;
let allCards = {};
let allUsers = {};
let myCards = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  const [cardsSnap, usersSnap] = await Promise.all([
    get(ref(database, "cards")),
    get(ref(database, "users")),
  ]);
  allCards = cardsSnap.val() || {};
  allUsers = usersSnap.val() || {};

  // Live-listen to user data
  onValue(ref(database, "users/" + user.uid), (snap) => {
    const userData = snap.val();
    if (!userData) return;
    myCards = userData.cards || {};
    userInfo.textContent = `Balance: $${userData.points}`;
    renderMyCards();
    populateTradeForm();
  });

  // Live-listen to trades
  onValue(ref(database, "trades"), () => loadTrades());
});

function renderMyCards() {
  myCardsEl.innerHTML = "";
  const entries = Object.entries(myCards).filter(([, qty]) => parseInt(qty) > 0);
  if (entries.length === 0) {
    myCardsEl.innerHTML = "<p>You have no cards. Open some loot boxes!</p>";
    return;
  }
  for (const [cardId, qty] of entries) {
    const card = allCards[cardId];
    if (!card) continue;
    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <img src="${card.image}" alt="${card.name}" class="card-image" />
      <p><strong>${card.name}</strong></p>
      <p style="color:#aaa;font-size:0.8em">Tier ${card.tier}</p>
      <p>Qty: ${qty}</p>
    `;
    myCardsEl.appendChild(div);
  }
}

function populateTradeForm() {
  // My cards I can offer
  offerCardSel.innerHTML = `<option value="">-- Select a card to offer --</option>`;
  for (const [cardId, qty] of Object.entries(myCards)) {
    if (parseInt(qty) <= 0) continue;
    const card = allCards[cardId];
    if (!card) continue;
    offerCardSel.innerHTML += `<option value="${cardId}">${card.name} (Tier ${card.tier}) — you have ${qty}</option>`;
  }

  // All cards that exist (what they might want)
  wantCardSel.innerHTML = `<option value="">-- Select a card to request --</option>`;
  for (const [cardId, card] of Object.entries(allCards)) {
    wantCardSel.innerHTML += `<option value="${cardId}">${card.name} (Tier ${card.tier})</option>`;
  }

  // Other players
  targetPlayerSel.innerHTML = `<option value="">-- Select a player --</option>`;
  for (const [uid, userData] of Object.entries(allUsers)) {
    if (uid === currentUser.uid) continue;
    targetPlayerSel.innerHTML += `<option value="${uid}">${userData.username}</option>`;
  }
}

async function loadTrades() {
  const tradesSnap = await get(ref(database, "trades"));
  const trades = tradesSnap.val() || {};

  const incoming = [];
  const outgoing = [];

  for (const [tradeId, trade] of Object.entries(trades)) {
    if (trade.status !== "pending") continue;
    if (trade.toUid === currentUser.uid) incoming.push({ tradeId, ...trade });
    if (trade.fromUid === currentUser.uid) outgoing.push({ tradeId, ...trade });
  }

  renderTrades(incomingEl, incoming, true);
  renderTrades(outgoingEl, outgoing, false);
}

function renderTrades(container, trades, isIncoming) {
  container.innerHTML = "";
  if (trades.length === 0) {
    container.innerHTML = `<p>No ${isIncoming ? "incoming" : "outgoing"} trades.</p>`;
    return;
  }

  for (const trade of trades) {
    const offerCard = allCards[trade.offerCardId];
    const wantCard = allCards[trade.wantCardId];
    const fromUser = allUsers[trade.fromUid];
    const toUser = allUsers[trade.toUid];
    if (!offerCard || !wantCard) continue;

    const div = document.createElement("div");
    div.classList.add("trade-card");
    div.innerHTML = `
      <div class="trade-parties">
        <strong>${fromUser?.username || "Unknown"}</strong> offers
        <span class="trade-card-name">${offerCard.name}</span>
        for <strong>${toUser?.username || "Unknown"}</strong>'s
        <span class="trade-card-name">${wantCard.name}</span>
      </div>
      <div class="trade-imgs">
        <div>
          <img src="${offerCard.image}" class="trade-img" />
          <p>${offerCard.name}</p>
        </div>
        <div class="trade-arrow">⇄</div>
        <div>
          <img src="${wantCard.image}" class="trade-img" />
          <p>${wantCard.name}</p>
        </div>
      </div>
      ${isIncoming ? `
        <div class="trade-actions">
          <button class="accept-btn" data-id="${trade.tradeId}">✅ Accept</button>
          <button class="decline-btn" data-id="${trade.tradeId}">❌ Decline</button>
        </div>
      ` : `
        <button class="cancel-btn" data-id="${trade.tradeId}">Cancel Offer</button>
      `}
    `;
    container.appendChild(div);
  }

  if (isIncoming) {
    container.querySelectorAll(".accept-btn").forEach(btn =>
      btn.onclick = () => acceptTrade(btn.dataset.id));
    container.querySelectorAll(".decline-btn").forEach(btn =>
      btn.onclick = () => declineTrade(btn.dataset.id));
  } else {
    container.querySelectorAll(".cancel-btn").forEach(btn =>
      btn.onclick = () => cancelTrade(btn.dataset.id));
  }
}

// Submit new trade offer
newTradeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const offerCardId = offerCardSel.value;
  const wantCardId = wantCardSel.value;
  const toUid = targetPlayerSel.value;

  if (!offerCardId || !wantCardId || !toUid) return alert("Please fill out all fields.");
  if (offerCardId === wantCardId) return alert("You can't trade a card for itself.");

  // Check you still own the offered card
  const myQty = parseInt(myCards[offerCardId] || 0);
  if (myQty <= 0) return alert("You don't own that card anymore.");

  // Check target player owns the wanted card
  const targetUser = allUsers[toUid];
  const targetQty = parseInt(targetUser?.cards?.[wantCardId] || 0);
  if (targetQty <= 0) {
    return alert(`${targetUser?.username || "That player"} doesn't own ${allCards[wantCardId]?.name}.`);
  }

  await push(ref(database, "trades"), {
    fromUid: currentUser.uid,
    toUid,
    offerCardId,
    wantCardId,
    status: "pending",
    createdAt: Date.now(),
  });

  alert("Trade offer sent!");
  newTradeForm.reset();
});

async function acceptTrade(tradeId) {
  const tradeSnap = await get(ref(database, "trades/" + tradeId));
  const trade = tradeSnap.val();
  if (!trade || trade.status !== "pending") return alert("Trade is no longer available.");

  const fromRef = ref(database, "users/" + trade.fromUid);
  const toRef = ref(database, "users/" + trade.toUid);
  const [fromSnap, toSnap] = await Promise.all([get(fromRef), get(toRef)]);
  const fromUser = fromSnap.val();
  const toUser = toSnap.val();

  // Verify both parties still own their cards
  if (!fromUser.cards?.[trade.offerCardId] || fromUser.cards[trade.offerCardId] <= 0)
    return alert("The other player no longer has that card.");
  if (!toUser.cards?.[trade.wantCardId] || toUser.cards[trade.wantCardId] <= 0)
    return alert("You no longer have that card.");

  // Swap cards
  const batch = {};
  // From gives offerCard, gets wantCard
  batch[`users/${trade.fromUid}/cards/${trade.offerCardId}`] = (fromUser.cards[trade.offerCardId] || 1) - 1;
  batch[`users/${trade.fromUid}/cards/${trade.wantCardId}`] = (fromUser.cards[trade.wantCardId] || 0) + 1;
  // To gives wantCard, gets offerCard
  batch[`users/${trade.toUid}/cards/${trade.wantCardId}`] = (toUser.cards[trade.wantCardId] || 1) - 1;
  batch[`users/${trade.toUid}/cards/${trade.offerCardId}`] = (toUser.cards[trade.offerCardId] || 0) + 1;
  // Mark trade complete
  batch[`trades/${tradeId}/status`] = "completed";

  await update(ref(database), batch);
  alert("Trade completed!");
  // Refresh allUsers cache
  const usersSnap = await get(ref(database, "users"));
  allUsers = usersSnap.val() || {};
}

async function declineTrade(tradeId) {
  await update(ref(database, "trades/" + tradeId), { status: "declined" });
}

async function cancelTrade(tradeId) {
  await remove(ref(database, "trades/" + tradeId));
}
