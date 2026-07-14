const state = {
  items: [],
  selectedImage: "",
  candidates: [],
  cravings: new Set(),
  householdId: localStorage.getItem("food-check-household-id") || "HOME",
  householdName: "Home Fridge",
  inventorySearch: "",
  inventoryFilter: "all"
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  tabs: document.querySelectorAll(".tab"),
  goButtons: document.querySelectorAll("[data-go]"),
  views: {
    fridge: document.querySelector("#fridgeView"),
    scan: document.querySelector("#scanView"),
    cook: document.querySelector("#cookView")
  },
  inventoryList: document.querySelector("#inventoryList"),
  itemCount: document.querySelector("#itemCount"),
  fridgeCount: document.querySelector("#fridgeCount"),
  soonCount: document.querySelector("#soonCount"),
  inventorySearch: document.querySelector("#inventorySearch"),
  inventoryFilters: document.querySelector("#inventoryFilters"),
  householdForm: document.querySelector("#householdForm"),
  householdTitle: document.querySelector("#householdTitle"),
  householdCodeInput: document.querySelector("#householdCodeInput"),
  householdNameInput: document.querySelector("#householdNameInput"),
  showAddButton: document.querySelector("#showAddButton"),
  cancelAddButton: document.querySelector("#cancelAddButton"),
  addForm: document.querySelector("#addForm"),
  receiptInput: document.querySelector("#receiptInput"),
  receiptPreview: document.querySelector("#receiptPreview"),
  previewFrame: document.querySelector("#previewFrame"),
  scanButton: document.querySelector("#scanButton"),
  scanNotice: document.querySelector("#scanNotice"),
  reviewPanel: document.querySelector("#reviewPanel"),
  candidateList: document.querySelector("#candidateList"),
  commitScanButton: document.querySelector("#commitScanButton"),
  cravingChips: document.querySelector("#cravingChips"),
  cookForm: document.querySelector("#cookForm"),
  recipeList: document.querySelector("#recipeList"),
  recommendationNotice: document.querySelector("#recommendationNotice"),
  toast: document.querySelector("#toast")
};

init();

function init() {
  bindEvents();
  registerServiceWorker();
  loadHousehold();
  loadInventory();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", loadInventory);
  els.tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  els.goButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));

  els.showAddButton.addEventListener("click", () => {
    els.addForm.classList.remove("hidden");
    els.showAddButton.classList.add("hidden");
    els.addForm.elements.name.focus();
  });

  els.cancelAddButton.addEventListener("click", () => {
    els.addForm.reset();
    els.addForm.classList.add("hidden");
    els.showAddButton.classList.remove("hidden");
  });

  els.addForm.addEventListener("submit", addManualItem);
  els.householdForm.addEventListener("submit", saveHousehold);
  els.inventorySearch.addEventListener("input", () => {
    state.inventorySearch = els.inventorySearch.value.trim().toLowerCase();
    renderInventory();
  });
  els.inventoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.inventoryFilter = button.dataset.filter;
    els.inventoryFilters.querySelectorAll("[data-filter]").forEach((filterButton) => {
      filterButton.classList.toggle("active", filterButton.dataset.filter === state.inventoryFilter);
    });
    renderInventory();
  });
  els.receiptInput.addEventListener("change", handleReceiptFile);
  els.scanButton.addEventListener("click", scanReceipt);
  els.commitScanButton.addEventListener("click", commitScan);
  els.cravingChips.addEventListener("click", toggleCraving);
  els.cookForm.addEventListener("submit", recommendDinner);
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/service-worker.js");
    } catch (error) {
      console.info("Service worker registration skipped.", error);
    }
  }
}

