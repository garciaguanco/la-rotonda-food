(() => {
  const $ = id => document.getElementById(id);
  let currentUser = null, ordersChannel = null;
  const statusLabels = {new:"Nuevo",accepted:"Aceptado",preparing:"Preparando",ready:"Listo",delivered:"Entregado",cancelled:"Cancelado"};
  async function init() {
    if (!requireConfig()) return;
    const {data:{session}} = await db.auth.getSession();
    if (session) await showApp(session.user);
    db.auth.onAuthStateChange((_event, session) => session ? showApp(session.user) : showLogin());
  }
  async function showApp(user) {
    currentUser = user;
    const {data: role} = await db.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (!role || !["admin","kitchen"].includes(role.role)) { await db.auth.signOut(); $("login-error").textContent = "Este usuario no tiene permisos para ingresar."; return; }
    $("login-panel").classList.add("hidden"); $("app-panel").classList.remove("hidden");
    $("admin-user").textContent = user.email || "";
    document.querySelector('[data-tab="products"]').classList.toggle("hidden", role.role !== "admin");
    await loadOrders();
    if (ordersChannel) db.removeChannel(ordersChannel);
    ordersChannel = db.channel("kitchen-orders").on("postgres_changes",{event:"*",schema:"public",table:"orders"}, loadOrders).subscribe();
    if (role.role === "admin") loadProducts();
  }
  function showLogin() {
    currentUser = null; $("login-panel").classList.remove("hidden"); $("app-panel").classList.add("hidden");
    if (ordersChannel) db.removeChannel(ordersChannel);
  }
  async function loadOrders() {
    const {data, error} = await db.from("orders").select("id,order_number,customer_name,order_type,table_number,customer_notes,status,total,created_at,order_items(quantity,unit_price,notes,products(name))").in("status",["new","accepted","preparing","ready"]).order("created_at",{ascending:true});
    if (error) { console.error(error); toast("No se pudieron cargar los pedidos."); return; }
    const groups = {new:[],preparing:[],ready:[]};
    (data || []).forEach(o => {
      if (o.status === "new" || o.status === "accepted") groups.new.push(o);
      else if (o.status === "preparing") groups.preparing.push(o);
      else if (o.status === "ready") groups.ready.push(o);
    });
    $("new-count").textContent = groups.new.length; $("prep-count").textContent = groups.preparing.length; $("ready-count").textContent = groups.ready.length;
    $("new-orders").innerHTML = groups.new.map(o => orderCard(o,"new")).join("") || `<p class="muted">Sin pedidos nuevos.</p>`;
    $("prep-orders").innerHTML = groups.preparing.map(o => orderCard(o,"preparing")).join("") || `<p class="muted">Nada en preparación.</p>`;
    $("ready-orders").innerHTML = groups.ready.map(o => orderCard(o,"ready")).join("") || `<p class="muted">No hay pedidos listos.</p>`;
    document.querySelectorAll("[data-order-action]").forEach(btn => btn.addEventListener("click", () => updateStatus(btn.dataset.id, btn.dataset.orderAction)));
  }
  function orderCard(o, group) {
    const time = new Date(o.created_at).toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"});
    const type = o.order_type === "dine_in" ? `Consumo en local · Mesa ${escapeHTML(o.table_number || "s/n")}` : "Retiro";
    const items = (o.order_items || []).map(i => `<li>${i.quantity} × ${escapeHTML(i.products?.name || "Producto")} ${i.notes ? `<small>(${escapeHTML(i.notes)})</small>` : ""}</li>`).join("");
    let action = group === "new" ? `<button class="button button-green" data-id="${o.id}" data-order-action="preparing">Aceptar y preparar</button>` : group === "preparing" ? `<button class="button button-green" data-id="${o.id}" data-order-action="ready">Marcar listo</button>` : `<button class="button button-outline" data-id="${o.id}" data-order-action="delivered">Entregado</button>`;
    return `<article class="order-card"><div class="order-card-head"><h3>Pedido #${o.order_number}</h3><span class="status-pill">${statusLabels[o.status]}</span></div><div class="order-meta">${time} · ${type}<br>${escapeHTML(o.customer_name)}</div><ul>${items}</ul>${o.customer_notes ? `<p class="order-note">Nota: ${escapeHTML(o.customer_notes)}</p>` : ""}<div class="order-card-head"><strong>${formatMoney(o.total)}</strong></div><div class="order-actions">${action}</div></article>`;
  }
  async function updateStatus(id,status) {
    const {error} = await db.from("orders").update({status}).eq("id",id);
    if (error) { toast("No se pudo actualizar el pedido."); console.error(error); } else { toast("Pedido actualizado."); loadOrders(); }
  }
  async function loadProducts() {
    const {data,error} = await db.from("products").select("id,name,price,is_active,categories(name)").order("name");
    if (error) { console.error(error); return; }
    $("admin-products").innerHTML = (data || []).map(p => `<div class="admin-product-row"><div><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.categories?.name || "Sin categoría")} · ${formatMoney(p.price)}</small></div><button data-toggle="${p.id}" data-active="${p.is_active}">${p.is_active ? "Pausar" : "Activar"}</button></div>`).join("") || `<p class="muted">Todavía no hay productos.</p>`;
    $("admin-products").querySelectorAll("[data-toggle]").forEach(btn => btn.addEventListener("click", async () => {
      const {error} = await db.from("products").update({is_active:btn.dataset.active !== "true"}).eq("id",btn.dataset.toggle);
      if (error) toast("No se pudo cambiar la disponibilidad."); else loadProducts();
    }));
  }
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); $("login-error").textContent = "";
    const {error} = await db.auth.signInWithPassword({email:$("login-email").value.trim(),password:$("login-password").value});
    if (error) $("login-error").textContent = "No se pudo iniciar sesión. Revisá tus datos.";
  });
  $("logout-button").addEventListener("click", () => db.auth.signOut());
  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active",t===btn));
    $("kitchen-tab").classList.toggle("hidden",btn.dataset.tab!=="kitchen");
    $("products-tab").classList.toggle("hidden",btn.dataset.tab!=="products");
  }));
  $("product-form").addEventListener("submit", async e => {
    e.preventDefault();
    const categoryName = $("product-category").value.trim();
    let {data:cat,error:catError} = await db.from("categories").select("id").ilike("name",categoryName).maybeSingle();
    if (!cat && !catError) {
      const result = await db.from("categories").insert({name:categoryName}).select("id").single();
      cat = result.data; catError = result.error;
    }
    if (catError || !cat) { $("product-message").textContent = "No se pudo guardar la categoría."; return; }
    const {error} = await db.from("products").insert({name:$("product-name").value.trim(),description:$("product-description").value.trim(),price:Number($("product-price").value),category_id:cat.id,image_url:$("product-image").value.trim() || null,is_active:true});
    $("product-message").textContent = error ? "No se pudo guardar el producto." : "Producto guardado.";
    if (!error) { $("product-form").reset(); loadProducts(); }
  });
  init();
})();