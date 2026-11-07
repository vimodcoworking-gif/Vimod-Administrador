# VIMOD – Panel administrador

Panel para administrar los clientes de **VIMOD PRESENTACION**. Comparte la misma base de datos de MongoDB:
lo que se crea aquí es lo que el cliente ve en **Acceder → Mi cuenta** de la página de presentación.

- **Usuarios:** crear cuentas de clientes, editar datos, activar/desactivar, cambiar contraseña.
- **Licencias:** asignar sistemas a cada usuario con plan, clave, fechas, número de usuarios y estado.
- **Sistemas:** catálogo de softwares (nombre, descripción y enlace de acceso).
- **Solicitudes:** solicitudes de planes enviadas desde la página; crear la cuenta del cliente con un clic.
- **Mensajes:** mensajes del formulario de contacto.

## Ejecutar en local

```bash
npm install
cp .env.example .env     # y completa los valores
npm run dev
```

Abre http://localhost:4000

## Variables de entorno

| Variable         | Descripción                                                        |
|------------------|--------------------------------------------------------------------|
| `MONGODB_URI`    | Cadena de MongoDB Atlas — **la misma** que VIMOD PRESENTACION      |
| `ADMIN_USUARIO`  | Usuario para entrar al panel                                       |
| `ADMIN_PASSWORD` | Contraseña para entrar al panel                                    |
| `SESSION_SECRET` | Texto largo y aleatorio para firmar la sesión                      |
| `SITIO_URL`      | URL pública de VIMOD PRESENTACION (ej. `https://vimod-sistemas.onrender.com`) |

## Desplegar en Render

**New → Web Service**, elige este repositorio y configura:

- Language: **Node**
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Environment: las variables de la tabla anterior

## Flujo de trabajo

1. Un cliente envía una solicitud desde la página de planes.
2. En **Solicitudes** pulsa **Crear cuenta**: se rellena con sus datos y se genera una contraseña.
3. Copia los datos de acceso y envíaselos al cliente.
4. Pulsa **Asignar licencia** y elige sistema, plan y vencimiento.
5. El cliente entra en **Acceder** y ve sus sistemas, licencias y solicitudes.
