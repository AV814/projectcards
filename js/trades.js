// trades.js — handles incoming/outgoing trade offers (view + accept/decline)
// Trade proposing now happens on profile pages directly.
import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, onValue, update, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo     = document.getElementById("user-info");
const incomingEl   = document.getElementById("incoming-trades");
const outgoingEl   = document.getElementById("outgoing-trades");

let currentUser = null;
let allCards    = {};
let allUsers    = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  const [cardsSnap, usersSnap, userSnap] = await Promise.all([
    get(ref(database, "cards")),
    get(ref(database, "users")),
    get(ref(database, "users/" + user.uid)),
  ]);
  allCards  = cardsSnap.val() || {};
  allUsers  = usersSnap.val() || {};
  const userData = userSnap.val();
  if (userData) userInfo.textContent = `Balance: $${userData.points}`;

  onValue(ref(database, "trades"), () => loadTrades());
});

async function loadTrades() {
  const snap = await get(ref(database, "trades"));
  const trades = snap.val() || {};

  const incoming = [], outgoing = [];
  for (const [tradeId, trade] of Object.entries(trades)) {
    if (trade.status !== "pending") continue;
    if (trade.toUid   === currentUser.uid) incoming.push({ tradeId, ...trade });
    if (trade.fromUid === currentUser.uid) outgoing.push({ tradeId, ...trade });
  }

  renderTrades(incomingEl, incoming, true);
  renderTrades(outgoingEl, outgoing, false);
}

function cardListHTML(cards) {
  return cards.map(({ cardId, qty }) => {
    const card = allCards[cardId];
    if (!card) return "";
    return `<div class="trade-card-chip">
      <img src="${card.image}" class="trade-chip-img" />
      <span>${card.name}<br><small>x${qty}</small></span>
    </div>`;
  }).join("");
}

function renderTrades(container, trades, isIncoming) {
  container.innerHTML = "";
  if (trades.length === 0) {
    container.innerHTML = `<p>No ${isIncoming ? "incoming" : "outgoing"} trades.</p>`;
    return;
  }

  for (const trade of trades) {
    const fromUser = allUsers[trade.fromUid];
    const toUser   = allUsers[trade.toUid];
    const offerCards = trade.offerCards || [];
    const wantCards  = trade.wantCards  || [];

    const div = document.createElement("div");
    div.classList.add("trade-card");
    div.innerHTML = `
      <div class="trade-parties">
        <strong>${fromUser?.username || "?"}</strong> offers
        → <strong>${toUser?.username || "?"}</strong>
      </div>
      <div class="trade-sides">
        <div class="trade-side">
          <p class="trade-side-label">Offering:</p>
          <div class="trade-chips">${cardListHTML(offerCards)}</div>
        </div>
        <div class="trade-arrow">⇄</div>
        <div class="trade-side">
          <p class="trade-side-label">Wants:</p>
          <div class="trade-chips">${cardListHTML(wantCards)}</div>
        </div>
      </div>
      <div class="trade-actions">
        ${isIncoming
          ? `<button class="accept-btn" data-id="${trade.tradeId}">✅ Accept</button>
             <button class="decline-btn" data-id="${trade.tradeId}">❌ Decline</button>`
          : `<button class="cancel-btn" data-id="${trade.tradeId}">Cancel</button>`
        }
      </div>
    `;
    container.appendChild(div);
  }

  if (isIncoming) {
    container.querySelectorAll(".accept-btn").forEach(b => b.onclick = () => acceptTrade(b.dataset.id));
    container.querySelectorAll(".decline-btn").forEach(b => b.onclick = () => declineTrade(b.dataset.id));
  } else {
    container.querySelectorAll(".cancel-btn").forEach(b => b.onclick = () => cancelTrade(b.dataset.id));
  }
}

async function acceptTrade(tradeId) {
  const snap = await get(ref(database, "trades/" + tradeId));
  const trade = snap.val();
  if (!trade || trade.status !== "pending") return alert("Trade no longer available.");

  const [fromSnap, toSnap] = await Promise.all([
    get(ref(database, "users/" + trade.fromUid)),
    get(ref(database, "users/" + trade.toUid)),
  ]);
  const fromUser = fromSnap.val();
  const toUser   = toSnap.val();

  // Validate both sides still have the cards
  for (const { cardId, qty } of trade.offerCards || []) {
    const owned = parseInt(fromUser.cards?.[cardId] || 0);
    if (owned < qty) {
      return alert(`${allUsers[trade.fromUid]?.username} no longer has enough ${allCards[cardId]?.name}.`);
    }
  }
  for (const { cardId, qty } of trade.wantCards || []) {
    const owned = parseInt(toUser.cards?.[cardId] || 0);
    if (owned < qty) {
      return alert(`You no longer have enough ${allCards[cardId]?.name}.`);
    }
  }

  const batch = {};

  // From gives offerCards, receives wantCards
  for (const { cardId, qty } of trade.offerCards || []) {
    const cur = parseInt(fromUser.cards?.[cardId] || 0);
    const newQty = cur - qty;
    batch[`users/${trade.fromUid}/cards/${cardId}`] = newQty > 0 ? newQty : null;
  }
  for (const { cardId, qty } of trade.wantCards || []) {
    const cur = parseInt(fromUser.cards?.[cardId] || 0);
    batch[`users/${trade.fromUid}/cards/${cardId}`] = cur + qty;
  }

  // To gives wantCards, receives offerCards
  for (const { cardId, qty } of trade.wantCards || []) {
    const cur = parseInt(toUser.cards?.[cardId] || 0);
    const newQty = cur - qty;
    batch[`users/${trade.toUid}/cards/${cardId}`] = newQty > 0 ? newQty : null;
  }
  for (const { cardId, qty } of trade.offerCards || []) {
    const cur = parseInt(toUser.cards?.[cardId] || 0);
    batch[`users/${trade.toUid}/cards/${cardId}`] = cur + qty;
  }

  batch[`trades/${tradeId}/status`] = "completed";
  await update(ref(database), batch);
  alert("Trade completed!");

  // Refresh local user cache
  const usersSnap = await get(ref(database, "users"));
  allUsers = usersSnap.val() || {};
}

async function declineTrade(tradeId) {
  await update(ref(database, "trades/" + tradeId), { status: "declined" });
}

async function cancelTrade(tradeId) {
  await remove(ref(database, "trades/" + tradeId));
}
