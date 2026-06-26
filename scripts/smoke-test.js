const BASE_URL = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 4179}`;
const HOUSEHOLD_ID = `SMOKE-${Date.now()}`;

async function main() {
  const health = await request("/api/health");
  assert(health.ok === true, "Health endpoint should return ok=true.");

  const household = await request("/api/household", {
    headers: householdHeaders()
  });
  assert(household.householdId === HOUSEHOLD_ID, "Household endpoint should honor X-Household-Id.");

  const created = await request("/api/fridge/items", {
    method: "POST",
    headers: householdHeaders(),
    body: {
      name: "Smoke spinach",
      quantity: "1 bag",
      category: "Produce",
      location: "fridge",
      expiresAt: today()
    }
  });
  assert(created.item && created.item.name === "Smoke spinach", "Manual item create should work.");

  const edited = await request(`/api/fridge/items/${created.item.id}`, {
    method: "PATCH",
    headers: householdHeaders(),
    body: {
      name: "Smoke spinach edited",
      quantity: "2 bags",
      category: "Produce",
      location: "fridge",
      expiresAt: today()
    }
  });
  assert(edited.item.name === "Smoke spinach edited", "Manual item edit should work.");

  const scan = await request("/api/receipt/scan", {
    method: "POST",
    headers: householdHeaders(),
    body: { imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" }
  });
  assert(Array.isArray(scan.items) && scan.items.length > 0, "Receipt scan should return review candidates.");

  const committed = await request("/api/fridge/commit-scan", {
    method: "POST",
    headers: householdHeaders(),
    body: {
      items: [
        {
          name: "Smoke receipt milk",
          quantity: "1 carton",
          category: "Dairy",
          location: "fridge",
          expiresAt: today()
        }
      ]
    }
  });
  assert(committed.items.some((item) => item.name === "Smoke receipt milk"), "Receipt commit should save selected item.");

  const recommendations = await request("/api/recommendations", {
    method: "POST",
    headers: householdHeaders(),
    body: {
      cuisine: "Flexible",
      cravings: ["quick", "use-soon"],
      note: "smoke test"
    }
  });
  assert(Array.isArray(recommendations.recipes) && recommendations.recipes.length > 0, "Recommendations should return recipes.");
  assert(
    recommendations.recipes.some((recipe) => (recipe.uses || []).some((item) => item.includes("Smoke"))),
    "Recommendations should consider smoke-test inventory."
  );

  const removed = await request(`/api/fridge/items/${created.item.id}`, {
    method: "DELETE",
    headers: householdHeaders()
  });
  assert(removed.item.status === "used", "Delete should mark item used.");

  console.log(`Smoke test passed against ${BASE_URL}`);
}

function householdHeaders() {
  return { "X-Household-Id": HOUSEHOLD_ID };
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
