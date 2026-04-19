import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
ref, get, onValue, off, runTransaction, push
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo = document.getElementById("user-info");
const cardContainer = document.getElementById("card-container");

let currentUser = null;
let currentPoints = 0;
let currentUserCards = {};
let cardsListener = null;

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

function loadStore(uid) {
const cardsRef = ref(database, "cards");
if (cardsListener) off(cardsRef, "value", cardsListener);

cardsListener = onValue(cardsRef, async (snapshot) => {
const cards = snapshot.val();
if (!cards) return;
const userSnap = await get(ref(database, "users/" + uid));
const userData = userSnap.val();
currentUserCards = userData.cards || {};
currentPoints = userData.points;
userInfo.textContent = `Balance: $${currentPoints}`;
renderStore(cards, uid);
});
}

function renderStore(cards, uid) {
cardContainer.innerHTML = "";

for (const [id, data] of Object.entries(cards)) {
const div = document.createElement("div");
div.classList.add("card-item");

const indicator = data.lastChange === "up" ? "🔺" : data.lastChange === "down" ? "🔻" : "";
const indicatorClass = data.lastChange === "up" ? "up" : data.lastChange === "down" ? "down" : "";
const ownedCount = currentUserCards[id] || 0;
const price = parseInt(data.price);
const sellPrice = price;
const outOfStock = parseInt(data.stock) <= 0;
const cantAfford = currentPoints < price;

div.innerHTML = `
     <h3>${data.name}</h3>
     <img src="${data.image}" alt="${data.name}" class="card-image" />
     <p class="${indicatorClass}">Price: $${price} ${indicator}</p>
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

// --- BUY ---
async function buyCard(uid, cardId) {
const userRef = ref(database, "users/" + uid);
const cardRef = ref(database, "cards/" + cardId);

try {
// Read current state first — don't rely on transaction retry state
const [userSnap, cardSnap] = await Promise.all([get(userRef), get(cardRef)]);
const userData = userSnap.val();
const cardData = cardSnap.val();

if (!cardData) return alert("Card not found.");
if (parseInt(cardData.stock) <= 0) return alert("Sorry, that card is out of stock!");
if (userData.points < parseInt(cardData.price)) return alert("Not enough funds!");

const price = parseInt(cardData.price);

// Deduct points and add card to user — single atomic transaction
await runTransaction(userRef, (user) => {
if (!user) return user;
if (user.points < price) return; // abort if somehow still not enough
user.points -= price;
if (!user.cards) user.cards = {};
user.cards[cardId] = (user.cards[cardId] || 0) + 1;
return user;
});

// Decrement stock
await runTransaction(cardRef, (card) => {
if (!card) return card;
if (card.stock > 0) card.stock -= 1;
return card;
});

await push(ref(database, "transactions"), { cardId, action: "buy" });

} catch (err) {
console.error("Buy failed:", err);
alert("Purchase failed. Please try again.");
}
}

// --- SELL ---
async function sellCard(uid, cardId) {
const userRef = ref(database, "users/" + uid);
const cardRef = ref(database, "cards/" + cardId);

try {
const [userSnap, cardSnap] = await Promise.all([get(userRef), get(cardRef)]);
const userData = userSnap.val();
const cardData = cardSnap.val();

if (!cardData) return alert("Card not found.");

// Log exactly what we see so we can debug key mismatches
console.log("Sell attempt — cardId:", cardId);
console.log("User cards in DB:", userData.cards);

const ownedQty = parseInt(userData.cards?.[cardId] || 0);
console.log("Owned qty for this cardId:", ownedQty);

if (ownedQty <= 0) {
// Also check if cards are stored by name instead of ID (old data)
const cardName = cardData.name;
const ownedByName = parseInt(userData.cards?.[cardName] || 0);
console.log("Owned qty by card name fallback:", ownedByName);

if (ownedByName <= 0) {
return alert("You don\'t own that card!\n\nDebug: cardId=" + cardId + "\nYour cards: " + JSON.stringify(userData.cards));
}

// Cards stored by name — sell using name key
const sellPrice = parseInt(cardData.price);
await runTransaction(userRef, (user) => {
if (!user) return user;
if (!user.cards || !user.cards[cardName]) return;
user.points += sellPrice;
user.cards[cardName] -= 1;
if (user.cards[cardName] <= 0) delete user.cards[cardName];
return user;
});
await runTransaction(cardRef, (card) => {
if (!card) return card;
card.stock += 1;
return card;
});
await push(ref(database, "transactions"), { cardId, action: "sell" });
return;
}

const sellPrice = parseInt(cardData.price);

await runTransaction(userRef, (user) => {
if (!user) return user;
const qty = parseInt(user.cards?.[cardId] || 0);
if (qty <= 0) return;
user.points += sellPrice;
user.cards[cardId] = qty - 1;
if (user.cards[cardId] <= 0) delete user.cards[cardId];
return user;
});

await runTransaction(cardRef, (card) => {
if (!card) return card;
card.stock += 1;
return card;
});

await push(ref(database, "transactions"), { cardId, action: "sell" });

} catch (err) {
console.error("Sell failed:", err);
alert("Sale failed. Please try again.");
}
}
