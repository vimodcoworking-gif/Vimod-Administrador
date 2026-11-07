// ===== Panel administrador VIMOD =====
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FMT = { day: '2-digit', month: 'short', year: 'numeric' };
const fecha = (d) => (d ? new Date(d).toLocaleDateString('es', FMT) : '—');
// Las fechas de licencia se guardan como día (UTC); se muestran sin desfase horario.
const fechaDia = (d) => (d ? new Date(d).toLocaleDateString('es', { ...FMT, timeZone: 'UTC' }) : '—');
const aInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const hoy = () => new Date().toISOString().slice(0, 10);
function sumarMeses(base, meses) {
  const d = base ? new Date(base + 'T00:00:00Z') : new Date();
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

const ESTADOS = {
  activa: 'Activa', suspendida: 'Suspendida', vencida: 'Vencida',
  pendiente: 'Pendiente', contactado: 'Contactado', atendida: 'Atendida', descartada: 'Descartada',
  activo: 'Activo', inactivo: 'Inactivo'
};
const insignia = (e) => `<span class="insignia insignia--${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;
const USUARIOS_POR_PLAN = { estandar: 3, premium: 15, enterprise: '' };

let config = {
  sitioUrl: '',
  planes: [{ id: 'estandar', nombre: 'Estándar' }, { id: 'premium', nombre: 'Premium' }, { id: 'enterprise', nombre: 'Enterprise' }]
};
const nombrePlan = (id) => (config.planes.find((p) => p.id === id) || {}).nombre || id;
let sistemas = [];
let vistaActual = {}; // datos de la vista abierta (para editar sin volver a pedirlos)
let filtroSolicitudes = 'pendiente';
let licenciaPendiente = null; // abrir el formulario de licencia al cargar el usuario
let navId = 0;

// ---- API ----
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/auth/login') {
    mostrarLogin();
    throw new Error(json.error || 'Sesión expirada');
  }
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

function aviso(texto, error = false) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.toggle('error', error);
  el.classList.add('visible');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('visible'), 2800);
}

// ---- Sesión ----
function mostrarLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  cerrarModal();
  $('#l-usuario').focus();
}

async function mostrarApp(usuario) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#adminNombre').textContent = usuario;
  try { config = await api('/config'); } catch { /* se usan los valores por defecto */ }
  navegar();
}

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const boton = $('button', f);
  boton.disabled = true;
  $('#estadoLogin').textContent = 'Verificando…';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { usuario: f.usuario.value, password: f.password.value } });
    f.reset();
    $('#estadoLogin').textContent = '';
    mostrarApp(r.usuario);
  } catch (err) {
    $('#estadoLogin').textContent = err.message;
  } finally {
    boton.disabled = false;
  }
});

$('#salir').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.hash = '';
  mostrarLogin();
});

$('#menuMovil').addEventListener('click', () => $('#app').classList.toggle('menu-abierto'));

// ---- Navegación ----
const rutas = { resumen: vistaResumen, usuarios: vistaUsuarios, usuario: vistaUsuario, sistemas: vistaSistemas, solicitudes: vistaSolicitudes, mensajes: vistaMensajes };

async function navegar() {
  if ($('#app').hidden) return;
  const [, ruta = 'resumen', id] = location.hash.split('/');
  const nombre = ruta === 'usuarios' && id ? 'usuario' : rutas[ruta] ? ruta : 'resumen';
  const menu = nombre === 'usuario' ? 'usuarios' : nombre;
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === menu));
  $('#app').classList.remove('menu-abierto');

  const mio = ++navId;
  const vista = $('#vista');
  vista.innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    const html = await rutas[nombre](id);
    if (mio !== navId) return;
    vista.innerHTML = html;
    if (nombre === 'usuario' && licenciaPendiente) {
      const datos = licenciaPendiente;
      licenciaPendiente = null;
      formLicencia(null, datos);
    }
  } catch (err) {
    if (mio === navId) vista.innerHTML = `<p class="cargando">${esc(err.message)}</p>`;
  }
  actualizarContadores();
}
window.addEventListener('hashchange', navegar);
const recargar = () => navegar();

async function actualizarContadores() {
  try {
    const c = await api('/contadores');
    $('#cSolicitudes').textContent = c.solicitudes || '';
    $('#cMensajes').textContent = c.mensajes || '';
  } catch { /* sin contadores */ }
}

async function cargarSistemas() {
  sistemas = await api('/sistemas');
  return sistemas;
}

const cabecera = (etiqueta, titulo, acciones = '') =>
  `<div class="cabecera"><div><span class="etiqueta">${etiqueta}</span><h1 class="titulo">${titulo}</h1></div>${acciones}</div>`;
const filaVacia = (cols, texto) => `<tr><td colspan="${cols}" class="tabla__vacia">${texto}</td></tr>`;
const tabla = (columnas, filas) =>
  `<div class="tabla-envoltura"><table class="tabla"><thead><tr>${columnas.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`;

// ===== Vistas =====
async function vistaResumen() {
  const r = await api('/resumen');
  const solicitudes = r.ultimasSolicitudes.map((s) => `
    <tr><td data-col="Fecha">${fecha(s.createdAt)}</td><td data-col="Cliente">${esc(s.nombre)}<small>${esc(s.email)}</small></td>
    <td data-col="Plan">${esc(nombrePlan(s.plan))}</td><td data-col="Estado">${insignia(s.estado || 'pendiente')}</td></tr>`).join('');
  const vencen = r.porVencer.map((l) => `
    <tr class="fila-link" data-accion="ir" data-href="#/usuarios/${l.usuario ? esc(l.usuario._id) : ''}">
    <td data-col="Cliente">${esc(l.usuario?.nombre || '—')}</td><td data-col="Sistema">${esc(l.sistema?.nombre || '—')}</td>
    <td data-col="Vence">${fechaDia(l.fechaVencimiento)}</td></tr>`).join('');

  return `
    ${cabecera('Panel', 'Resumen <strong>general</strong>', '<button class="btn" data-accion="nuevo-usuario">+ Nuevo usuario</button>')}
    <div class="tiles">
      <a class="tile" href="#/usuarios"><b>${r.usuarios}</b><span>Usuarios · ${r.usuariosActivos} activos</span></a>
      <div class="tile"><b>${r.licenciasActivas}</b><span>Licencias activas</span></div>
      <div class="tile"><b>${r.porVencer.length}</b><span>Vencen en 30 días</span></div>
      <a class="tile" href="#/solicitudes"><b>${r.solicitudesPendientes}</b><span>Solicitudes pendientes</span></a>
      <a class="tile" href="#/mensajes"><b>${r.mensajesSinLeer}</b><span>Mensajes sin leer</span></a>
    </div>
    <div class="dos-columnas">
      <div>
        <h2 class="subtitulo">Últimas solicitudes</h2>
        ${tabla(['Fecha', 'Cliente', 'Plan', 'Estado'], solicitudes || filaVacia(4, 'Sin solicitudes todavía.'))}
      </div>
      <div>
        <h2 class="subtitulo">Licencias por vencer</h2>
        ${tabla(['Cliente', 'Sistema', 'Vence'], vencen || filaVacia(3, 'Ninguna licencia vence en los próximos 30 días.'))}
      </div>
    </div>`;
}

// ---- Usuarios ----
async function tablaUsuarios(q) {
  const lista = await api('/usuarios' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const filas = lista.map((u) => `
    <tr class="fila-link" data-accion="ir" data-href="#/usuarios/${esc(u._id)}">
      <td data-col="Nombre">${esc(u.nombre)}${u.empresa ? `<small>${esc(u.empresa)}</small>` : ''}</td>
      <td data-col="Correo">${esc(u.email)}</td>
      <td data-col="Teléfono">${esc(u.telefono) || '—'}</td>
      <td data-col="Licencias">${u.licencias}</td>
      <td data-col="Estado">${insignia(u.activo ? 'activo' : 'inactivo')}</td>
      <td data-col="Último acceso">${fecha(u.ultimoAcceso)}</td>
    </tr>`).join('');
  return tabla(['Nombre', 'Correo', 'Teléfono', 'Licencias', 'Estado', 'Último acceso'],
    filas || filaVacia(6, q ? 'Sin resultados.' : 'Aún no hay usuarios. Crea el primero.'));
}

async function vistaUsuarios() {
  return `
    ${cabecera('Clientes', 'Usuarios', '<button class="btn" data-accion="nuevo-usuario">+ Nuevo usuario</button>')}
    <div class="herramientas"><input class="buscador" id="buscarUsuario" type="search" placeholder="Buscar por nombre, correo o empresa…"></div>
    <div id="tablaUsuarios">${await tablaUsuarios('')}</div>`;
}

async function vistaUsuario(id) {
  const [{ usuario: u, licencias, solicitudes }] = await Promise.all([api('/usuarios/' + id), cargarSistemas()]);
  vistaActual = { usuario: u, licencias: new Map(licencias.map((l) => [l._id, l])) };

  const filasLic = licencias.map((l) => `
    <tr>
      <td data-col="Sistema">${esc(l.sistema?.nombre || '—')}</td>
      <td data-col="Plan">${esc(nombrePlan(l.plan))}</td>
      <td data-col="Clave"><span class="clave">${esc(l.clave)}</span></td>
      <td data-col="Inicio">${fechaDia(l.fechaInicio)}</td>
      <td data-col="Vence">${l.fechaVencimiento ? fechaDia(l.fechaVencimiento) : 'Sin vencimiento'}</td>
      <td data-col="Usuarios">${l.maxUsuarios || 'Ilimitados'}</td>
      <td data-col="Estado">${insignia(l.estadoReal || l.estado)}</td>
      <td data-col="Acciones"><div class="acciones">
        <button class="btn btn--borde btn--chico" data-accion="editar-licencia" data-id="${esc(l._id)}">Editar</button>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-licencia" data-id="${esc(l._id)}">Eliminar</button>
      </div></td>
    </tr>`).join('');

  const filasSol = solicitudes.map((s) => `
    <tr><td data-col="Fecha">${fecha(s.createdAt)}</td><td data-col="Plan">${esc(nombrePlan(s.plan))}</td><td data-col="Estado">${insignia(s.estado || 'pendiente')}</td></tr>`).join('');

  const acceso = config.sitioUrl
    ? `<p class="texto-gris" style="margin-top:24px">El cliente inicia sesión en <a href="${esc(config.sitioUrl)}/acceder.html" target="_blank" rel="noopener">${esc(config.sitioUrl)}/acceder.html</a></p>`
    : '';

  return `
    <a class="volver" href="#/usuarios">← Usuarios</a>
    ${cabecera('Usuario', esc(u.nombre), `
      <div class="acciones">
        <button class="btn btn--borde btn--chico" data-accion="editar-usuario">Editar datos</button>
        <button class="btn btn--borde btn--chico" data-accion="clave-usuario">Cambiar contraseña</button>
        <button class="btn btn--borde btn--chico" data-accion="activar-usuario">${u.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-usuario">Eliminar</button>
      </div>`)}
    <div class="ficha">
      <div><b>Correo</b><span>${esc(u.email)}</span></div>
      <div><b>Empresa</b><span>${esc(u.empresa) || '—'}</span></div>
      <div><b>Teléfono</b><span>${esc(u.telefono) || '—'}</span></div>
      <div><b>Estado</b><span>${insignia(u.activo ? 'activo' : 'inactivo')}</span></div>
      <div><b>Cliente desde</b><span>${fecha(u.createdAt)}</span></div>
      <div><b>Último acceso</b><span>${fecha(u.ultimoAcceso)}</span></div>
    </div>
    <div class="cabecera" style="margin:40px 0 16px">
      <h2 class="subtitulo" style="margin:0">Licencias y sistemas</h2>
      <button class="btn btn--chico" data-accion="nueva-licencia">+ Asignar licencia</button>
    </div>
    ${tabla(['Sistema', 'Plan', 'Clave', 'Inicio', 'Vence', 'Usuarios', 'Estado', ''], filasLic || filaVacia(8, 'Este usuario aún no tiene licencias.'))}
    <h2 class="subtitulo">Solicitudes con este correo</h2>
    ${tabla(['Fecha', 'Plan', 'Estado'], filasSol || filaVacia(3, 'Sin solicitudes.'))}
    ${acceso}`;
}

// ---- Sistemas ----
async function vistaSistemas() {
  await cargarSistemas();
  vistaActual = { sistemas: new Map(sistemas.map((s) => [s._id, s])) };
  const tarjetas = sistemas.map((s) => `
    <article class="sistema">
      <div class="sistema__cabecera"><h3>${esc(s.nombre)}</h3>${insignia(s.activo ? 'activo' : 'inactivo')}</div>
      <p>${esc(s.descripcion) || 'Sin descripción.'}</p>
      <span class="sistema__url">${s.url ? esc(s.url) : 'Sin enlace de acceso'}</span>
      <span class="texto-gris">${s.licencias} licencia(s)</span>
      <div class="acciones">
        <button class="btn btn--borde btn--chico" data-accion="editar-sistema" data-id="${esc(s._id)}">Editar</button>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-sistema" data-id="${esc(s._id)}">Eliminar</button>
      </div>
    </article>`).join('');
  return `
    ${cabecera('Catálogo', 'Sistemas', '<button class="btn" data-accion="nuevo-sistema">+ Nuevo sistema</button>')}
    <p class="texto-gris" style="margin-bottom:20px">Los sistemas que vendes. Al asignar una licencia, el cliente verá el sistema en su cuenta con el botón “Abrir sistema”.</p>
    <div class="sistemas">${tarjetas || '<p class="texto-gris">No hay sistemas. Crea el primero.</p>'}</div>`;
}

// ---- Solicitudes ----
async function vistaSolicitudes() {
  const lista = await api('/solicitudes' + (filtroSolicitudes ? '?estado=' + filtroSolicitudes : ''));
  vistaActual = { solicitudes: new Map(lista.map((s) => [s._id, s])) };
  const opciones = (actual) => ['pendiente', 'contactado', 'atendida', 'descartada']
    .map((e) => `<option value="${e}" ${e === actual ? 'selected' : ''}>${ESTADOS[e]}</option>`).join('');
  const filas = lista.map((s) => `
    <tr>
      <td data-col="Fecha">${fecha(s.createdAt)}</td>
      <td data-col="Cliente">${esc(s.nombre)}${s.empresa ? `<small>${esc(s.empresa)}</small>` : ''}</td>
      <td data-col="Contacto">${esc(s.email)}${s.telefono ? `<small>${esc(s.telefono)}</small>` : ''}</td>
      <td data-col="Plan">${esc(nombrePlan(s.plan))}</td>
      <td data-col="Estado"><select data-cambio="estado-solicitud" data-id="${esc(s._id)}">${opciones(s.estado)}</select></td>
      <td data-col="Acciones"><div class="acciones">
        ${s.usuarioId
          ? `<a class="btn btn--borde btn--chico" href="#/usuarios/${esc(s.usuarioId)}">Ver usuario</a>`
          : `<button class="btn btn--chico" data-accion="crear-cuenta" data-id="${esc(s._id)}">Crear cuenta</button>`}
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-solicitud" data-id="${esc(s._id)}">Eliminar</button>
      </div></td>
    </tr>`).join('');
  const filtros = [['pendiente', 'Pendientes'], ['', 'Todas'], ['contactado', 'Contactadas'], ['atendida', 'Atendidas'], ['descartada', 'Descartadas']]
    .map(([v, t]) => `<button data-accion="filtro-solicitudes" data-estado="${v}" class="${v === filtroSolicitudes ? 'activo' : ''}">${t}</button>`).join('');
  return `
    ${cabecera('Página de planes', 'Solicitudes')}
    <div class="herramientas"><div class="filtros">${filtros}</div></div>
    ${tabla(['Fecha', 'Cliente', 'Contacto', 'Plan', 'Estado', ''], filas || filaVacia(6, 'No hay solicitudes en esta categoría.'))}`;
}

// ---- Mensajes ----
async function vistaMensajes() {
  const lista = await api('/mensajes');
  const filas = lista.map((m) => `
    <tr class="${m.leido ? '' : 'no-leido'}">
      <td data-col="Fecha">${fecha(m.createdAt)}</td>
      <td data-col="De">${esc(m.nombre)}<small>${esc(m.email)}</small></td>
      <td data-col="Mensaje"><div class="mensaje-texto">${esc(m.mensaje)}</div></td>
      <td data-col="Acciones"><div class="acciones">
        <a class="btn btn--borde btn--chico" href="mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: tu mensaje a VIMOD')}">Responder</a>
        <button class="btn btn--borde btn--chico" data-accion="leido" data-id="${esc(m._id)}" data-leido="${m.leido ? '' : '1'}">${m.leido ? 'No leído' : 'Leído'}</button>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-mensaje" data-id="${esc(m._id)}">Eliminar</button>
      </div></td>
    </tr>`).join('');
  return `
    ${cabecera('Formulario de contacto', 'Mensajes')}
    ${tabla(['Fecha', 'De', 'Mensaje', ''], filas || filaVacia(4, 'No hay mensajes.'))}`;
}

// ===== Modal y formularios =====
let alEnviar = null;
function abrirModal(html, onSubmit) {
  $('#modalCuerpo').innerHTML = html;
  alEnviar = onSubmit;
  $('#modal').classList.add('abierto');
  const primero = $('#modalCuerpo input:not([type=hidden]), #modalCuerpo select, #modalCuerpo button');
  if (primero) primero.focus();
}
function cerrarModal() {
  $('#modal').classList.remove('abierto');
  alEnviar = null;
}
$('#modalCerrar').addEventListener('click', cerrarModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

$('#modalCuerpo').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!alEnviar) return;
  const form = e.target;
  const datos = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type=checkbox]').forEach((c) => (datos[c.name] = c.checked));
  const boton = $('button[type=submit]', form);
  const estado = $('.estado', form);
  boton.disabled = true;
  estado.textContent = 'Guardando…';
  try {
    await alEnviar(datos, form);
  } catch (err) {
    estado.textContent = err.message;
  } finally {
    boton.disabled = false;
  }
});

function generarClave() {
  const letras = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const n = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(n, (x) => letras[x % letras.length]).join('');
}

function formUsuario(u, desdeSolicitud) {
  const base = u || desdeSolicitud || {};
  abrirModal(`
    <span class="etiqueta">${u ? 'Editar usuario' : 'Nuevo usuario'}</span>
    <h2 class="titulo">${u ? 'Datos del <strong>cliente</strong>' : 'Crear <strong>cuenta</strong>'}</h2>
    <form class="form">
      <div class="campo"><label>Nombre</label><input name="nombre" required maxlength="120" value="${esc(base.nombre)}"></div>
      <div class="campo"><label>Correo (usuario de acceso)</label><input name="email" type="email" required value="${esc(base.email)}"></div>
      <div class="form__fila">
        <div class="campo"><label>Empresa</label><input name="empresa" maxlength="160" value="${esc(base.empresa)}"></div>
        <div class="campo"><label>Teléfono</label><input name="telefono" maxlength="40" value="${esc(base.telefono)}"></div>
      </div>
      ${u
        ? `<label class="check"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''}> Cuenta activa (puede iniciar sesión)</label>`
        : `<div class="campo"><label>Contraseña inicial</label>
             <div class="campo__con-boton"><input name="password" required minlength="8" value="${generarClave()}">
             <button class="btn btn--borde btn--chico" type="button" data-accion="generar-clave">Generar</button></div></div>`}
      <button class="btn" type="submit">${u ? 'Guardar cambios' : 'Crear cuenta'}</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    if (u) {
      await api('/usuarios/' + u._id, { method: 'PUT', body: datos });
      cerrarModal();
      aviso('Usuario actualizado');
      recargar();
      return;
    }
    const nuevo = await api('/usuarios', { method: 'POST', body: datos });
    if (desdeSolicitud) {
      await api('/solicitudes/' + desdeSolicitud._id, { method: 'PUT', body: { estado: 'atendida' } }).catch(() => {});
    }
    mostrarCredenciales(nuevo, datos.password, desdeSolicitud && desdeSolicitud.plan);
  });
}