function setView(name) {
  for (const [viewName, view] of Object.entries(els.views)) {
    view.classList.toggle("active", viewName === name);
  }
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "X-Household-Id": state.householdId,
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

async function loadHousehold() {
  try {
    const payload = await api("/api/household");
    state.householdId = payload.householdId || state.householdId;
    state.householdName = payload.householdName || "Home Fridge";
    localStorage.setItem("food-check-household-id", state.householdId);
    renderHousehold();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadInventory() {
  try {
    const payload = await api("/api/fridge/items");
    state.householdId = payload.householdId || state.householdId;
    state.householdName = payload.householdName || state.householdName;
    state.items = payload.items || [];
    renderHousehold();
    renderInventory();
  } catch (error) {
    showToast(error.message);
  }
}

function renderHousehold() {
  els.householdTitle.textContent = state.householdName;
  els.householdCodeInput.value = state.householdId;
  els.householdNameInput.value = state.householdName;
}

async function saveHousehold(event) {
  event.preventDefault();
  const form = new FormData(els.householdForm);
  const nextId = normalizeHouseholdId(form.get("householdId"));
  const typedName = String(form.get("householdName") || "").trim();
  const nameEdited = typedName && typedName !== state.householdName;
  state.householdId = nextId;
  localStorage.setItem("food-check-household-id", state.householdId);

  try {
    if (nameEdited) {
      const payload = await api("/api/household", {
        method: "PATCH",
        body: JSON.stringify({ householdName: typedName })
      });
      state.householdName = payload.householdName || typedName;
    }
    await loadInventory();
    showToast(`Using household ${state.householdId}.`);
  } catch (error) {
    showToast(error.message);
  }
}

function renderInventory() {
  els.itemCount.textContent = state.items.length;
  els.fridgeCount.textContent = state.items.filter((item) => item.location === "fridge" || item.location === "freezer").length;
  els.soonCount.textContent = state.items.filter((item) => expiryInfo(item.expiresAt).priority <= 1).length;

  if (!state.items.length) {
    els.inventoryList.innerHTML = `<div class="item-card"><div><h3>No food tracked yet</h3><p class="helper">Add an item manually or scan a receipt to get started.</p></div></div>`;
    return;
  }

  const sortedItems = state.items.filter(matchesInventoryFilters).sort(compareItems);

  if (!sortedItems.length) {
    els.inventoryList.innerHTML = `<div class="item-card"><div><h3>No matches</h3><p class="helper">Try a different search or filter.</p></div></div>`;
    return;
  }

  els.inventoryList.innerHTML = sortedItems
    .map((item) => {
      const updated = new Date(item.updatedAt || item.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const expiry = expiryInfo(item.expiresAt);
      return `
        <article class="item-card">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="item-meta">
              <span class="tag fresh">${escapeHtml(item.quantity || "1")}</span>
              <span class="tag ${item.location === "fridge" || item.location === "freezer" ? "cold" : ""}">${escapeHtml(item.location)}</span>
              <span class="tag">${escapeHtml(item.category || "Other")}</span>
              ${expiry.label ? `<span class="tag ${expiry.className}">${escapeHtml(expiry.label)}</span>` : ""}
              <span class="tag">${escapeHtml(item.source || "manual")}</span>
            </div>
            <p class="helper">Updated ${updated}</p>
          </div>
          <div class="item-actions">
            <button class="edit-button" aria-label="Edit ${escapeHtml(item.name)}" title="Edit" data-edit-toggle="${item.id}">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
              </svg>
            </button>
            <button class="delete-button" aria-label="Remove ${escapeHtml(item.name)}" title="Remove" data-delete="${item.id}">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          </div>
          <form class="edit-form hidden" data-edit-form="${item.id}">
            <label>
              Item
              <input name="name" type="text" value="${escapeAttribute(item.name)}" required />
            </label>
            <div class="form-grid">
              <label>
                Qty
                <input name="quantity" type="text" value="${escapeAttribute(item.quantity || "1")}" />
              </label>
              <label>
                Area
                <select name="location">
                  ${["fridge", "freezer", "pantry"].map((location) => `<option value="${location}" ${item.location === location ? "selected" : ""}>${capitalize(location)}</option>`).join("")}
                </select>
              </label>
            </div>
            <label>
              Category
              <input name="category" type="text" value="${escapeAttribute(item.category || "Other")}" />
            </label>
            <label>
              Use by
              <input name="expiresAt" type="date" value="${escapeAttribute(toDateInputValue(item.expiresAt))}" />
            </label>
            <label>
              Notes
              <textarea name="notes" rows="2" placeholder="Optional">${escapeHtml(item.notes || "")}</textarea>
            </label>
            <div class="form-actions">
              <button class="secondary-button" type="button" data-edit-cancel="${item.id}">Cancel</button>
              <button class="primary-button" type="submit">Save changes</button>
            </div>
          </form>
        </article>
      `;
    })
    .join("");

  els.inventoryList.querySelectorAll("[data-edit-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleEditForm(button.dataset.editToggle, true);
    });
  });

  els.inventoryList.querySelectorAll("[data-edit-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleEditForm(button.dataset.editCancel, false);
    });
  });

  els.inventoryList.querySelectorAll("[data-edit-form]").forEach((form) => {
    form.addEventListener("submit", updateItem);
  });

  els.inventoryList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await removeItem(button.dataset.delete);
    });
  });
}

