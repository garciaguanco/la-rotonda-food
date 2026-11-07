(() => {
  const $ = id => document.getElementById(id);
  let products = [], categories = [], activeCategory = "Todos";
  let cart = [], selectedProduct = null, lastOrderToken = null, lastOrderNumber = null;
  let trackingChannel = null;

  const sampleProducts = [
    {id:"demo-1",name:"Hamburguesa clásica",description:"Carne, queso, lechuga, tomate y nuestra salsa.",price:320,category:"Hamburguesas",image_url:""},
    {id:"demo-2",name:"Hamburguesa La Rotonda",description:"Doble carne, doble queso y cebolla caramelizada.",price:430,category:"Hamburguesas",image_url:""},
    {id:"demo-3",name:"Papas fritas",description:"Porción crocante para compartir.",price:180,category:"Acompañamientos",image_url:""},
    {id:"demo-4",name:"Refresco",description:"Bebida fría individual.",price:100,category:"Bebidas",image_url:""}
  ];

  function renderCategories() {
    const names = ["Todos", ...new Set(products.map(p => p.category_name || p.category || "Otros"))];
    $("category-list").innerHTML = names.map(name =>
      `<button class="category-chip ${name === activeCategory ? "active" : ""}" data-category="${escapeHTML(name)}">${escapeHTML(name)}</button>`
    ).join("");
    $("category-list").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category; renderCategories(); renderProducts();
    }));
  }
  function renderProducts() {
    const visible = products.filter(p => activeCategory === "Todos" || (p.category_name || p.category || "Otros") === activeCategory);
    $("product-grid").innerHTML = visible.length ? visible.map(p => `
      <article class="product-card">
        <div class="product-image">${p.image_url ? `<img src="${escapeHTML(p.image_url)}" alt="${escapeHTML(p.name)}" loading="lazy">` : "LR"}</div>
        <div class="product-info"><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.description || "Preparado al momento.")}</p>
          <div class="product-bottom"><span class="price">${formatMoney(p.price)}</span><button class="add-button" data-add="${escapeHTML(p.id)}" aria-label="Agregar ${escapeHTML(p.name)}">+</button></div>
        </div>
      </article>`).join("") : `<div class="empty-state">No hay productos en esta categoría.</div>`;
    $("product-grid").querySelectorAll("[data-add]").forEach(btn => btn.addEventListener("click", () => openProduct(btn.dataset.add)));
  }
  async function loadMenu() {
    if (!db) { products = sampleProducts; renderCategories(); renderProducts(); toast("Vista de demostración: conectá Supabase para recibir pedidos reales."); return; }
    const { data, error } = await db.from("products").select("id,name,description,price,image_url,category_id,categories(name)").eq("is_active", true).order("sort_order");
    if (error) { toast("No se pudo cargar el menú."); console.error(error); return; }
    products = (data || []).map(p => ({...p, category_name: p.categories?.name || "Otros"}));
    renderCategories(); renderProducts();
  }
  function openProduct(id) {
    selectedProduct = products.find(p => String(p.id) === String(id));
    if (!selectedProduct) return;
    $("modal-product-name").textContent = selectedProduct.name;
    $("modal-product-description").textContent = selectedProduct.description || "";
    $("modal-product-price").textContent = formatMoney(selectedProduct.price);
    $("modal-quantity").value = 1; $("modal-notes").value = "";
    $("product-modal").classList.remove("hidden");
  }
  function addToCart(product, qty, notes) {
    cart.push({product_id: product.id, name: product.name, price: Number(product.price), quantity: qty, notes});
    renderCart(); $("product-modal").classList.add("hidden"); $("cart-drawer").classList.remove("hidden");
  }
  function renderCart() {
    $("cart-count").textContent = cart.reduce((n, item) => n + item.quantity, 0);
    $("cart-total").textContent = formatMoney(cart.reduce((n, item) => n + item.price * item.quantity, 0));
    $("cart-items").innerHTML = cart.length ? cart.map((item, i) => `
      <div class="cart-line"><div><strong>${escapeHTML(item.quantity)} × ${escapeHTML(item.name)}</strong><small>${formatMoney(item.price)} c/u ${item.notes ? "· " + escapeHTML(item.notes) : ""}</small></div>
      <div class="cart-controls"><strong>${formatMoney(item.price * item.quantity)}</strong><button data-remove="${i}" aria-label="Quitar">×</button></div></div>`).join("") : `<p class="muted">Todavía no agregaste productos.</p>`;
    $("cart-items").querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => { cart.splice(Number(btn.dataset.remove), 1); renderCart(); }));
  }
  async function submitOrder(event) {
    event.preventDefault();
    if (!requireConfig()) return;
    if (!cart.length) { toast("Agregá al menos un producto."); return; }
    const name = $("customer-name").value.trim();
    const type = $("order-type").value;
    const table = $("table-number").value.trim();
    if (!name) { toast("Ingresá tu nombre."); return; }
    if (type === "dine_in" && !table) { toast("Indicá el número de mesa o consultá al personal."); return; }
    const button = event.submitter; button.disabled = true; button.textContent = "Enviando…";
    const payload = {
      p_customer_name: name,
      p_order_type: type,
      p_table_number: type === "dine_in" ? table : null,
      p_customer_notes: $("order-notes").value.trim(),
      p_items: cart.map(item => ({product_id: item.product_id, quantity: item.quantity, notes: item.notes}))
    };
    const {data, error} = await db.rpc("create_order", payload);
    button.disabled = false; button.innerHTML = 'Enviar pedido <span>→</span>';
    if (error) { console.error(error); toast(error.message || "No se pudo enviar el pedido."); return; }
    lastOrderToken = data.access_token; lastOrderNumber = data.order_number;
    $("confirmation-number").textContent = "#" + data.order_number;
    $("confirmation-token").textContent = data.access_token;
    $("cart-drawer").classList.add("hidden"); $("confirmation-modal").classList.remove("hidden");
    cart = []; renderCart(); $("checkout-form").reset(); $("table-field").classList.add("hidden");
  }
  async function refreshTracking() {
    if (!lastOrderToken || !db) return;
    $("tracking-status").textContent = "Consultando estado…";
    const {data, error} = await db.rpc("get_order_status", {p_access_token: lastOrderToken});
    if (error || !data) { $("tracking-status").textContent = "No pudimos consultar el pedido. Revisá tu código."; return; }
    const labels = {new:"Recibimos tu pedido. Esperá la confirmación de cocina.",accepted:"¡Pedido aceptado! En breve comenzamos.",preparing:"Estamos preparando tu pedido.",ready:"¡Tu pedido está listo! Podés pasar a retirarlo o buscarlo en el mostrador.",delivered:"Pedido entregado. ¡Gracias por elegirnos!",cancelled:"El pedido fue cancelado. Comunicate con el local."};
    $("tracking-status").textContent = labels[data.status] || data.status;
  }
  $("cart-open").addEventListener("click", () => $("cart-drawer").classList.remove("hidden"));
  $("cart-close").addEventListener("click", () => $("cart-drawer").classList.add("hidden"));
  $("product-modal-close").addEventListener("click", () => $("product-modal").classList.add("hidden"));
  $("modal-add").addEventListener("click", () => {
    const qty = Math.max(1, Math.min(20, Number($("modal-quantity").value || 1)));
    addToCart(selectedProduct, qty, $("modal-notes").value.trim());
  });
  $("order-type").addEventListener("change", e => $("table-field").classList.toggle("hidden", e.target.value !== "dine_in"));
  $("checkout-form").addEventListener("submit", submitOrder);
  $("copy-token").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lastOrderToken); toast("Código copiado."); } catch { toast("Copiá el código manualmente."); }
  });
  $("track-order").addEventListener("click", async () => {
    $("confirmation-modal").classList.add("hidden"); $("tracking-modal").classList.remove("hidden");
    $("tracking-number").textContent = "#" + lastOrderNumber; await refreshTracking();
  });
  $("tracking-close").addEventListener("click", () => $("tracking-modal").classList.add("hidden"));
  $("tracking-refresh").addEventListener("click", refreshTracking);
  renderCart(); loadMenu();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
})();