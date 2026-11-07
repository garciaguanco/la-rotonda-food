-- LA ROTONDA FOOD · Esquema inicial Supabase
-- Ejecutar completo en Supabase > SQL Editor.
-- Después crear usuarios desde Authentication y asignarles rol en user_roles.

create extension if not exists pgcrypto;

create type public.order_status as enum ('new','accepted','preparing','ready','delivered','cancelled');
create type public.order_type as enum ('pickup','dine_in');

create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','kitchen')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(12,2) not null check (price > 0),
  image_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null unique default nextval('public.order_number_seq'),
  access_token uuid not null unique default gen_random_uuid(),
  customer_name text not null,
  order_type public.order_type not null,
  table_number text,
  customer_notes text,
  status public.order_status not null default 'new',
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dine_in_table_required check (order_type <> 'dine_in' or nullif(trim(table_number),'') is not null)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 20),
  unit_price numeric(12,2) not null check (unit_price > 0),
  notes text,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  old_status public.order_status,
  new_status public.order_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'La Rotonda Food',
  logo_url text,
  accepting_orders boolean not null default true,
  opening_message text,
  updated_at timestamptz not null default now()
);
insert into public.settings(id) values (1) on conflict (id) do nothing;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','kitchen')); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'); $$;

-- Un cliente puede crear un pedido, pero no decide precios ni totales.
create or replace function public.create_order(
  p_customer_name text,
  p_order_type text,
  p_table_number text,
  p_customer_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_notes text;
  v_subtotal numeric(12,2) := 0;
  v_count integer := 0;
  v_settings public.settings;
begin
  select * into v_settings from public.settings where id = 1;
  if not coalesce(v_settings.accepting_orders,true) then
    raise exception 'En este momento no estamos recibiendo pedidos.';
  end if;
  if length(trim(coalesce(p_customer_name,''))) < 2 or length(p_customer_name) > 80 then
    raise exception 'Ingresá un nombre válido.';
  end if;
  if p_order_type not in ('pickup','dine_in') then raise exception 'Tipo de pedido inválido.'; end if;
  if p_order_type = 'dine_in' and nullif(trim(coalesce(p_table_number,'')),'') is null then
    raise exception 'Indicá la mesa para consumir en el local.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido debe tener entre 1 y 30 líneas.';
  end if;

  insert into public.orders(customer_name,order_type,table_number,customer_notes)
  values (trim(p_customer_name),p_order_type::public.order_type,
          case when p_order_type='dine_in' then trim(p_table_number) else null end,
          left(trim(coalesce(p_customer_notes,'')),300))
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_count := v_count + 1;
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 20 then raise exception 'Cantidad inválida.'; end if;
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and is_active = true;
    if not found then raise exception 'Uno de los productos ya no está disponible.'; end if;
    v_notes := left(trim(coalesce(v_item->>'notes','')),250);
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,notes)
    values (v_order.id,v_product.id,v_product.name,v_qty,v_product.price,v_notes);
    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  if v_count = 0 then raise exception 'El pedido está vacío.'; end if;
  update public.orders set subtotal=v_subtotal,total=v_subtotal where id=v_order.id returning * into v_order;
  insert into public.order_status_history(order_id,new_status) values (v_order.id,'new');
  return jsonb_build_object('order_number',v_order.order_number,'access_token',v_order.access_token,'status',v_order.status);
end;
$$;

-- El cliente consulta únicamente el estado de su pedido usando su token privado.
create or replace function public.get_order_status(p_access_token uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where access_token=p_access_token;
  if not found then return null; end if;
  return jsonb_build_object('order_number',v_order.order_number,'status',v_order.status,'created_at',v_order.created_at);
end;
$$;

create or replace function public.log_order_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.updated_at := now();
    insert into public.order_status_history(order_id,old_status,new_status,changed_by)
    values (new.id,old.status,new.status,auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_order_status_history on public.orders;
create trigger trg_order_status_history before update of status on public.orders
for each row execute function public.log_order_status();

alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.settings enable row level security;

create policy "staff reads own role" on public.user_roles for select to authenticated using (user_id=auth.uid());
create policy "public reads active categories" on public.categories for select to anon,authenticated using (is_active=true);
create policy "admin manages categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public reads active products" on public.products for select to anon,authenticated using (is_active=true);
create policy "admin manages products" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "staff reads orders" on public.orders for select to authenticated using (public.is_staff());
create policy "staff updates orders" on public.orders for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff reads order items" on public.order_items for select to authenticated using (public.is_staff());
create policy "staff reads history" on public.order_status_history for select to authenticated using (public.is_staff());
create policy "public reads settings" on public.settings for select to anon,authenticated using (true);
create policy "admin updates settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.products, public.settings to anon, authenticated;
grant select on public.user_roles, public.orders, public.order_items, public.order_status_history to authenticated;
revoke update on public.orders from authenticated;
grant update (status) on public.orders to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.settings to authenticated;
grant usage, select on sequence public.order_number_seq to anon, authenticated;
revoke all on function public.create_order(text,text,text,text,jsonb) from public;
revoke all on function public.get_order_status(uuid) from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.create_order(text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.get_order_status(uuid) to anon, authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Realtime para que la consola vea cambios sin recargar.
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
when undefined_object then raise notice 'Verificá que exista la publicación supabase_realtime.';
end $$;

-- Datos iniciales opcionales para probar el menú.
insert into public.categories(name,sort_order) values
 ('Hamburguesas',1),('Acompañamientos',2),('Bebidas',3)
on conflict (name) do nothing;

insert into public.products(name,description,price,category_id,sort_order)
select 'Hamburguesa clásica','Carne, queso, lechuga, tomate y nuestra salsa.',320,id,1 from public.categories where name='Hamburguesas'
and not exists (select 1 from public.products where name='Hamburguesa clásica');
insert into public.products(name,description,price,category_id,sort_order)
select 'Hamburguesa La Rotonda','Doble carne, doble queso y cebolla caramelizada.',430,id,2 from public.categories where name='Hamburguesas'
and not exists (select 1 from public.products where name='Hamburguesa La Rotonda');
insert into public.products(name,description,price,category_id,sort_order)
select 'Papas fritas','Porción crocante para compartir.',180,id,1 from public.categories where name='Acompañamientos'
and not exists (select 1 from public.products where name='Papas fritas');
insert into public.products(name,description,price,category_id,sort_order)
select 'Refresco','Bebida fría individual.',100,id,1 from public.categories where name='Bebidas'
and not exists (select 1 from public.products where name='Refresco');

-- Luego de crear un usuario en Authentication, asignale acceso ejecutando:
-- insert into public.user_roles(user_id,role) values ('UUID_DEL_USUARIO','admin');
-- Para un cocinero: role = 'kitchen'.