function mostrarCredenciales(usuario, password, plan) {
  const url = config.sitioUrl ? config.sitioUrl + '/acceder.html' : '(URL de VIMOD PRESENTACION)/acceder.html';
  const texto = `Acceso a tu cuenta VIMOD\nIngresa en: ${url}\nCorreo: ${usuario.email}\nContraseña: ${password}\nTe recomendamos cambiar la contraseña desde "Mi perfil".`;
  abrirModal(`
    <span class="etiqueta">Cuenta creada</span>
    <h2 class="titulo">Datos de <strong>acceso</strong></h2>
    <p class="texto-gris" style="margin-bottom:16px">Comparte estos datos con el cliente. La contraseña no se volverá a mostrar.</p>
    <div class="credenciales">
      <div>Acceso: <code>${esc(url)}</code></div>
      <div>Correo: <code>${esc(usuario.email)}</code></div>
      <div>Contraseña: <code>${esc(password)}</code></div>
    </div>
    <div class="acciones" style="margin-top:20px">
      <button class="btn btn--borde" type="button" data-accion="copiar" data-copiar="${esc(texto)}">Copiar datos</button>
      <button class="btn" type="button" data-accion="asignar-tras-crear" data-id="${esc(usuario._id)}" data-plan="${esc(plan || '')}">Asignar licencia <span class="flecha">→</span></button>
    </div>`);
}

