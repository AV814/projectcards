import { database } from "./firebase.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const profileList = document.getElementById("profile-list");

onValue(ref(database, "users"), async (snapshot) => {
  const users = snapshot.val();
  if (!users) { profileList.innerHTML = "<p>No players yet.</p>"; return; }

  const [cardsSnap, stocksSnap] = await Promise.all([
    get(ref(database, "cards")),
    get(ref(database, "stocks")),
  ]);
  const allCards  = cardsSnap.val()  || {};
  const allStocks = stocksSnap.val() || {};

  const userArray = Object.entries(users).map(([uid, data]) => {
    let cardValue = 0, stockValue = 0;
    for (const [id, qty] of Object.entries(data.cards  || {})) {
      if (allCards[id])  cardValue  += parseInt(allCards[id].price)  * parseInt(qty);
    }
    for (const [id, qty] of Object.entries(data.stocks || {})) {
      if (allStocks[id]) stockValue += parseInt(allStocks[id].price) * parseInt(qty);
    }
    return {
      uid,
      name:       data.username || "Unknown Player",
      cash:       data.points   || 0,
      cardValue,
      stockValue,
      netWorth:   (data.points || 0) + cardValue + stockValue,
      pfp:        data.profilePicture || "",
      cards:      data.cards  || {},
      stocks:     data.stocks || {},
    };
  });

  userArray.sort((a, b) => b.netWorth - a.netWorth);

  profileList.innerHTML = "";

  userArray.forEach((u, i) => {
    const rankLabel = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

    // Build card previews (up to 4)
    const cardEntries = Object.entries(u.cards).filter(([, qty]) => parseInt(qty) > 0);
    const cardPreviews = cardEntries.slice(0, 4).map(([cardId, qty]) => {
      const card = allCards[cardId];
      if (!card) return "";
      return `<div class="lb-card-chip">
        <img src="${card.image}" class="lb-card-img" />
        <span class="lb-card-qty">x${qty}</span>
      </div>`;
    }).join("");
    const moreCards = cardEntries.length > 4
      ? `<span class="lb-more">+${cardEntries.length - 4} more</span>` : "";

    const div = document.createElement("div");
    div.classList.add("lb-profile-card");
    div.innerHTML = `
      <div class="lb-header">
        <span class="lb-rank">${rankLabel}</span>
        ${u.pfp
          ? `<img src="${u.pfp}" class="lb-pfp" onerror="this.style.display='none'" />`
          : `<div class="lb-pfp lb-pfp-placeholder"></div>`}
        <div class="lb-header-info">
          <a href="profile.html?id=${u.uid}" class="lb-name">${u.name}</a>
          <p class="lb-networth">Net worth: <strong>$${u.netWorth.toLocaleString()}</strong></p>
          <p class="lb-breakdown">
            💰 $${u.cash.toLocaleString()} cash &nbsp;
            🃏 $${u.cardValue.toLocaleString()} cards &nbsp;
            📈 $${u.stockValue.toLocaleString()} stocks
          </p>
        </div>
      </div>
      ${cardEntries.length > 0 ? `
        <div class="lb-cards-row">
          ${cardPreviews}${moreCards}
        </div>` : ""}
    `;
    profileList.appendChild(div);
  });
});