async function addManualItem(event) {
  event.preventDefault();
  const form = new FormData(els.addForm);
  const item = Object.fromEntries(form.entries());
  try {
    await api("/api/fridge/items", {
      method: "POST",
      body: JSON.stringify(item)
    });
    els.addForm.reset();
    els.addForm.classList.add("hidden");
    els.showAddButton.classList.remove("hidden");
    await loadInventory();
    showToast("Added to the shared list.");
  } catch (error) {
    showToast(error.message);
  }
}

async function removeItem(id) {
  try {
    await api(`/api/fridge/items/${id}`, { method: "DELETE" });
    await loadInventory();
    showToast("Removed from the active list.");
  } catch (error) {
    showToast(error.message);
  }
}

function toggleEditForm(id, shouldOpen) {
  const form = els.inventoryList.querySelector(`[data-edit-form="${cssEscape(id)}"]`);
  if (!form) return;
  form.classList.toggle("hidden", !shouldOpen);
  if (shouldOpen) form.elements.name.focus();
}

async function updateItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.editForm;
  const body = Object.fromEntries(new FormData(form).entries());

  try {
    await api(`/api/fridge/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadInventory();
    showToast("Saved changes to the shared list.");
  } catch (error) {
    showToast(error.message);
  }
}

async function handleReceiptFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  els.scanNotice.textContent = "Preparing photo...";
  try {
    state.selectedImage = await prepareReceiptImage(file);
    els.receiptPreview.src = state.selectedImage;
    els.previewFrame.classList.add("has-image");
    els.scanButton.disabled = false;
    els.scanNotice.textContent = "Ready to scan. You will review items before they are saved.";
    els.reviewPanel.classList.add("hidden");
  } catch (error) {
    showToast("Could not read that photo. Try another one.");
    els.scanNotice.textContent = "No receipt selected yet.";
  }
}

async function prepareReceiptImage(file) {
  const original = await readFileAsDataUrl(file);
  try {
    const image = await loadImage(original);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const alreadySmallJpeg = scale >= 1 && file.type === "image/jpeg" && file.size < 1024 * 1024;
    if (alreadySmallJpeg) return original;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL("image/jpeg", 0.85);
    return compressed.length < original.length ? compressed : original;
  } catch {
    return original;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image decode failed."));
    image.src = src;
  });
}

async function scanReceipt() {
  if (!state.selectedImage) return;
  els.scanButton.disabled = true;
  els.scanButton.textContent = "Scanning...";
  els.scanNotice.textContent = "Reading the receipt and finding likely food items.";
  try {
    const payload = await api("/api/receipt/scan", {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: state.selectedImage })
    });
    state.candidates = payload.items || [];
    if (payload.mode === "error") {
      els.reviewPanel.classList.add("hidden");
      els.scanNotice.textContent = payload.notice || "Scan failed. Try again or add items manually.";
      return;
    }
    renderCandidates();
    els.reviewPanel.classList.remove("hidden");
    els.scanNotice.textContent = payload.notice || "Scan complete. Review each item before saving.";
  } catch (error) {
    showToast(error.message);
    els.scanNotice.textContent = "Scan failed. Try another photo or add items manually.";
  } finally {
    els.scanButton.disabled = false;
    els.scanButton.textContent = "Scan receipt";
  }
}

function renderCandidates() {
  if (!state.candidates.length) {
    els.candidateList.innerHTML = `<p class="helper">No grocery items found. Try a clearer photo or add manually.</p>`;
    return;
  }

  els.candidateList.innerHTML = state.candidates
    .map((item, index) => {
      const uncertain = typeof item.confidence === "number" && item.confidence < 0.6;
      return `
        <div class="review-row" data-index="${index}">
          <input type="checkbox" checked aria-label="Include ${escapeHtml(item.name)}" />
          <div class="review-fields">
            ${uncertain ? `<p class="helper"><span class="tag warning">double-check</span> The scan was unsure about this line.</p>` : ""}
            <label>
              Item
              <input data-field="name" value="${escapeAttribute(item.name)}" aria-label="Item name" />
            </label>
            <label>
              Qty
              <input data-field="quantity" value="${escapeAttribute(item.quantity || "1")}" aria-label="Quantity" />
            </label>
            <label>
              Area
              <select data-field="location" aria-label="Storage location">
                ${["fridge", "freezer", "pantry"].map((location) => `<option value="${location}" ${item.location === location ? "selected" : ""}>${capitalize(location)}</option>`).join("")}
              </select>
            </label>
            <label>
              Category
              <input data-field="category" value="${escapeAttribute(item.category || "Other")}" aria-label="Category" />
            </label>
            <label>
              Use by
              <input data-field="expiresAt" type="date" value="${escapeAttribute(toDateInputValue(item.expiresAt))}" aria-label="Use by date" />
            </label>
          </div>
        </div>
      `;
    })
    .join("");
}

async function commitScan() {
  const items = [...els.candidateList.querySelectorAll(".review-row")].map((row) => {
    const item = {};
    item.skip = !row.querySelector("input[type='checkbox']").checked;
    row.querySelectorAll("[data-field]").forEach((field) => {
      item[field.dataset.field] = field.value;
    });
    return item;
  });

  try {
    const payload = await api("/api/fridge/commit-scan", {
      method: "POST",
      body: JSON.stringify({ items })
    });
    state.items = payload.items || [];
    renderInventory();
    setView("fridge");
    showToast("Receipt items saved to the shared list.");
  } catch (error) {
    showToast(error.message);
  }
}

function toggleCraving(event) {
  const button = event.target.closest(".chip");
  if (!button) return;
  const value = button.dataset.value;
  if (state.cravings.has(value)) state.cravings.delete(value);
  else state.cravings.add(value);
  button.classList.toggle("active", state.cravings.has(value));
}

async function recommendDinner(event) {
  event.preventDefault();
  const form = new FormData(els.cookForm);
  els.recipeList.innerHTML = "";
  els.recommendationNotice.textContent = "Thinking through what you already have...";

  try {
    const payload = await api("/api/recommendations", {
      method: "POST",
      body: JSON.stringify({
        cuisine: form.get("cuisine"),
        note: form.get("note"),
        cravings: [...state.cravings]
      })
    });
    renderRecipes(payload.recipes || []);
    els.recommendationNotice.textContent = payload.notice || "";
  } catch (error) {
    els.recommendationNotice.textContent = "";
    showToast(error.message);
  }
}

function renderRecipes(recipes) {
  if (!recipes.length) {
    els.recipeList.innerHTML = `<p class="helper">No recipes came back. Add a few fridge items and try again.</p>`;
    return;
  }

  els.recipeList.innerHTML = recipes
    .map((recipe) => {
      return `
        <article class="recipe-card">
          <h3>${escapeHtml(recipe.title)}</h3>
          <div class="recipe-meta">
            <span class="tag fresh">${escapeHtml(recipe.time)}</span>
            <span class="tag">${escapeHtml(recipe.difficulty)}</span>
            <span class="tag">${escapeHtml(recipe.vibe)}</span>
          </div>
          <p class="helper"><strong>Uses:</strong> ${escapeHtml((recipe.uses || []).join(", ") || "Flexible fridge items")}</p>
          <p class="helper"><strong>Optional:</strong> ${escapeHtml((recipe.optionalMissing || []).join(", ") || "Nothing major")}</p>
          <ol>
            ${(recipe.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
          </ol>
        </article>
      `;
    })
    .join("");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2600);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function capitalize(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compareItems(a, b) {
  const expiryA = expiryInfo(a.expiresAt);
  const expiryB = expiryInfo(b.expiresAt);
  if (expiryA.priority !== expiryB.priority) return expiryA.priority - expiryB.priority;
  if (expiryA.time !== expiryB.time) return expiryA.time - expiryB.time;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function matchesInventoryFilters(item) {
  const expiry = expiryInfo(item.expiresAt);
  if (state.inventoryFilter === "soon" && expiry.priority > 1) return false;
  if (["fridge", "freezer", "pantry"].includes(state.inventoryFilter) && item.location !== state.inventoryFilter) return false;

  if (!state.inventorySearch) return true;
  const haystack = [item.name, item.category, item.location, item.quantity, item.notes, item.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.inventorySearch);
}

function expiryInfo(value) {
  if (!value) return { label: "", className: "", priority: 9, time: Number.MAX_SAFE_INTEGER };
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { label: "", className: "", priority: 9, time: Number.MAX_SAFE_INTEGER };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: "past due", className: "danger", priority: 0, time: date.getTime() };
  if (days === 0) return { label: "use today", className: "danger", priority: 0, time: date.getTime() };
  if (days <= 3) return { label: `${days}d left`, className: "warning", priority: 1, time: date.getTime() };
  return { label: `use by ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, className: "date", priority: 2, time: date.getTime() };
}

function toDateInputValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replaceAll('"', '\\"');
}

function normalizeHouseholdId(value) {
  return String(value || "HOME")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "HOME";
}