function formClaveUsuario(u) {
  abrirModal(`
    <span class="etiqueta">${esc(u.email)}</span>
    <h2 class="titulo">Nueva <strong>contraseña</strong></h2>
    <form class="form">
      <div class="campo"><label>Contraseña</label>
        <div class="campo__con-boton"><input name="password" required minlength="8" value="${generarClave()}">
        <button class="btn btn--borde btn--chico" type="button" data-accion="generar-clave">Generar</button></div></div>
      <button class="btn" type="submit">Guardar</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    await api(`/usuarios/${u._id}/password`, { method: 'PUT', body: datos });
    mostrarCredencialesClave(u, datos.password);
  });
}

function mostrarCredencialesClave(u, password) {
  const texto = `Tu nueva contraseña de VIMOD es: ${password}`;
  abrirModal(`
    <span class="etiqueta">Contraseña actualizada</span>
    <h2 class="titulo">Nueva <strong>contraseña</strong></h2>
    <div class="credenciales"><div>Correo: <code>${esc(u.email)}</code></div><div>Contraseña: <code>${esc(password)}</code></div></div>
    <div class="acciones" style="margin-top:20px"><button class="btn" type="button" data-accion="copiar" data-copiar="${esc(texto)}">Copiar</button></div>`);
}

function formLicencia(l, prefill = {}) {
  const u = vistaActual.usuario;
  const disponibles = sistemas.filter((s) => s.activo || (l && String(l.sistema?._id) === String(s._id)));
  if (!disponibles.length) {
    abrirModal(`<span class="etiqueta">Licencias</span><h2 class="titulo">No hay <strong>sistemas</strong></h2>
      <p class="texto-gris" style="margin-bottom:20px">Primero crea un sistema en el catálogo.</p>
      <a class="btn" href="#/sistemas" data-accion="cerrar-modal">Ir a Sistemas</a>`);
    return;
  }
  const plan = l?.plan || prefill.plan || 'estandar';
  const sistemaActual = l?.sistema?._id || disponibles[0]._id;
  const opt = (lista, actual) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(actual) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const maxUsuarios = l ? l.maxUsuarios ?? '' : USUARIOS_POR_PLAN[plan];

  abrirModal(`
    <span class="etiqueta">${esc(u.nombre)}</span>
    <h2 class="titulo">${l ? 'Editar' : 'Asignar'} <strong>licencia</strong></h2>
    <form class="form" id="formLicencia">
      <div class="form__fila">
        <div class="campo"><label>Sistema</label><select name="sistema">${opt(disponibles.map((s) => [s._id, s.nombre]), sistemaActual)}</select></div>
        <div class="campo"><label>Plan</label><select name="plan" data-cambio="plan-licencia">${opt(config.planes.map((p) => [p.id, p.nombre]), plan)}</select></div>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Inicio</label><input name="fechaInicio" type="date" value="${l ? aInput(l.fechaInicio) : hoy()}"></div>
        <div class="campo"><label>Vencimiento (vacío = sin vencimiento)</label><input name="fechaVencimiento" type="date" value="${l ? aInput(l.fechaVencimiento) : sumarMeses(hoy(), 1)}"></div>
      </div>
      <div class="acciones">
        <button class="btn btn--borde btn--chico" type="button" data-accion="vence-mas" data-meses="1">+1 mes</button>
        <button class="btn btn--borde btn--chico" type="button" data-accion="vence-mas" data-meses="6">+6 meses</button>
        <button class="btn btn--borde btn--chico" type="button" data-accion="vence-mas" data-meses="12">+1 año</button>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Máx. usuarios (vacío = ilimitados)</label><input name="maxUsuarios" type="number" min="1" value="${esc(maxUsuarios)}"></div>
        <div class="campo"><label>Estado</label><select name="estado">${opt([['activa', 'Activa'], ['suspendida', 'Suspendida'], ['vencida', 'Vencida']], l?.estado || 'activa')}</select></div>
      </div>
      <div class="campo"><label>Notas internas (el cliente no las ve)</label><textarea name="notas" maxlength="1000">${esc(l?.notas)}</textarea></div>
      ${l ? `<p class="texto-gris">Clave: <span class="clave">${esc(l.clave)}</span></p>` : '<p class="texto-gris">La clave de licencia se genera automáticamente.</p>'}
      <button class="btn" type="submit">${l ? 'Guardar cambios' : 'Asignar licencia'}</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    if (l) await api('/licencias/' + l._id, { method: 'PUT', body: datos });
    else await api('/licencias', { method: 'POST', body: { ...datos, usuario: u._id } });
    cerrarModal();
    aviso(l ? 'Licencia actualizada' : 'Licencia asignada');
    recargar();
  });
}

