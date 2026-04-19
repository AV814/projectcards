import { auth, database, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { ref as dbRef, get, onValue, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const userInfo = document.getElementById("user-info");
const cardContainer = document.getElementById("card-container");
const logoutBtn = document.getElementById("logout");
const changePfpBtn = document.getElementById("change-pfp");
const uploadPfpInput = document.getElementById("upload-pfp");
const profilePic = document.getElementById("profile-pic");
const weeklyReportEl = document.getElementById("weekly-report");

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  const userRef = dbRef(database, "users/" + user.uid);

  let userSnap = null;
  for (let i = 0; i < 5; i++) {
    userSnap = await get(userRef);
    if (userSnap.exists()) break;
    await new Promise(res => setTimeout(res, 800));
  }
  if (!userSnap.exists()) {
    alert("Account data not found. Please sign up again.");
    await signOut(auth);
    window.location.href = "index.html";
    return;
  }

  const userData = userSnap.val();
  profilePic.src = userData.profilePicture || "";

  const cardsRef = dbRef(database, "cards");

  // Live updates
  onValue(userRef, (snap) => {
    const u = snap.val();
    if (!u) return;
    userInfo.innerHTML = `${u.username}<br><span class="points">$${u.points}</span>`;
    get(cardsRef).then(cs => {
      renderCards(u.cards || {}, cs.val() || {});
      renderStockHoldings(u.stocks || {});
    });
    renderWeeklyReport(u.lastWeeklyReport);
  });
});

function renderCards(userCards, allCards) {
  cardContainer.innerHTML = "";
  const entries = Object.entries(userCards).filter(([, qty]) => parseInt(qty) > 0);
  if (entries.length === 0) {
    cardContainer.innerHTML = "<p>No cards yet — open some loot boxes!</p>";
    return;
  }
  let total = 0;
  for (const [id, qty] of entries) {
    const card = allCards[id];
    if (!card) continue;
    const val = parseInt(card.price) * parseInt(qty);
    total += val;
    const div = document.createElement("div");
    div.classList.add("card-item");
    div.innerHTML = `
      <img src="${card.image}" alt="${card.name}" class="card-image" />
      <h3>${card.name}</h3>
      <p style="color:#aaa;font-size:0.8em">Tier ${card.tier}</p>
      <p>Qty: <strong>${qty}</strong></p>
      <p class="card-value">$${val}</p>
    `;
    cardContainer.appendChild(div);
  }
  const totalEl = document.getElementById("total-card-value");
  if (totalEl) totalEl.textContent = `Cards value: $${total}`;
}

function renderStockHoldings(userStocks) {
  const el = document.getElementById("stock-holdings");
  if (!el) return;
  const entries = Object.entries(userStocks).filter(([, qty]) => parseInt(qty) > 0);
  if (entries.length === 0) { el.innerHTML = "<p>No stocks held.</p>"; return; }

  get(dbRef(database, "stocks")).then(snap => {
    const allStocks = snap.val() || {};
    let html = "";
    let total = 0;
    for (const [id, qty] of entries) {
      const stock = allStocks[id];
      if (!stock) continue;
      const val = parseInt(stock.price) * parseInt(qty);
      total += val;
      html += `<div class="stock-holding-row">
        <span>${stock.ticker || id} — ${stock.name}</span>
        <span>${qty} shares @ $${stock.price} = <strong>$${val}</strong></span>
      </div>`;
    }
    el.innerHTML = html + `<p class="card-value">Stocks value: $${total}</p>`;
  });
}

function renderWeeklyReport(report) {
  if (!weeklyReportEl) return;
  if (!report || !report.lines || report.lines.length === 0) {
    weeklyReportEl.innerHTML = "<p>No weekly report yet.</p>";
    return;
  }
  let rows = report.lines.map(l =>
    `<tr><td>${l.name}</td><td>${l.qty}</td><td>$${l.priceEach}</td><td>$${l.total}</td></tr>`
  ).join("");
  weeklyReportEl.innerHTML = `
    <p>Week of <strong>${report.week}</strong> — Total earned: <strong style="color:#00b894">$${report.earnings}</strong></p>
    <table class="report-table">
      <thead><tr><th>Card</th><th>Qty</th><th>Price Each</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Profile picture upload
changePfpBtn.addEventListener("click", () => uploadPfpInput.click());
uploadPfpInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  if (!file.type.startsWith("image/")) return alert("Please select an image file.");
  const ext = file.name.split(".").pop().toLowerCase();
  const fileRef = storageRef(storage, `profile_pictures/${currentUser.uid}.${ext}`);
  changePfpBtn.disabled = true;
  changePfpBtn.textContent = "Uploading...";
  try {
    await uploadBytes(fileRef, file, { contentType: file.type });
    const url = await getDownloadURL(fileRef);
    await update(dbRef(database, "users/" + currentUser.uid), { profilePicture: url });
    profilePic.src = url;
    alert("Profile picture updated!");
  } catch (err) {
    alert(err.code === "storage/unauthorized"
      ? "Blocked by Firebase Storage rules. Allow writes in Firebase Console → Storage → Rules."
      : "Upload failed: " + err.message);
  } finally {
    changePfpBtn.disabled = false;
    changePfpBtn.textContent = "PFP Upload";
  }
});

logoutBtn.addEventListener("click", () => signOut(auth).then(() => window.location.href = "index.html"));
