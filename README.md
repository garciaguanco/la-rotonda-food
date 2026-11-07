# La Rotonda Food — primera versión

Aplicación web/PWA para tomar pedidos online y presenciales, recibirlos en una consola de cocina y administrar el menú.

## Incluye
- Menú público con categorías.
- Carrito y personalización por producto.
- Pedidos para retirar o consumir en el local (mesa requerida).
- Pago presencial.
- Creación segura de pedidos mediante función SQL: el servidor vuelve a calcular los precios.
- Seguimiento del pedido con token privado.
- Consola privada para cocina con actualización Realtime.
- Gestión básica de productos para usuarios administradores.
- Diseño adaptable a celulares, tablets y computadoras.

## 1. Crear Supabase
1. Crear un proyecto en https://supabase.com.
2. Abrir SQL Editor y ejecutar `supabase/schema.sql`.
3. En Project Settings > API copiar Project URL y la clave `anon`/publishable.
4. Pegarlas en `js/config.js`. Nunca usar `service_role` en el navegador.

## 2. Crear el usuario administrador
1. En Supabase > Authentication > Users, crear un usuario con email y contraseña.
2. Copiar su UUID.
3. En SQL Editor ejecutar:
   ```sql
   insert into public.user_roles(user_id, role)
   values ('UUID_DEL_USUARIO', 'admin');
   ```
4. Para crear un usuario de cocina, repetir con `role = 'kitchen'`.

La consola está en `admin.html`. El usuario `kitchen` ve Cocina; el usuario `admin` también puede administrar Productos.

## 3. Ejecutar localmente
No abrir los archivos con `file://`. Usar un servidor local, por ejemplo con VS Code Live Server o:
```bash
python -m http.server 5500
```
Luego abrir `http://localhost:5500`.

## 4. Publicar
Subir el contenido del proyecto a GitHub y conectarlo a Netlify o Vercel. La URL pública será la del menú. La consola privada estará en `/admin.html`.

## 5. QR presencial
Crear un QR que apunte a la URL pública del menú. El cliente elige “Consumir en el local” e ingresa el número de mesa. Si el Food Truck no usa mesas numeradas, se puede adaptar el formulario para usar un código de retiro o “mostrador”.

## Importante antes de operar
- Cambiar los productos y precios de ejemplo.
- Revisar las políticas RLS en Supabase.
- Crear usuarios con contraseñas seguras.
- Probar pedidos de punta a punta con dos dispositivos.
- Configurar respaldo y revisar la conexión Wi-Fi de la tablet.
- Para uso real, agregar controles de apertura/cierre, cancelaciones y protección contra spam/rate limiting.
- El seguimiento se realiza por token privado; el cliente debe guardar el código que se muestra al enviar el pedido.
- La PWA usa caché para archivos estáticos, pero los pedidos requieren conexión a Internet.

## Estructura
```text
la-rotonda-food/
├── index.html
├── admin.html
├── manifest.json
├── service-worker.js
├── css/styles.css
├── js/config.js
├── js/store.js
├── js/customer.js
├── js/admin.js
├── supabase/schema.sql
└── README.md
```