function formSistema(s) {
  abrirModal(`
    <span class="etiqueta">Catálogo</span>
    <h2 class="titulo">${s ? 'Editar' : 'Nuevo'} <strong>sistema</strong></h2>
    <form class="form">
      <div class="campo"><label>Nombre</label><input name="nombre" required maxlength="120" value="${esc(s?.nombre)}"></div>
      <div class="campo"><label>Descripción (la ve el cliente)</label><textarea name="descripcion" maxlength="600">${esc(s?.descripcion)}</textarea></div>
      <div class="campo"><label>Enlace de acceso al sistema</label><input name="url" type="url" placeholder="https://…" maxlength="300" value="${esc(s?.url)}"></div>
      <label class="check"><input type="checkbox" name="activo" ${!s || s.activo ? 'checked' : ''}> Disponible para asignar licencias</label>
      <button class="btn" type="submit">Guardar</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    if (s) await api('/sistemas/' + s._id, { method: 'PUT', body: datos });
    else await api('/sistemas', { method: 'POST', body: datos });
    cerrarModal();
    aviso('Sistema guardado');
    recargar();
  });
}

async function confirmarYBorrar(pregunta, url, mensaje, despues = recargar) {
  if (!confirm(pregunta)) return;
  try {
    await api(url, { method: 'DELETE' });
    aviso(mensaje);
    despues();
  } catch (err) {
    aviso(err.message, true);
  }
}

// ===== Acciones (delegación de eventos) =====
const acciones = {
  'ir': (el) => { location.hash = el.dataset.href; },
  'cerrar-modal': () => cerrarModal(),
  'nuevo-usuario': () => formUsuario(null),
  'editar-usuario': () => formUsuario(vistaActual.usuario),
  'clave-usuario': () => formClaveUsuario(vistaActual.usuario),
  'activar-usuario': async () => {
    const u = vistaActual.usuario;
    await api('/usuarios/' + u._id, { method: 'PUT', body: { activo: !u.activo } });
    aviso(u.activo ? 'Usuario desactivado: ya no podrá iniciar sesión' : 'Usuario activado');
    recargar();
  },
  'eliminar-usuario': () => {
    const u = vistaActual.usuario;
    confirmarYBorrar(`¿Eliminar a ${u.nombre} y todas sus licencias? Esta acción no se puede deshacer.`,
      '/usuarios/' + u._id, 'Usuario eliminado', () => { location.hash = '#/usuarios'; });
  },
  'nueva-licencia': () => formLicencia(null),
  'editar-licencia': (el) => formLicencia(vistaActual.licencias.get(el.dataset.id)),
  'eliminar-licencia': (el) => confirmarYBorrar('¿Eliminar esta licencia? El cliente dejará de verla.', '/licencias/' + el.dataset.id, 'Licencia eliminada'),
  'nuevo-sistema': () => formSistema(null),
  'editar-sistema': (el) => formSistema(vistaActual.sistemas.get(el.dataset.id)),
  'eliminar-sistema': (el) => confirmarYBorrar('¿Eliminar este sistema?', '/sistemas/' + el.dataset.id, 'Sistema eliminado'),
  'crear-cuenta': (el) => formUsuario(null, vistaActual.solicitudes.get(el.dataset.id)),
  'eliminar-solicitud': (el) => confirmarYBorrar('¿Eliminar esta solicitud?', '/solicitudes/' + el.dataset.id, 'Solicitud eliminada'),
  'filtro-solicitudes': (el) => { filtroSolicitudes = el.dataset.estado; recargar(); },
  'leido': async (el) => {
    await api('/mensajes/' + el.dataset.id, { method: 'PUT', body: { leido: !!el.dataset.leido } });
    recargar();
  },
  'eliminar-mensaje': (el) => confirmarYBorrar('¿Eliminar este mensaje?', '/mensajes/' + el.dataset.id, 'Mensaje eliminado'),
  'asignar-tras-crear': (el) => {
    cerrarModal();
    licenciaPendiente = { plan: el.dataset.plan || undefined };
    const destino = '#/usuarios/' + el.dataset.id;
    if (location.hash === destino) recargar();
    else location.hash = destino;
  },
  'generar-clave': (el) => { el.previousElementSibling.value = generarClave(); },
  'vence-mas': (el) => {
    const f = el.closest('form');
    f.fechaVencimiento.value = sumarMeses(f.fechaInicio.value || hoy(), Number(el.dataset.meses));
  },
  'copiar': async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.copiar);
      aviso('Copiado al portapapeles');
    } catch {
      aviso('No se pudo copiar', true);
    }
  }
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el || !acciones[el.dataset.accion]) return;
  if (el.tagName === 'BUTTON' || el.dataset.accion === 'ir') e.preventDefault();
  try {
    await acciones[el.dataset.accion](el);
  } catch (err) {
    aviso(err.message, true);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.cambio === 'estado-solicitud') {
    try {
      await api('/solicitudes/' + el.dataset.id, { method: 'PUT', body: { estado: el.value } });
      aviso('Estado actualizado');
      actualizarContadores();
    } catch (err) {
      aviso(err.message, true);
    }
  }
  if (el.dataset.cambio === 'plan-licencia') {
    const campo = el.form.maxUsuarios;
    campo.value = USUARIOS_POR_PLAN[el.value] ?? '';
  }
});

let tBusqueda;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'buscarUsuario') return;
  clearTimeout(tBusqueda);
  tBusqueda = setTimeout(async () => {
    try {
      $('#tablaUsuarios').innerHTML = await tablaUsuarios(e.target.value.trim());
    } catch (err) {
      aviso(err.message, true);
    }
  }, 250);
});

// ===== Inicio =====
(async () => {
  try {
    const yo = await api('/auth/yo');
    mostrarApp(yo.usuario);
  } catch {
    if ($('#app').hidden) mostrarLogin();
  }
})();
