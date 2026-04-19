import { database } from "./firebase.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const profileList = document.getElementById("profile-list");

const usersRef = ref(database, "users");

onValue(usersRef, async (snapshot) => {
  const users = snapshot.val();
  if (!users) {
    profileList.innerHTML = "<p>No current results.</p>";
    return;
  }

  // Also load card prices to calculate net worth
  const cardsSnap = await get(ref(database, "cards"));
  const allCards = cardsSnap.val() || {};

  const userArray = Object.entries(users).map(([uid, data]) => {
    let cardValue = 0;
    const ownedCards = data.cards || {};
    for (const [cardId, qty] of Object.entries(ownedCards)) {
      const cardData = allCards[cardId];
      if (cardData) {
        cardValue += parseInt(cardData.price) * parseInt(qty);
      }
    }
    const netWorth = (data.points || 0) + cardValue;

    return {
      uid,
      name: data.username || "Unknown Player",
      points: data.points || 0,
      cardValue,
      netWorth,
      pfp: data.profilePicture || "images/default-pfp.png",
    };
  });

  // Sort by net worth (cash + card value)
  userArray.sort((a, b) => b.netWorth - a.netWorth);

  profileList.innerHTML = userArray
    .map(
      (u, i) => `
        <div class="profile-card">
          <span class="rank">#${i + 1}</span>
          <img src="${u.pfp}" alt="${u.name}'s picture" class="profile-pic-square">
          <div class="profile-info">
            <a href="profile.html?id=${u.uid}" class="profile-name">${u.name}</a>
            <p class="profile-points">Net worth: $${u.netWorth}</p>
            <p class="profile-breakdown">Cash: $${u.points} &nbsp;|&nbsp; Cards: $${u.cardValue}</p>
          </div>
        </div>
      `
    )
    .join("");
});
