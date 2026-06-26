const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4179);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const DEFAULT_HOUSEHOLD_ID = "HOME";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STATE_TABLE = process.env.SUPABASE_STATE_TABLE || "food_check_state";
const SUPABASE_STATE_ID = process.env.SUPABASE_STATE_ID || "default";
const STORAGE_MODE = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function createInitialStore() {
  return {
    households: {
      [DEFAULT_HOUSEHOLD_ID]: createHousehold("Home Fridge")
    }
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    writeLocalStore(createInitialStore());
  }
}

function createHousehold(name) {
  return {
    householdName: name,
    items: seedItems(),
    scans: [],
    recommendations: [],
    createdAt: new Date().toISOString()
  };
}

function seedItems() {
  const now = new Date().toISOString();
  return [
    {
      id: crypto.randomUUID(),
      name: "Greek yogurt",
      category: "Dairy",
      location: "fridge",
      quantity: "1 tub",
      status: "active",
      source: "starter",
      addedAt: now,
      updatedAt: now,
      notes: "Starter sample. Edit or delete anytime."
    },
    {
      id: crypto.randomUUID(),
      name: "Eggs",
      category: "Dairy",
      location: "fridge",
      quantity: "6",
      status: "active",
      source: "starter",
      addedAt: now,
      updatedAt: now,
      notes: "Starter sample. Edit or delete anytime."
    }
  ];
}

async function readStore() {
  if (STORAGE_MODE === "supabase") return readSupabaseStore();
  return readLocalStore();
}

function readLocalStore() {
  ensureStore();
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  return migrateStore(store);
}

function migrateStore(store) {
  if (!store.households) {
    return {
      households: {
        [DEFAULT_HOUSEHOLD_ID]: {
          householdName: store.householdName || "Home Fridge",
          items: Array.isArray(store.items) ? store.items : seedItems(),
          scans: Array.isArray(store.scans) ? store.scans : [],
          recommendations: Array.isArray(store.recommendations) ? store.recommendations : [],
          createdAt: new Date().toISOString()
        }
      }
    };
  }
  return store;
}

async function writeStore(store) {
  if (STORAGE_MODE === "supabase") return writeSupabaseStore(store);
  return writeLocalStore(store);
}

let storeMutationQueue = Promise.resolve();

function mutateStore(operation) {
  const next = storeMutationQueue.then(async () => {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  });
  storeMutationQueue = next.catch(() => {});
  return next;
}

function writeLocalStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

