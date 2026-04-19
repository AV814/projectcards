import { auth, database } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref, get, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const userInfo = document.getElementById("user-info");
const lootboxContainer = document.getElementById("lootbox-container");
const resultModal = document.getElementById("result-modal");
const resultCards = document.getElementById("result-cards");
const closeModalBtn = document.getElementById("close-modal");

// Loot box definitions — price and card qty range per tier pulled from
const LOOTBOX_TYPES = [
  { id: "bronze",  label: "Bronze Box",  price: 100, color: "#cd7f32", tiers: [1],    minCards: 3, maxCards: 7, desc: "Contains Tier 1 cards (3–7 cards)" },
  { id: "silver",  label: "Silver Box",  price: 250, color: "#aaa",    tiers: [1,2],  minCards: 2, maxCards: 5, desc: "Contains Tier 1–2 cards (2–5 cards)" },
  { id: "gold",    label: "Gold Box",    price: 500, color: "#ffd700", tiers: [2,3],  minCards: 2, maxCards: 4, desc: "Contains Tier 2–3 cards (2–4 cards)" },
  { id: "diamond", label: "Diamond Box", price: 1000, color: "#74b9ff", tiers: [3,4], minCards: 1, maxCards: 3, desc: "Contains Tier 3–4 cards (1–3 cards)" },
  { id: "legend",  label: "Legend Box",  price: 2500, color: "#fd79a8", tiers: [4,5], minCards: 1, maxCards: 2, desc: "Contains Tier 4–5 cards (1–2 cards)" },
];

let currentUser = null;
let currentPoints = 0;
let allCards = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  // Load cards pool
  const cardsSnap = await get(ref(database, "cards"));
  allCards = cardsSnap.val() || {};

  const userRef = ref(database, "users/" + user.uid);
  onValue(userRef, (snap) => {
    const userData = snap.val();
    if (!userData) return;
    currentPoints = userData.points;
    userInfo.textContent = `Balance: $${currentPoints}`;
    renderLootboxes();
  });
});

function renderLootboxes() {
  lootboxContainer.innerHTML = "";
  for (const box of LOOTBOX_TYPES) {
    const canAfford = currentPoints >= box.price;
    const div = document.createElement("div");
    div.classList.add("lootbox-item");
    div.style.borderColor = box.color;
    div.innerHTML = `
      <div class="lootbox-icon" style="color:${box.color}">📦</div>
      <h3 style="color:${box.color}">${box.label}</h3>
      <p class="lootbox-desc">${box.desc}</p>
      <p class="lootbox-price">Cost: <strong>$${box.price}</strong></p>
      <button class="open-box-btn" data-box="${box.id}" ${canAfford ? "" : "disabled"}>
        ${canAfford ? "Open Box" : "Can't afford"}
      </button>
    `;
    lootboxContainer.appendChild(div);
  }
  document.querySelectorAll(".open-box-btn").forEach(btn => {
    btn.onclick = () => openLootbox(btn.dataset.box);
  });
}

async function openLootbox(boxId) {
  const box = LOOTBOX_TYPES.find(b => b.id === boxId);
  if (!box) return;
  if (currentPoints < box.price) return alert("Not enough funds!");

  const userRef = ref(database, "users/" + currentUser.uid);

  // Get eligible cards by tier
  const eligible = Object.entries(allCards).filter(([id, card]) =>
    box.tiers.includes(parseInt(card.tier))
  );

  if (eligible.length === 0) {
    return alert("No cards available for this box tier. Ask admin to add cards.");
  }

  // Roll how many cards to give
  const qty = box.minCards + Math.floor(Math.random() * (box.maxCards - box.minCards + 1));

  // Pick random cards (can repeat, just like real loot boxes)
  const pulled = [];
  for (let i = 0; i < qty; i++) {
    const [cardId, cardData] = eligible[Math.floor(Math.random() * eligible.length)];
    pulled.push({ cardId, cardData });
  }

  // Deduct cost and add cards atomically
  let success = false;
  await runTransaction(userRef, (user) => {
    if (!user || user.points < box.price) return;
    user.points -= box.price;
    if (!user.cards) user.cards = {};
    for (const { cardId } of pulled) {
      user.cards[cardId] = (user.cards[cardId] || 0) + 1;
    }
    success = true;
    return user;
  });

  if (!success) return alert("Transaction failed. Please try again.");

  // Show result modal
  showResults(box, pulled);
}

function showResults(box, pulled) {
  resultCards.innerHTML = "";

  // Count duplicates for display
  const counts = {};
  for (const { cardId, cardData } of pulled) {
    if (!counts[cardId]) counts[cardId] = { cardData, count: 0 };
    counts[cardId].count++;
  }

  for (const { cardData, count } of Object.values(counts)) {
    const div = document.createElement("div");
    div.classList.add("result-card");
    const chance   = parseFloat(cardData.sellChance    || 0.5) * 100;
    const mult     = parseFloat(cardData.sellMultiplier || 1.5);
    const upPrice  = Math.round(parseInt(cardData.price) * mult);
    div.innerHTML = `
      <img src="${cardData.image}" alt="${cardData.name}" class="card-image" />
      <p><strong>${cardData.name}</strong></p>
      <p style="color:#aaa;font-size:0.8em">Tier ${cardData.tier}</p>
      ${count > 1 ? `<p style="color:#fdcb6e">x${count}</p>` : ""}
      <p class="sell-chance-tag">🎲 ${chance.toFixed(0)}% → $${upPrice}</p>
    `;
    resultCards.appendChild(div);
  }

  document.getElementById("result-title").textContent =
    `You opened a ${box.label} and got ${pulled.length} card${pulled.length !== 1 ? "s" : ""}!`;
  resultModal.style.display = "flex";
}

closeModalBtn.addEventListener("click", () => {
  resultModal.style.display = "none";
});

resultModal.addEventListener("click", (e) => {
  if (e.target === resultModal) resultModal.style.display = "none";
});