async function readSupabaseStore() {
  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_STATE_TABLE}?id=eq.${encodeURIComponent(SUPABASE_STATE_ID)}&select=data`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    throw Object.assign(new Error(`Supabase read failed (${response.status}).`), { status: 502 });
  }

  const rows = await response.json();
  if (rows[0] && rows[0].data) return migrateStore(rows[0].data);

  const initial = createInitialStore();
  await writeSupabaseStore(initial);
  return initial;
}

async function writeSupabaseStore(store) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_STATE_TABLE}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      id: SUPABASE_STATE_ID,
      data: store,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Supabase write failed (${response.status}).`), { status: 502 });
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message, details) {
  sendJson(res, status, { error: message, details });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(Object.assign(new Error("Invalid JSON body."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function normalizeItem(input, source = "manual") {
  const now = new Date().toISOString();
  const name = String(input.name || "").trim();
  if (!name) throw Object.assign(new Error("Item name is required."), { status: 400 });

  return {
    id: input.id || crypto.randomUUID(),
    name,
    category: String(input.category || "Other").trim() || "Other",
    location: ["fridge", "freezer", "pantry"].includes(input.location) ? input.location : "fridge",
    quantity: String(input.quantity || input.quantityText || "1").trim() || "1",
    status: input.status === "used" ? "used" : "active",
    source,
    addedAt: input.addedAt || now,
    updatedAt: now,
    expiresAt: input.expiresAt || "",
    notes: String(input.notes || "").trim()
  };
}

function mergeItem(store, item) {
  const key = item.name.toLowerCase();
  const existing = store.items.find((candidate) => {
    return candidate.status === "active" && candidate.name.toLowerCase() === key;
  });

  if (!existing) {
    store.items.unshift(item);
    return { item, merged: false };
  }

  existing.quantity = combineQuantity(existing.quantity, item.quantity);
  existing.category = item.category || existing.category;
  existing.location = item.location || existing.location;
  existing.source = existing.source === "starter" ? item.source : existing.source;
  existing.updatedAt = new Date().toISOString();
  existing.notes = existing.notes || item.notes;
  return { item: existing, merged: true };
}

function combineQuantity(current, next) {
  if (!current || current === "1") return next || "1";
  if (!next || next === "1") return current;
  if (current.toLowerCase() === next.toLowerCase()) return current;
  return `${current} + ${next}`;
}

function normalizeHouseholdId(value) {
  const normalized = String(value || DEFAULT_HOUSEHOLD_ID)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return normalized || DEFAULT_HOUSEHOLD_ID;
}

function getHouseholdId(req) {
  return normalizeHouseholdId(req.headers["x-household-id"]);
}

function getHousehold(store, householdId) {
  if (!store.households[householdId]) {
    store.households[householdId] = createHousehold(`${householdId} Fridge`);
  }
  return store.households[householdId];
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      aiEnabled: Boolean(GEMINI_API_KEY),
      aiProvider: GEMINI_API_KEY ? "gemini" : "local",
      model: GEMINI_API_KEY ? GEMINI_MODEL : "",
      storageMode: STORAGE_MODE
    });
  }

  if (req.method === "GET" && pathname === "/api/household") {
    const householdId = getHouseholdId(req);
    const result = await mutateStore((store) => {
      const household = getHousehold(store, householdId);
      return {
        householdId,
        householdName: household.householdName,
        householdCount: Object.keys(store.households).length
      };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/fridge/items") {
    const householdId = getHouseholdId(req);
    const result = await mutateStore((store) => {
      const household = getHousehold(store, householdId);
      return {
        householdId,
        householdName: household.householdName,
        items: household.items.filter((item) => item.status === "active")
      };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "PATCH" && pathname === "/api/household") {
    const body = await readBody(req);
    const householdId = getHouseholdId(req);
    const name = String(body.householdName || "").trim();
    if (!name) return sendError(res, 400, "Household name is required.");
    const result = await mutateStore((store) => {
      const household = getHousehold(store, householdId);
      household.householdName = name.slice(0, 60);
      return {
        householdId,
        householdName: household.householdName
      };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/fridge/items") {
    const body = await readBody(req);
    const householdId = getHouseholdId(req);
    const item = normalizeItem(body, "manual");
    const result = await mutateStore((store) => {
      const household = getHousehold(store, householdId);
      return mergeItem(household, item);
    });
    return sendJson(res, 201, result);
  }

  const itemPatchMatch = pathname.match(/^\/api\/fridge\/items\/([^/]+)$/);
  if (itemPatchMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const result = await mutateStore((store) => {
      const household = getHousehold(store, getHouseholdId(req));
      const item = household.items.find((candidate) => candidate.id === itemPatchMatch[1]);
      if (!item) throw Object.assign(new Error("Item not found."), { status: 404 });

      const fields = ["name", "category", "location", "quantity", "expiresAt", "notes", "status"];
      for (const field of fields) {
        if (body[field] !== undefined) item[field] = String(body[field]).trim();
      }
      if (!item.name) throw Object.assign(new Error("Item name is required."), { status: 400 });
      if (!["fridge", "freezer", "pantry"].includes(item.location)) item.location = "fridge";
      if (!["active", "used"].includes(item.status)) item.status = "active";
      item.updatedAt = new Date().toISOString();
      return { item };
    });
    return sendJson(res, 200, result);
  }

  if (itemPatchMatch && req.method === "DELETE") {
    const result = await mutateStore((store) => {
      const household = getHousehold(store, getHouseholdId(req));
      const item = household.items.find((candidate) => candidate.id === itemPatchMatch[1]);
      if (!item) throw Object.assign(new Error("Item not found."), { status: 404 });
      item.status = "used";
      item.updatedAt = new Date().toISOString();
      return { item };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/receipt/scan") {
    const body = await readBody(req);
    if (!body.imageDataUrl) return sendError(res, 400, "Receipt image is required.");
    const householdId = getHouseholdId(req);
    const result = await scanReceipt(body.imageDataUrl);
    const scan = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      mode: result.mode,
      candidates: result.items
    };
    await mutateStore((store) => {
      const household = getHousehold(store, householdId);
      household.scans.unshift(scan);
    });
    return sendJson(res, 200, {
      scanId: scan.id,
      ...result
    });
  }

  if (req.method === "POST" && pathname === "/api/fridge/commit-scan") {
    const body = await readBody(req);
    const householdId = getHouseholdId(req);
    const incoming = Array.isArray(body.items) ? body.items : [];
    const result = await mutateStore((store) => {
      const household = getHousehold(store, householdId);
      const added = [];
      const merged = [];
      for (const candidate of incoming) {
        if (candidate.skip) continue;
        const normalized = normalizeItem(candidate, "receipt");
        const mergeResult = mergeItem(household, normalized);
        if (mergeResult.merged) merged.push(mergeResult.item);
        else added.push(mergeResult.item);
      }
      return {
        added,
        merged,
        items: household.items.filter((item) => item.status === "active")
      };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/recommendations") {
    const body = await readBody(req);
    const householdId = getHouseholdId(req);
    const store = await readStore();
    const household = getHousehold(store, householdId);
    const inventory = household.items.filter((item) => item.status === "active");
    const result = await recommendMeals(inventory, body);
    await mutateStore((latestStore) => {
      const latestHousehold = getHousehold(latestStore, householdId);
      latestHousehold.recommendations.unshift({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        preferences: body,
        result
      });
    });
    return sendJson(res, 200, result);
  }

  return sendError(res, 404, "API route not found.");
}

async function scanReceipt(imageDataUrl) {
  if (GEMINI_API_KEY) {
    try {
      return await scanReceiptWithGemini(imageDataUrl);
    } catch (error) {
      return {
        mode: "fallback",
        notice: `Gemini scan failed, so demo extraction was used: ${error.message}`,
        items: fallbackReceiptItems()
      };
    }
  }

  return {
    mode: "fallback",
    notice: "Demo extraction is active. Add GEMINI_API_KEY before starting the server to scan real receipts.",
    items: fallbackReceiptItems()
  };
}

async function scanReceiptWithGemini(imageDataUrl) {
  const image = parseDataUrl(imageDataUrl);
  const payload = await callGemini({
    input: [
      {
        type: "text",
        text: "Extract grocery receipt line items that are food. Return grocery items only, not taxes, payment lines, totals, bags, coupons, or store info. Infer clean names, quantities when visible, category, and whether each belongs in fridge, freezer, or pantry."
      },
      { type: "image", data: image.data, mime_type: image.mimeType }
    ],
    schema: receiptItemsSchema()
  });

  const parsed = JSON.parse(extractGeminiText(payload));
  return {
    mode: "gemini",
    notice: "",
    items: (parsed.items || []).map((item) => ({
      name: item.name,
      quantity: item.quantity || "1",
      category: item.category || "Other",
      location: item.location || "fridge",
      confidence: item.confidence || 0.7
    }))
  };
}

function fallbackReceiptItems() {
  return [
    { name: "Baby spinach", quantity: "1 bag", category: "Produce", location: "fridge", confidence: 0.92 },
    { name: "Chicken breast", quantity: "1 pack", category: "Meat", location: "fridge", confidence: 0.88 },
    { name: "Strawberries", quantity: "1 box", category: "Fruit", location: "fridge", confidence: 0.85 },
    { name: "Milk", quantity: "1 carton", category: "Dairy", location: "fridge", confidence: 0.9 },
    { name: "Rice noodles", quantity: "1 pack", category: "Pantry", location: "pantry", confidence: 0.75 }
  ];
}

async function recommendMeals(inventory, preferences) {
  if (GEMINI_API_KEY) {
    try {
      return await recommendWithGemini(inventory, preferences);
    } catch (error) {
      return localRecommendations(inventory, preferences, `Gemini recommendations failed, so local suggestions were used: ${error.message}`);
    }
  }
  return localRecommendations(inventory, preferences, "Local suggestions are active. Add GEMINI_API_KEY for personalized AI recipes.");
}

async function recommendWithGemini(inventory, preferences) {
  const payload = await callGemini({
    input: [
      {
        type: "text",
        text: `Recommend meals for a household using current fridge inventory first. Preferences: ${JSON.stringify(preferences)}. Inventory: ${JSON.stringify(inventory)}. If preferences.cravings includes "use-soon", prioritize ingredients with expiresAt dates that are today, past due, or within 3 days. Keep it practical, appealing to a young couple, and separate pantry/optional missing items.`
      }
    ],
    schema: mealRecommendationsSchema()
  });
  return JSON.parse(extractGeminiText(payload));
}

async function callGemini({ input, schema }) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${message.slice(0, 220)}`);
  }

  return response.json();
}

function extractGeminiText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  for (const output of payload.output || []) {
    if (typeof output.text === "string") parts.push(output.text);
    for (const content of output.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  for (const candidate of payload.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.text) parts.push(part.text);
    }
  }
  const text = parts.join("\n").trim();
  if (!text) throw new Error("Gemini returned no text.");
  return stripJsonFence(text);
}

function stripJsonFence(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw Object.assign(new Error("Image must be a base64 data URL."), { status: 400 });
  return { mimeType: match[1], data: match[2] };
}

function receiptItemsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "quantity", "category", "location", "confidence"],
          properties: {
            name: { type: "string" },
            quantity: { type: "string" },
            category: { type: "string" },
            location: { type: "string", enum: ["fridge", "freezer", "pantry"] },
            confidence: { type: "number" }
          }
        }
      }
    }
  };
}

function mealRecommendationsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["notice", "recipes"],
    properties: {
      notice: { type: "string" },
      recipes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "vibe", "time", "difficulty", "uses", "optionalMissing", "steps"],
          properties: {
            title: { type: "string" },
            vibe: { type: "string" },
            time: { type: "string" },
            difficulty: { type: "string" },
            uses: { type: "array", items: { type: "string" } },
            optionalMissing: { type: "array", items: { type: "string" } },
            steps: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  };
}

function localRecommendations(inventory, preferences, notice) {
  const sortedInventory = [...inventory].sort(compareInventoryForCooking);
  const names = sortedInventory.map((item) => item.name);
  const lower = names.map((name) => name.toLowerCase());
  const cuisine = preferences.cuisine || "Flexible";
  const cravings = Array.isArray(preferences.cravings) ? preferences.cravings : [];
  const spicy = cravings.includes("spicy");
  const quick = cravings.includes("quick");
  const useSoonFirst = cravings.includes("use-soon");
  const useSoonNames = sortedInventory.filter((item) => expiryPriority(item.expiresAt) <= 1).map((item) => item.name);
  const has = (term) => lower.some((name) => name.includes(term));

  const recipes = [];
  if (useSoonFirst && useSoonNames.length) {
    recipes.push({
      title: "Use-Soon Fridge Rescue Bowl",
      vibe: `${cuisine} flexible, practical, waste-saving`,
      time: quick ? "15 min" : "25 min",
      difficulty: "Easy",
      uses: useSoonNames.slice(0, 6),
      optionalMissing: ["rice, noodles, or toast", "sauce you like", "something crunchy"],
      steps: [
        "Start with the items closest to their use-by date.",
        "Cook or warm everything that needs heat, then add a simple base.",
        "Finish with sauce, seasoning, and crunch so it feels intentional."
      ]
    });
  }

  if (has("chicken") || has("spinach") || cuisine === "Asian") {
    recipes.push({
      title: spicy ? "Spicy Chicken Noodle Stir-Fry" : "Chicken Noodle Stir-Fry",
      vibe: `${cuisine} leaning, savory, weeknight-friendly`,
      time: quick ? "20 min" : "30 min",
      difficulty: "Easy",
      uses: names.filter((name) => /chicken|spinach|noodle|egg|milk/i.test(name)).slice(0, 6),
      optionalMissing: ["soy sauce", "garlic", "chili crisp", "green onion"].filter((item) => !lower.includes(item)),
      steps: [
        "Cook noodles until just tender.",
        "Sear protein or eggs, then add greens.",
        "Toss with soy sauce, garlic, and a little chili if you want heat."
      ]
    });
  }

  recipes.push({
    title: "Fridge-Clean Breakfast Bowl",
    vibe: "Comforting, low-effort, good for using small leftovers",
    time: "15 min",
    difficulty: "Easy",
    uses: names.slice(0, 7),
    optionalMissing: ["rice or toast", "hot sauce", "sesame seeds"],
    steps: [
      "Warm the base and any vegetables.",
      "Add eggs, yogurt sauce, or leftover protein.",
      "Finish with something crunchy or spicy."
    ]
  });

  recipes.push({
    title: "Fresh Yogurt Fruit Bowl",
    vibe: "Sweet, fresh, no-cook",
    time: "5 min",
    difficulty: "Very easy",
    uses: names.filter((name) => /yogurt|strawberr|berry|milk/i.test(name)),
    optionalMissing: ["granola", "honey", "nuts"],
    steps: [
      "Spoon yogurt into bowls.",
      "Top with fruit and any crunch you have.",
      "Add honey or a small pinch of salt to make it pop."
    ]
  });

  return { notice, recipes };
}

function compareInventoryForCooking(a, b) {
  const expiryA = expiryPriority(a.expiresAt);
  const expiryB = expiryPriority(b.expiresAt);
  if (expiryA !== expiryB) return expiryA - expiryB;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function expiryPriority(value) {
  if (!value) return 9;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 9;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 0;
  if (days <= 3) return 1;
  return 2;
}

function serveStatic(req, res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexError, indexContent) => {
        if (indexError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
        res.end(indexContent);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, error.status || 500, error.message || "Unexpected server error.");
  }
});

if (STORAGE_MODE === "local") ensureStore();
server.listen(PORT, () => {
  console.log(`Food Check is running at http://localhost:${PORT}`);
  console.log(`Storage mode: ${STORAGE_MODE}`);
});
