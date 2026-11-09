// ===== Panel administrador VIMOD =====
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
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
const precioTexto = (p) => (p.precio == null ? 'A medida' : `$${p.precio}${p.periodo ? ' / ' + p.periodo : ''}`);

const ESTADOS = {
  activa: 'Activa', suspendida: 'Suspendida', vencida: 'Vencida',
  pendiente: 'Pendiente', contactado: 'Contactado', atendida: 'Atendida', descartada: 'Descartada',
  activo: 'Activo', inactivo: 'Inactivo', publicado: 'Publicado', oculto: 'Oculto'
};
const insignia = (e) => `<span class="insignia insignia--${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

let config = { sitioUrl: '' };
let sistemas = [];
let vistaActual = {}; // datos de la vista abierta (para editar sin volver a pedirlos)
let filtroSolicitudes = 'pendiente';
let licenciaPendiente = null; // abrir el formulario de licencia al cargar el usuario
let navId = 0;
let hayCambios = false; // cambios sin guardar en un editor

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
  aviso.t = setTimeout(() => el.classList.remove('visible'), 3000);
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
  hayCambios = false;
  location.hash = '';
  mostrarLogin();
});

$('#menuMovil').addEventListener('click', () => $('#app').classList.toggle('menu-abierto'));

// ---- Navegación ----
const rutas = {
  resumen: vistaResumen, usuarios: vistaUsuarios, usuario: vistaUsuario,
  sistemas: vistaSistemas, sistema: vistaSistema, contenido: vistaContenido, servidor: vistaServidor,
  solicitudes: vistaSolicitudes, mensajes: vistaMensajes
};
let hashAnterior = location.hash;

async function navegar() {
  if ($('#app').hidden) return;
  if (hayCambios && location.hash !== hashAnterior) {
    if (!confirm('Tienes cambios sin guardar. ¿Salir sin guardar?')) {
      history.replaceState(null, '', hashAnterior);
      return;
    }
  }
  hayCambios = false;
  hashAnterior = location.hash;

  const [, ruta = 'resumen', id] = location.hash.split('/');
  let nombre = rutas[ruta] ? ruta : 'resumen';
  if (ruta === 'usuarios' && id) nombre = 'usuario';
  if (ruta === 'sistemas' && id) nombre = 'sistema';
  const menu = { usuario: 'usuarios', sistema: 'sistemas' }[nombre] || nombre;
  $$('#menu a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === menu));
  $('#app').classList.remove('menu-abierto');

  const mio = ++navId;
  const vista = $('#vista');
  vista.innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    const html = await rutas[nombre](id);
    if (mio !== navId) return;
    vista.innerHTML = html;
    window.scrollTo(0, 0);
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
window.addEventListener('beforeunload', (e) => { if (hayCambios) e.preventDefault(); });
const recargar = () => { hayCambios = false; navegar(); };

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
const enlaceWeb = (ruta, texto = 'Ver en la web') =>
  config.sitioUrl ? `<a class="btn btn--borde btn--chico" href="${esc(config.sitioUrl + ruta)}" target="_blank" rel="noopener">${texto} ↗</a>` : '';

// ===== Vistas =====
async function vistaResumen() {
  const r = await api('/resumen');
  const solicitudes = r.ultimasSolicitudes.map((s) => `
    <tr><td data-col="Fecha">${fecha(s.createdAt)}</td><td data-col="Cliente">${esc(s.nombre)}<small>${esc(s.email)}</small></td>
    <td data-col="Plan">${esc(s.planNombre)}${s.sistemaNombre ? `<small>${esc(s.sistemaNombre)}</small>` : ''}</td>
    <td data-col="Estado">${insignia(s.estado || 'pendiente')}</td></tr>`).join('');
  const vencen = r.porVencer.map((l) => `
    <tr class="fila-link" data-accion="ir" data-href="#/usuarios/${l.usuario ? esc(l.usuario._id) : ''}">
    <td data-col="Cliente">${esc(l.usuario?.nombre || '—')}</td><td data-col="Software">${esc(l.sistemaNombre || '—')}</td>
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
        ${tabla(['Cliente', 'Software', 'Vence'], vencen || filaVacia(3, 'Ninguna licencia vence en los próximos 30 días.'))}
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
  const [{ usuario: u, licencias, solicitudes, empresas = [] }] = await Promise.all([api('/usuarios/' + id), cargarSistemas()]);
  vistaActual = {
    usuario: u,
    licencias: new Map(licencias.map((l) => [l._id, l])),
    empresas: new Map(empresas.map((e) => [e._id, e]))
  };
  const licConEmpresa = new Set(empresas.map((e) => String(e.licencia || '')));

  const filasLic = licencias.map((l) => `
    <tr>
      <td data-col="Software">${esc(l.sistemaNombre || '—')}</td>
      <td data-col="Plan">${esc(l.planNombre)}</td>
      <td data-col="Precio">${l.precio != null ? esc(precioTexto(l)) : '—'}</td>
      <td data-col="Clave"><span class="clave">${esc(l.clave)}</span></td>
      <td data-col="Inicio">${fechaDia(l.fechaInicio)}</td>
      <td data-col="Vence">${l.fechaVencimiento ? fechaDia(l.fechaVencimiento) : 'Sin vencimiento'}</td>
      <td data-col="Usuarios">${l.maxUsuarios || 'Ilimitados'}</td>
      <td data-col="Estado">${insignia(l.estadoReal || l.estado)}</td>
      <td data-col="Acciones"><div class="acciones">
        ${licConEmpresa.has(String(l._id)) ? '' : `<button class="btn btn--chico" data-accion="nueva-empresa" data-licencia="${esc(l._id)}" title="Crear el sistema VIMOD CONTROL de esta empresa en el servidor">Crear sistema</button>`}
        <button class="btn btn--borde btn--chico" data-accion="editar-licencia" data-id="${esc(l._id)}">Editar</button>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-licencia" data-id="${esc(l._id)}">Eliminar</button>
      </div></td>
    </tr>`).join('');

  const filasSol = solicitudes.map((s) => `
    <tr><td data-col="Fecha">${fecha(s.createdAt)}</td><td data-col="Software">${esc(s.sistemaNombre) || '—'}</td>
    <td data-col="Plan">${esc(s.planNombre)}</td><td data-col="Estado">${insignia(s.estado || 'pendiente')}</td></tr>`).join('');

  const acceso = config.sitioUrl
    ? `<p class="texto-gris" style="margin-top:24px">El cliente inicia sesión en <a href="${esc(config.sitioUrl)}/acceder.html" target="_blank" rel="noopener">${esc(config.sitioUrl)}/acceder.html</a></p>`
    : '';

  return `
    <a class="volver" href="#/usuarios">← Usuarios</a>
    ${cabecera('Usuario', esc(u.nombre))}
    <div class="barra-acciones">
      <div class="acciones">
        <button class="btn btn--borde btn--chico" data-accion="editar-usuario">Editar datos</button>
        <button class="btn btn--borde btn--chico" data-accion="clave-usuario">Cambiar contraseña</button>
      </div>
      <div class="acciones">
        <button class="btn btn--borde btn--chico" data-accion="activar-usuario">${u.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-usuario">Eliminar</button>
      </div>
    </div>
    <div class="ficha">
      <div><b>Correo</b><span>${esc(u.email)}</span></div>
      <div><b>Empresa</b><span>${esc(u.empresa) || '—'}</span></div>
      <div><b>Teléfono</b><span>${esc(u.telefono) || '—'}</span></div>
      <div><b>Estado</b><span>${insignia(u.activo ? 'activo' : 'inactivo')}</span></div>
      <div><b>Acceso</b><span>${u.googleId ? 'Google' : 'Correo y contraseña'}</span></div>
      <div><b>Cliente desde</b><span>${fecha(u.createdAt)}</span></div>
      <div><b>Último acceso</b><span>${fecha(u.ultimoAcceso)}</span></div>
    </div>
    <div class="cabecera" style="margin:40px 0 16px">
      <h2 class="subtitulo" style="margin:0">Licencias y softwares</h2>
      <button class="btn btn--chico" data-accion="nueva-licencia">+ Asignar licencia</button>
    </div>
    ${tabla(['Software', 'Plan', 'Precio', 'Clave', 'Inicio', 'Vence', 'Usuarios', 'Estado', ''], filasLic || filaVacia(9,'Este usuario aún no tiene licencias.'))}
    <div class="cabecera" style="margin:40px 0 16px">
      <h2 class="subtitulo" style="margin:0">Sistema de empresa (servidor)</h2>
      <button class="btn btn--chico" data-accion="nueva-empresa">+ Crear sistema de empresa</button>
    </div>
    <div class="empresas">${empresas.map(tarjetaEmpresa).join('') || '<p class="texto-gris">Este cliente aún no tiene su sistema. Créalo con el botón o desde una de sus licencias.</p>'}</div>
    <h2 class="subtitulo">Solicitudes con este correo</h2>
    ${tabla(['Fecha', 'Software', 'Plan', 'Estado'], filasSol || filaVacia(4, 'Sin solicitudes.'))}
    ${acceso}`;
}

// ---- Sistemas de empresa (VIMOD CONTROL en el servidor) ----
const slugDe = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
const ESTADO_EMPRESA = { pendiente: 'Creándose…', lista: 'Creada', error: 'Error', eliminando: 'Eliminándose…' };

function textoLicenciaEmpresa(e) {
  const l = e.licenciaServidor;
  if (!l || !l.estado) return e.vence ? `Vence ${fechaDia(e.vence)}` : '—';
  if (l.estado !== 'activa') return 'Suspendida';
  const dias = Number(l.dias);
  return `Vence ${fechaDia(l.vence)}${Number.isFinite(dias) ? ` · ${dias < 0 ? 'vencida' : `${dias} día${dias === 1 ? '' : 's'}`}` : ''}`;
}

const OPCIONES_GB = [[1, '1 GB'], [5, '5 GB'], [10, '10 GB'], [20, '20 GB'], [50, '50 GB'], [100, '100 GB'], [250, '250 GB'], [500, '500 GB'], [1000, '1 TB'], [0, 'Ilimitado']];
const textoGb = (gb) => (!gb ? 'Ilimitado' : gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000} TB` : `${gb} GB`);
function textoBytes(b) {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
function barraAlmacenamiento(e) {
  const gb = Number(e.almacenamientoGb || 0);
  const uso = e.usoBytes;
  if (!gb) return `${textoBytes(uso)} usados · Ilimitado`;
  const pct = uso == null ? 0 : Math.min(100, Math.round((uso / (gb * 1024 ** 3)) * 100));
  return `${textoBytes(uso)} de ${textoGb(gb)} (${pct}%)
    <span class="barra-uso"><span style="width:${pct}%" class="${pct >= 95 ? 'llena' : pct >= 80 ? 'alta' : ''}"></span></span>`;
}

function tarjetaEmpresa(e) {
  const lista = e.estado === 'lista';
  const activa = e.licenciaServidor?.estado !== 'suspendida';
  return `
    <article class="empresa">
      <div class="empresa__cabecera">
        <div><h3>${esc(e.nombre)}</h3><span class="texto-gris">Código: ${esc(e.slug)}</span></div>
        <span class="insignia insignia--${e.estado === 'lista' ? (activa && e.licenciaServidor?.vigente !== false ? 'activa' : 'suspendida') : e.estado}">${
          esc(lista ? (activa ? (e.licenciaServidor?.vigente === false ? 'Vencida' : 'Activa') : 'Suspendida') : ESTADO_EMPRESA[e.estado])}</span>
      </div>
      ${e.error ? `<p class="empresa__error">${esc(e.error)}</p>` : ''}
      ${e.estado === 'pendiente' ? '<p class="texto-gris">El servidor lo creará en el próximo minuto (si el agente está encendido).</p>' : ''}
      ${e.estado === 'eliminando' ? '<p class="texto-gris">El servidor lo eliminará en el próximo minuto (si el agente está encendido). Después desaparece de esta lista.</p>' : ''}
      <ul class="empresa__datos">
        ${e.url ? `<li><b>Dirección</b><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url)}</a></li>` : ''}
        <li><b>Administrador</b>${esc(e.adminUsuario || 'admin')}</li>
        <li><b>Licencia</b>${esc(textoLicenciaEmpresa(e))}</li>
        <li><b>Almacenamiento</b>${barraAlmacenamiento(e)}</li>
        ${e.baseDatos ? `<li><b>Base de datos</b>${esc(e.baseDatos)}</li>` : ''}
        ${e.claveVista ? `<li><b>Contraseña</b>El cliente la vio el ${fecha(e.claveVista)}</li>` : ''}
      </ul>
      <div class="acciones">
        ${lista && e.url ? `<button class="btn btn--chico" data-accion="super-empresa" data-id="${esc(e._id)}" title="Abre su sistema con todas las configuraciones (archivos, almacenamiento, IA, backups, apariencia)">Entrar como superadministrador ↗</button>
          <a class="btn btn--borde btn--chico" href="${esc(e.url)}" target="_blank" rel="noopener">Abrir ↗</a>` : ''}
        ${lista ? `<button class="btn btn--borde btn--chico" data-accion="almacenamiento-empresa" data-id="${esc(e._id)}">Almacenamiento</button>` : ''}
        ${lista && e.tieneClave ? `<button class="btn btn--borde btn--chico" data-accion="ver-clave-empresa" data-id="${esc(e._id)}">Ver contraseña</button>` : ''}
        ${lista ? `<button class="btn btn--borde btn--chico" data-accion="renovar-empresa" data-id="${esc(e._id)}">Renovar</button>
          <button class="btn btn--borde btn--chico" data-accion="estado-empresa" data-id="${esc(e._id)}" data-estado="${activa ? 'suspendida' : 'activa'}">${activa ? 'Suspender' : 'Reactivar'}</button>
          <button class="btn btn--borde btn--chico" data-accion="actualizar-empresa" data-id="${esc(e._id)}" title="Pasar a esta empresa los cambios de la plantilla">Actualizar</button>
          <button class="btn btn--peligro btn--chico" data-accion="eliminar-empresa" data-id="${esc(e._id)}" title="Borra del servidor su sistema y su base de datos">Eliminar</button>` : ''}
        ${e.estado === 'error' ? `<button class="btn btn--chico" data-accion="reintentar-empresa" data-id="${esc(e._id)}">Reintentar</button>` : ''}
        ${e.estado === 'pendiente' || e.estado === 'error' ? `<button class="btn btn--peligro btn--chico" data-accion="quitar-empresa" data-id="${esc(e._id)}">Quitar</button>` : ''}
      </div>
    </article>`;
}

async function vistaServidor() {
  const s = await api('/estado-servidor');
  vistaActual = { empresas: new Map(s.empresas.map((e) => [e._id, e])) };
  const ultimo = s.agente?.ultimoContacto ? new Date(s.agente.ultimoContacto) : null;
  const minutos = ultimo ? Math.round((Date.now() - ultimo) / 60000) : null;
  const conectado = minutos !== null && minutos <= 3;
  const avisos = [
    !s.agenteConfigurado && 'Falta la variable <b>AGENTE_TOKEN</b> (48+ caracteres) en Render: el servidor no puede conectarse.',
    !s.cifradoConfigurado && 'Falta la variable <b>CIFRADO_SECRETO</b> (32+ caracteres) en Render: sin ella no se pueden guardar las contraseñas de las empresas.',
    s.agenteConfigurado && !conectado && (ultimo
      ? `El servidor no se comunica desde hace ${minutos} minutos. Revisa la tarea programada del agente.`
      : 'El servidor todavía no se ha conectado. Instala el agente (ver LEEME de vimod-empresas).')
  ].filter(Boolean);

  const filas = s.empresas.map((e) => `
    <tr>
      <td data-col="Empresa">${esc(e.nombre)}<small>${esc(e.slug)}</small></td>
      <td data-col="Cliente">${e.usuario ? `<a href="#/usuarios/${esc(e.usuario._id)}">${esc(e.usuario.nombre)}</a><small>${esc(e.usuario.email)}</small>`
        : `<button class="btn btn--borde btn--chico" data-accion="vincular-empresa" data-id="${esc(e._id)}">Vincular cliente</button>`}</td>
      <td data-col="Estado">${insignia({ pendiente: 'pendiente', lista: 'activo', error: 'inactivo', eliminando: 'pendiente' }[e.estado])} <small>${esc(ESTADO_EMPRESA[e.estado])}</small></td>
      <td data-col="Licencia">${esc(textoLicenciaEmpresa(e))}</td>
      <td data-col="Almacenamiento">${e.estado === 'lista' ? `${esc(textoBytes(e.usoBytes))}<small>de ${esc(textoGb(e.almacenamientoGb))}</small>` : '—'}</td>
      <td data-col="Dirección">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">Abrir ↗</a>` : '—'}</td>
    </tr>`).join('');
  const TAREA = { crear: 'Crear empresa', licencia: 'Licencia', actualizar: 'Actualizar', eliminar: 'Eliminar empresa' };
  const filasTareas = s.tareas.map((t) => `
    <tr>
      <td data-col="Fecha">${fecha(t.createdAt)} <small>${new Date(t.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</small></td>
      <td data-col="Tarea">${esc(TAREA[t.tipo] || t.tipo)}<small>${esc(t.empresa?.nombre || t.datos?.slug || '')}</small></td>
      <td data-col="Estado">${insignia({ pendiente: 'pendiente', enviada: 'contactado', hecha: 'atendida', error: 'descartada' }[t.estado])}
        <small>${esc({ pendiente: 'Esperando', enviada: 'En el servidor', hecha: 'Hecha', error: 'Error' }[t.estado])}</small></td>
      <td data-col="Detalle">${t.error ? `<span class="empresa__error">${esc(t.error)}</span>` : t.resultado?.licencia ? esc(`Licencia ${t.resultado.licencia.estado} hasta ${t.resultado.licencia.vence}`) : ''}</td>
    </tr>`).join('');

  return `
    ${cabecera('Servidor VIMOD CONTROL', 'Sistemas de <strong>empresas</strong>', '<button class="btn" data-accion="nueva-empresa">+ Crear sistema</button>')}
    <div class="tiles">
      <div class="tile"><b>${conectado ? 'Conectado' : 'Sin conexión'}</b><span>${ultimo ? `Último contacto: ${ultimo.toLocaleString('es')}` : 'Agente del servidor'}${s.agente?.servidor ? ` · ${esc(s.agente.servidor)}` : ''}</span></div>
      <div class="tile"><b>${s.empresas.filter((e) => e.estado === 'lista').length}</b><span>Empresas creadas</span></div>
      <div class="tile"><b>${s.empresas.filter((e) => e.estado === 'pendiente').length}</b><span>Creándose</span></div>
    </div>
    ${avisos.length ? `<div class="aviso-caja">${avisos.map((x) => `<p>${x}</p>`).join('')}</div>` : ''}
    <h2 class="subtitulo">Empresas</h2>
    ${tabla(['Empresa', 'Cliente', 'Estado', 'Licencia', 'Almacenamiento', 'Dirección'], filas || filaVacia(6, 'Aún no hay sistemas de empresa.'))}
    <h2 class="subtitulo">Últimas tareas del servidor</h2>
    ${tabla(['Fecha', 'Tarea', 'Estado', 'Detalle'], filasTareas || filaVacia(4, 'Sin tareas todavía.'))}`;
}

async function formEmpresa({ licenciaId } = {}) {
  let u = vistaActual.usuario || null;
  let usuarios = [];
  if (!u) usuarios = await api('/usuarios');
  const lic = u && licenciaId ? vistaActual.licencias.get(licenciaId) : null;
  const licencias = u ? [...vistaActual.licencias.values()] : [];
  const vence = lic?.fechaVencimiento ? aInput(lic.fechaVencimiento) : sumarMeses(hoy(), lic?.periodo === 'mes' ? 1 : 12);
  const plan = lic?.periodo === 'mes' ? 'mensual' : lic?.periodo === 'año' ? 'anual' : 'anual';
  const nombre = u?.empresa || u?.nombre || '';
  // Softwares del catálogo: elegir uno solo da acceso por enlace (crea la licencia, no un sistema en el servidor).
  const catalogo = u ? (sistemas.length ? sistemas : await cargarSistemas()).filter((s) => s.activo !== false) : [];
  const opcLicencias = opciones(licencias.map((l) => [l._id, `${l.sistemaNombre} · ${l.planNombre}${l.fechaVencimiento ? ' · vence ' + fechaDia(l.fechaVencimiento) : ''}`]), licenciaId || '');
  const opcCatalogo = opciones(catalogo.map((s) => ['enlace:' + s._id, `${s.nombre}`]), '');
  abrirModal(`
    <span class="etiqueta">Servidor VIMOD CONTROL</span>
    <h2 class="titulo">Crear sistema <strong>de empresa</strong></h2>
    <p class="texto-gris" style="margin-bottom:16px">Se crea en el servidor su propio VIMOD CONTROL: carpeta, base de datos y administrador. Tarda alrededor de un minuto.</p>
    <form class="form" id="formEmpresa">
      ${u ? `<input type="hidden" name="usuario" value="${esc(u._id)}">`
        : `<div class="campo"><label>Cliente</label><select name="usuario"><option value="">(sin cliente, vincular después)</option>${opciones(usuarios.map((x) => [x._id, `${x.nombre} · ${x.email}`]), '')}</select></div>`}
      ${u ? `<div class="campo"><label>Licencia vinculada (renovarla renueva el sistema)</label><select name="licencia" data-cambio="licencia-empresa">
          <option value="">(ninguna)</option>
          ${opcLicencias ? `<optgroup label="Crear sistema en el servidor con su licencia">${opcLicencias}</optgroup>` : ''}
          ${opcCatalogo ? `<optgroup label="Solo dar acceso por enlace (no crea sistema)">${opcCatalogo}</optgroup>` : ''}</select>
          <small class="ayuda" data-ayuda-enlace hidden>Solo se crea la licencia: el cliente verá la tarjeta del sistema con su enlace de acceso. No se crea nada en este servidor.</small></div>` : ''}
      <div class="form__fila" data-solo-servidor>
        <div class="campo"><label>Nombre de la empresa</label><input name="nombre" required maxlength="150" value="${esc(nombre)}" data-slug-origen></div>
        <div class="campo"><label>Código (en la dirección)</label><input name="slug" required maxlength="24" pattern="[a-z0-9-]+" value="${esc(slugDe(nombre))}" data-slug>
          <small class="ayuda">Minúsculas, números y guiones. No se puede cambiar después.</small></div>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Vence</label><input name="vence" type="date" required value="${vence}"></div>
        <div class="campo"><label>Plan</label><select name="plan">${opciones([['mensual', 'Mensual'], ['anual', 'Anual'], ['pago unico', 'Pago único']], plan)}</select></div>
      </div>
      <div class="campo" data-solo-servidor><label>Almacenamiento para sus archivos</label><select name="almacenamientoGb">${opciones(OPCIONES_GB, 10)}</select>
        <small class="ayuda">Al llegar al límite no podrán subir más archivos. Se puede cambiar después.</small></div>
      <div class="form__fila form__fila--3" data-solo-servidor>
        <div class="campo"><label>Usuario admin</label><input name="adminUsuario" value="admin" maxlength="40"></div>
        <div class="campo"><label>Nombre del admin</label><input name="adminNombre" maxlength="120" value="${esc(u?.nombre || '')}"></div>
        <div class="campo"><label>Correo del admin</label><input name="adminEmail" type="email" maxlength="160" value="${esc(u?.email || '')}"></div>
      </div>
      <button class="btn" type="submit">Crear sistema</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    if (datos.licencia?.startsWith('enlace:')) {
      // Software externo: solo la licencia (tarjeta + enlace en la cuenta del cliente).
      const s = sistemaPorId(datos.licencia.slice(7));
      await api('/licencias', { method: 'POST', body: {
        usuario: u._id, sistema: s._id, plan: s.planes?.[0]?.codigo || 'personalizado',
        periodo: { mensual: 'mes', anual: 'año', 'pago unico': 'pago único' }[datos.plan] || '',
        fechaInicio: hoy(), fechaVencimiento: datos.vence, estado: 'activa', maxUsuarios: s.planes?.[0]?.maxUsuarios ?? '',
      } });
      cerrarModal();
      aviso(`Acceso a ${s.nombre} asignado: el cliente ya ve la tarjeta con su enlace.`);
      return recargar();
    }
    if (!u && !datos.usuario) delete datos.usuario;
    if (!datos.licencia) delete datos.licencia;
    await api('/empresas', { method: 'POST', body: datos });
    cerrarModal();
    aviso('Pedido enviado: el servidor creará el sistema en el próximo minuto.');
    recargar();
  });
}

function formRenovar(e) {
  const base = e.licenciaServidor?.vence || e.vence || hoy();
  const desde = base < hoy() ? hoy() : base;
  abrirModal(`
    <span class="etiqueta">${esc(e.nombre)}</span>
    <h2 class="titulo">Renovar <strong>sistema</strong></h2>
    <p class="texto-gris" style="margin-bottom:16px">Vence actualmente: ${fechaDia(base)}. ${e.licencia ? 'También se actualiza la licencia vinculada del cliente.' : ''}</p>
    <form class="form">
      <div class="acciones">
        ${[[1, '+1 mes'], [3, '+3 meses'], [6, '+6 meses'], [12, '+1 año'], [24, '+2 años']].map(([m, t]) =>
          `<button class="btn btn--borde btn--chico" type="button" data-accion="renovar-mas" data-meses="${m}" data-desde="${desde}">${t}</button>`).join('')}
      </div>
      <div class="campo"><label>Nueva fecha de vencimiento</label><input name="vence" type="date" required value="${sumarMeses(desde, 12)}"></div>
      <label class="check"><input type="checkbox" name="activar" checked> Dejarlo activo (si estaba suspendido, se reactiva)</label>
      <button class="btn" type="submit">Renovar</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    await api(`/empresas/${e._id}/licencia`, { method: 'POST', body: { vence: datos.vence, estado: datos.activar ? 'activa' : undefined } });
    cerrarModal();
    aviso('Renovación enviada: se aplica en el servidor en el próximo minuto.');
    recargar();
  });
}

function formEliminarEmpresa(e) {
  abrirModal(`
    <span class="etiqueta">${esc(e.nombre)}</span>
    <h2 class="titulo">Eliminar <strong>sistema</strong></h2>
    <p class="texto-gris" style="margin-bottom:12px">Se borra del servidor su sistema: la dirección deja de funcionar y se elimina su base de datos
      ${e.baseDatos ? `(<b>${esc(e.baseDatos)}</b>)` : ''} con todos sus registros. <b>No se puede deshacer.</b></p>
    <p class="texto-gris" style="margin-bottom:16px">Sus archivos subidos se guardan en el servidor, en <code>vimod-empresas\\eliminadas\\</code>.</p>
    <form class="form">
      <div class="campo"><label>Para confirmar, escribe el código: <b>${esc(e.slug)}</b></label>
        <input name="confirmar" required autocomplete="off"></div>
      ${e.licencia ? '<label class="check"><input type="checkbox" name="borrarLicencia" checked> Eliminar también la licencia vinculada del cliente</label>' : ''}
      <button class="btn btn--peligro" type="submit">Eliminar definitivamente</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    await api(`/empresas/${e._id}/eliminar`, { method: 'POST', body: { confirmar: datos.confirmar, borrarLicencia: !!datos.borrarLicencia } });
    cerrarModal();
    aviso('Eliminación enviada: el servidor la borra en el próximo minuto.');
    recargar();
  });
}

function formAlmacenamiento(e) {
  const actual = Number(e.almacenamientoGb || 0);
  const lista = OPCIONES_GB.some(([v]) => v === actual) ? OPCIONES_GB : [[actual, textoGb(actual)], ...OPCIONES_GB];
  abrirModal(`
    <span class="etiqueta">${esc(e.nombre)}</span>
    <h2 class="titulo">Espacio de <strong>almacenamiento</strong></h2>
    <p class="texto-gris" style="margin-bottom:16px">Usado ahora: ${esc(textoBytes(e.usoBytes))} (se actualiza cada 10 minutos).</p>
    <form class="form">
      <div class="form__fila">
        <div class="campo"><label>Elegir</label><select name="almacenamientoGb" data-cambio="gb-predefinido">${opciones(lista, actual)}</select></div>
        <div class="campo"><label>O escribir los GB</label><input name="gbManual" type="number" min="0" step="0.5" placeholder="Ej. 15"></div>
      </div>
      <p class="texto-gris">0 = ilimitado. Si la empresa ya usa más que el nuevo límite, sus archivos no se borran: solo no podrá subir más.</p>
      <button class="btn" type="submit">Guardar</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    const gb = datos.gbManual !== '' ? Number(datos.gbManual) : Number(datos.almacenamientoGb);
    if (!Number.isFinite(gb) || gb < 0) throw new Error('Indica los GB (0 = ilimitado)');
    await api(`/empresas/${e._id}/licencia`, { method: 'POST', body: { almacenamientoGb: gb } });
    cerrarModal();
    aviso(`Almacenamiento: ${textoGb(gb)}. Se aplica en el servidor en el próximo minuto.`);
    recargar();
  });
}

async function formVincular(e) {
  const usuarios = await api('/usuarios');
  abrirModal(`
    <span class="etiqueta">${esc(e.nombre)}</span>
    <h2 class="titulo">Vincular <strong>cliente</strong></h2>
    <form class="form">
      <div class="campo"><label>Cliente</label><select name="usuario" required><option value="">Elige un cliente…</option>${opciones(usuarios.map((x) => [x._id, `${x.nombre} · ${x.email}`]), '')}</select></div>
      <button class="btn" type="submit">Vincular</button>
      <p class="estado" role="status"></p>
    </form>`,
  async (datos) => {
    if (!datos.usuario) throw new Error('Elige un cliente');
    await api('/empresas/' + e._id, { method: 'PUT', body: { usuario: datos.usuario } });
    cerrarModal();
    aviso('Empresa vinculada: el cliente ya la ve en su cuenta.');
    recargar();
  });
}

async function verClaveEmpresa(e) {
  const r = await api(`/empresas/${e._id}/clave`);
  const texto = `Tu sistema VIMOD\nDirección: ${r.url}\nUsuario: ${r.usuario}\nContraseña: ${r.clave}\nCámbiala al entrar (Configuración → contraseña).`;
  abrirModal(`
    <span class="etiqueta">${esc(e.nombre)}</span>
    <h2 class="titulo">Acceso del <strong>administrador</strong></h2>
    <div class="credenciales">
      <div>Dirección: <code>${esc(r.url)}</code></div>
      <div>Usuario: <code>${esc(r.usuario)}</code></div>
      <div>Contraseña: <code>${esc(r.clave)}</code></div>
    </div>
    <p class="texto-gris" style="margin:14px 0">El cliente también la ve en “Mi cuenta”. Cuando confirme que la cambió, puedes borrarla del Panel.</p>
    <div class="acciones">
      <button class="btn" type="button" data-accion="copiar" data-copiar="${esc(texto)}">Copiar datos</button>
      <button class="btn btn--peligro" type="button" data-accion="borrar-clave-empresa" data-id="${esc(e._id)}">Borrar contraseña guardada</button>
    </div>`);
}

// ---- Softwares y planes ----
async function vistaSistemas() {
  await cargarSistemas();
  const tarjetas = sistemas.map((s) => `
    <article class="sistema">
      ${s.imagen ? `<img class="sistema__img" src="${esc(s.imagen)}" alt="">` : ''}
      <div class="sistema__cabecera"><h3>${esc(s.nombre)}</h3>
        <div class="acciones">${insignia(s.publicado !== false ? 'publicado' : 'oculto')}</div></div>
      <p>${esc(s.descripcion) || 'Sin descripción.'}</p>
      <ul class="sistema__planes">${(s.planes || []).map((p) => `<li><span>${esc(p.nombre)}</span><b>${esc(precioTexto(p))}</b></li>`).join('') || '<li class="texto-gris">Sin planes</li>'}</ul>
      <span class="texto-gris">${s.licencias} licencia(s)${s.activo === false ? ' · No disponible para nuevas licencias' : ''}</span>
      <div class="acciones">
        <a class="btn btn--chico" href="#/sistemas/${esc(s._id)}">Editar</a>
        <button class="btn btn--peligro btn--chico" data-accion="eliminar-sistema" data-id="${esc(s._id)}" data-nombre="${esc(s.nombre)}">Eliminar</button>
      </div>
    </article>`).join('');
  return `
    ${cabecera('Catálogo', 'Softwares <strong>y planes</strong>', `<div class="acciones">${enlaceWeb('/#softwares')}<a class="btn" href="#/sistemas/nuevo">+ Nuevo software</a></div>`)}
    <p class="texto-gris" style="margin-bottom:20px">Lo que pongas aquí se muestra en “Nuestros softwares” y en la página de planes. Al asignar una licencia, el cliente verá el software en su cuenta.</p>
    <div class="sistemas">${tarjetas || '<p class="texto-gris">No hay softwares. Crea el primero.</p>'}</div>`;
}

const campoImagen = (nombre, valor, etiqueta = 'Imagen') => `
  <div class="campo campo-imagen">
    <label>${etiqueta}</label>
    <div class="campo-imagen__fila">
      <div class="campo-imagen__vista">${valor ? `<img src="${esc(valor)}" alt="">` : '<span>Sin imagen</span>'}</div>
      <div class="campo-imagen__controles">
        <input ${nombre ? `name="${nombre}"` : ''} data-campo="imagen" data-imagen value="${esc(valor)}" placeholder="Pega un enlace https://… o sube una imagen">
        <label class="btn btn--borde btn--chico">Subir imagen<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-subir></label>
      </div>
    </div>
  </div>`;

const ayudaNegrita = '<small class="ayuda">Escribe *entre asteriscos* lo que quieras en negrita.</small>';

function planEditor(p = {}, usadas = 0) {
  return `
    <fieldset class="repetible plan-editor" data-codigo="${esc(p.codigo || '')}">
      <div class="repetible__cabecera">
        <b>${esc(p.nombre || 'Nuevo plan')}</b>${usadas ? `<span class="texto-gris">${usadas} licencia(s)</span>` : ''}
        <div class="acciones">
          <button type="button" class="btn btn--borde btn--chico" data-accion="subir" title="Mover antes">↑</button>
          <button type="button" class="btn btn--borde btn--chico" data-accion="bajar" title="Mover después">↓</button>
          <button type="button" class="btn btn--peligro btn--chico" data-accion="quitar" ${usadas ? 'disabled title="Tiene licencias asignadas"' : ''}>Quitar</button>
        </div>
      </div>
      <div class="form__fila form__fila--3">
        <div class="campo"><label>Nombre del plan</label><input data-campo="nombre" required maxlength="60" value="${esc(p.nombre)}"></div>
        <div class="campo"><label>Precio (vacío = “A medida”)</label><input data-campo="precio" type="number" min="0" step="0.01" value="${p.precio ?? ''}"></div>
        <div class="campo"><label>Periodo</label><input data-campo="periodo" list="periodos" maxlength="30" value="${esc(p.periodo ?? (p.nombre ? '' : 'mes'))}" placeholder="mes, año…"></div>
      </div>
      <div class="campo"><label>Descripción corta</label><input data-campo="descripcion" maxlength="300" value="${esc(p.descripcion)}"></div>
      <div class="campo"><label>Características (una por línea)</label><textarea data-campo="caracteristicas" rows="5">${esc((p.caracteristicas || []).join('\n'))}</textarea></div>
      <div class="form__fila">
        <div class="campo"><label>Usuarios incluidos (vacío = ilimitados)</label><input data-campo="maxUsuarios" type="number" min="1" value="${p.maxUsuarios ?? ''}"></div>
        <label class="check check--abajo"><input type="checkbox" data-campo="destacado" ${p.destacado ? 'checked' : ''}> Destacar como “Más elegido”</label>
      </div>
    </fieldset>`;
}

async function vistaSistema(id) {
  const nuevo = id === 'nuevo';
  const s = nuevo ? { publicado: true, activo: true, planes: [], orden: sistemas.length } : await api('/sistemas/' + id);
  const usadas = s.licenciasPorPlan || {};
  vistaActual = { sistema: s };
  return `
    <a class="volver" href="#/sistemas">← Softwares y planes</a>
    ${cabecera('Software', nuevo ? 'Nuevo <strong>software</strong>' : esc(s.nombre),
      nuevo ? '' : `<div class="acciones">${enlaceWeb('/planes.html?s=' + s._id, 'Ver planes en la web')}</div>`)}
    <form class="editor" id="formSistema" novalidate>
      <section class="editor__bloque">
        <h2 class="subtitulo">Datos generales</h2>
        <div class="form__fila">
          <div class="campo"><label>Nombre del software</label><input name="nombre" required maxlength="120" value="${esc(s.nombre)}"><small class="ayuda">La última palabra se muestra en negrita (ej. VIMOD <b>Gestión</b>).</small></div>
          <div class="campo"><label>Etiqueta</label><input name="etiqueta" maxlength="80" value="${esc(s.etiqueta)}" placeholder="Ideal para gestión empresarial"></div>
        </div>
        <div class="form__fila">
          <div class="campo"><label>Enlace de acceso (para clientes con licencia)</label><input name="url" type="url" maxlength="300" value="${esc(s.url)}" placeholder="https://…"></div>
          <div class="campo"><label>Orden en la página</label><input name="orden" type="number" value="${esc(s.orden ?? 0)}"></div>
        </div>
        <label class="check"><input type="checkbox" name="publicado" ${s.publicado !== false ? 'checked' : ''}> Publicado en la página web</label>
        <label class="check"><input type="checkbox" name="activo" ${s.activo !== false ? 'checked' : ''}> Disponible para asignar licencias</label>
      </section>

      <section class="editor__bloque">
        <h2 class="subtitulo">Sección “Nuestros softwares”</h2>
        <div class="campo"><label>Titular</label><input name="titulo" maxlength="160" value="${esc(s.titulo)}" placeholder="Tecnología para *gestionar tu empresa*">${ayudaNegrita}</div>
        <div class="campo"><label>Descripción</label><textarea name="descripcion" rows="3" maxlength="1000">${esc(s.descripcion)}</textarea></div>
        <div class="campo"><label>Características (una por línea)</label><textarea name="caracteristicas" rows="5">${esc((s.caracteristicas || []).join('\n'))}</textarea></div>
        <div class="campo"><label>Texto de la tarjeta</label><textarea name="resumen" rows="2" maxlength="400">${esc(s.resumen)}</textarea></div>
        ${campoImagen('imagen', s.imagen, 'Imagen de la tarjeta')}
      </section>

      <section class="editor__bloque">
        <h2 class="subtitulo">Planes y precios</h2>
        <div class="campo"><label>Texto de la página de planes</label><textarea name="textoPlanes" rows="2" maxlength="400">${esc(s.textoPlanes)}</textarea></div>
        <div class="repetibles" id="planesEditor">${(s.planes || []).map((p) => planEditor(p, usadas[p.codigo])).join('')}</div>
        <button type="button" class="btn btn--borde" data-accion="agregar-plan">+ Agregar plan</button>
        <datalist id="periodos"><option value="mes"><option value="año"><option value="trimestre"><option value="pago único"></datalist>
      </section>

      <div class="editor__pie">
        <button class="btn" type="submit">${nuevo ? 'Crear software' : 'Guardar cambios'}</button>
        <p class="estado" role="status"></p>
      </div>
    </form>`;
}

function leerSistema(form) {
  const v = (n) => form.elements[n].value;
  return {
    nombre: v('nombre'), etiqueta: v('etiqueta'), url: v('url'), orden: v('orden'),
    publicado: form.elements.publicado.checked, activo: form.elements.activo.checked,
    titulo: v('titulo'), descripcion: v('descripcion'), resumen: v('resumen'), imagen: v('imagen'),
    caracteristicas: v('caracteristicas').split('\n'),
    textoPlanes: v('textoPlanes'),
    planes: $$('.plan-editor', form).map((f) => {
      const c = (n) => $(`[data-campo="${n}"]`, f);
      return {
        codigo: f.dataset.codigo || undefined,
        nombre: c('nombre').value, precio: c('precio').value, periodo: c('periodo').value,
        descripcion: c('descripcion').value, caracteristicas: c('caracteristicas').value.split('\n'),
        maxUsuarios: c('maxUsuarios').value, destacado: c('destacado').checked
      };
    })
  };
}

async function guardarSistema(form) {
  const datos = leerSistema(form);
  if (!datos.nombre.trim()) throw new Error('Escribe el nombre del software');
  if (datos.planes.some((p) => !p.nombre.trim())) throw new Error('Todos los planes necesitan un nombre');
  const s = vistaActual.sistema;
  if (s._id) {
    await api('/sistemas/' + s._id, { method: 'PUT', body: datos });
    aviso('Software guardado. Los cambios ya se ven en la página.');
    recargar();
  } else {
    const creado = await api('/sistemas', { method: 'POST', body: datos });
    hayCambios = false;
    aviso('Software creado');
    location.hash = '#/sistemas/' + creado._id;
  }
}

// ---- Contenido web ----
const cifraEditor = (c = {}) => `
  <div class="repetible repetible--fila cifra-editor">
    <div class="campo"><label>Número</label><input data-campo="valor" type="number" min="0" value="${esc(c.valor ?? '')}"></div>
    <div class="campo"><label>Texto</label><input data-campo="texto" maxlength="40" value="${esc(c.texto)}"></div>
    <div class="acciones">
      <button type="button" class="btn btn--borde btn--chico" data-accion="subir">↑</button>
      <button type="button" class="btn btn--borde btn--chico" data-accion="bajar">↓</button>
      <button type="button" class="btn btn--peligro btn--chico" data-accion="quitar">Quitar</button>
    </div>
  </div>`;

const proyectoEditor = (p = {}) => `
  <fieldset class="repetible proyecto-editor">
    <div class="repetible__cabecera">
      <b>${esc(p.titulo || 'Nuevo proyecto')}</b>
      <div class="acciones">
        <button type="button" class="btn btn--borde btn--chico" data-accion="subir">↑</button>
        <button type="button" class="btn btn--borde btn--chico" data-accion="bajar">↓</button>
        <button type="button" class="btn btn--peligro btn--chico" data-accion="quitar">Quitar</button>
      </div>
    </div>
    <div class="form__fila">
      <div class="campo"><label>Nombre del proyecto</label><input data-campo="titulo" maxlength="120" value="${esc(p.titulo)}"></div>
      <div class="campo"><label>Categoría</label><input data-campo="categoria" maxlength="60" value="${esc(p.categoria)}" placeholder="Residencial, Corporativo…"></div>
    </div>
    ${campoImagen('', p.imagen, 'Imagen principal (portada)')}
    <div class="campo"><label>Descripción (se muestra al hacer clic en el proyecto; deja una línea en blanco entre párrafos)</label><textarea data-campo="descripcion" rows="5" maxlength="3000">${esc(p.descripcion)}</textarea></div>
    <div class="campo"><label>Enlace del proyecto (botón “Visitar sitio”)</label><input data-campo="enlace" type="url" maxlength="300" value="${esc(p.enlace)}" placeholder="https://…"></div>
    <h3 class="editor__subtitulo">Imágenes de ejemplo</h3>
    <div class="repetibles" data-lista="galeria">${(p.imagenes || []).map(imagenProyectoEditor).join('')}</div>
    <div><button type="button" class="btn btn--borde btn--chico" data-accion="agregar-imagen-proyecto">+ Agregar imagen de ejemplo</button></div>
  </fieldset>`;

// Imagen extra de un proyecto (se ve en la ventana de detalle)
const imagenProyectoEditor = (url = '') => `
  <div class="repetible galeria-editor">
    <div class="repetible__cabecera">
      <b>Imagen de ejemplo</b>
      <div class="acciones">
        <button type="button" class="btn btn--borde btn--chico" data-accion="subir">↑</button>
        <button type="button" class="btn btn--borde btn--chico" data-accion="bajar">↓</button>
        <button type="button" class="btn btn--peligro btn--chico" data-accion="quitar">Quitar</button>
      </div>
    </div>
    ${campoImagen('', typeof url === 'string' ? url : '', 'Imagen')}
  </div>`;

async function vistaContenido() {
  const c = await api('/contenido');
  const n = c.nosotros, p = c.proyectos, k = c.contacto;
  return `
    ${cabecera('Página web', 'Contenido <strong>web</strong>', `<div class="acciones">${enlaceWeb('/')}</div>`)}
    <p class="texto-gris" style="margin-bottom:20px">Edita los textos e imágenes de la página. Los softwares y precios se editan en <a href="#/sistemas">Softwares y planes</a>.</p>
    <form class="editor" id="formContenido" novalidate>
      <section class="editor__bloque" data-seccion="nosotros">
        <h2 class="subtitulo">Nosotros</h2>
        <div class="form__fila">
          <div class="campo"><label>Etiqueta</label><input data-campo="etiqueta" maxlength="80" value="${esc(n.etiqueta)}"></div>
          <div class="campo"><label>Título</label><input data-campo="titulo" maxlength="200" value="${esc(n.titulo)}">${ayudaNegrita}</div>
        </div>
        <div class="campo"><label>Texto (deja una línea en blanco entre párrafos)</label><textarea data-campo="parrafos" rows="7">${esc((n.parrafos || []).join('\n\n'))}</textarea></div>
        ${campoImagen('', n.imagen)}
        <h3 class="editor__subtitulo">Cifras</h3>
        <div class="repetibles" data-lista="cifras">${(n.cifras || []).map(cifraEditor).join('')}</div>
        <button type="button" class="btn btn--borde btn--chico" data-accion="agregar-cifra">+ Agregar cifra</button>
      </section>

      <section class="editor__bloque" data-seccion="proyectos">
        <h2 class="subtitulo">Proyectos</h2>
        <div class="form__fila">
          <div class="campo"><label>Etiqueta</label><input data-campo="etiqueta" maxlength="80" value="${esc(p.etiqueta)}"></div>
          <div class="campo"><label>Título</label><input data-campo="titulo" maxlength="200" value="${esc(p.titulo)}">${ayudaNegrita}</div>
        </div>
        <div class="campo"><label>Texto</label><input data-campo="texto" maxlength="400" value="${esc(p.texto)}"></div>
        <p class="texto-gris">Al hacer clic en un proyecto se abre una ventana con su descripción, sus imágenes de ejemplo y el botón al sitio.</p>
        <div class="repetibles" data-lista="items">${(p.items || []).map(proyectoEditor).join('')}</div>
        <button type="button" class="btn btn--borde" data-accion="agregar-proyecto">+ Agregar proyecto</button>
      </section>

      <section class="editor__bloque" data-seccion="softwares">
        <h2 class="subtitulo">Nuestros softwares</h2>
        <div class="campo"><label>Etiqueta de la sección</label><input data-campo="etiqueta" maxlength="80" value="${esc(c.softwares.etiqueta)}"></div>
      </section>

      <section class="editor__bloque" data-seccion="contacto">
        <h2 class="subtitulo">Contacto</h2>
        <div class="form__fila">
          <div class="campo"><label>Etiqueta</label><input data-campo="etiqueta" maxlength="80" value="${esc(k.etiqueta)}"></div>
          <div class="campo"><label>Título</label><input data-campo="titulo" maxlength="200" value="${esc(k.titulo)}">${ayudaNegrita}</div>
        </div>
        <div class="campo"><label>Texto</label><input data-campo="texto" maxlength="400" value="${esc(k.texto)}"></div>
        <div class="form__fila">
          <div class="campo"><label>Correo</label><input data-campo="correo" type="email" maxlength="120" value="${esc(k.correo)}"></div>
          <div class="campo"><label>Teléfono</label><input data-campo="telefono" maxlength="60" value="${esc(k.telefono)}"></div>
        </div>
        <div class="form__fila">
          <div class="campo"><label>Dirección</label><input data-campo="direccion" maxlength="200" value="${esc(k.direccion)}"></div>
          <div class="campo"><label>Horario</label><input data-campo="horario" maxlength="120" value="${esc(k.horario)}"></div>
        </div>
        <p class="texto-gris">Los campos vacíos no se muestran en la página.</p>
      </section>

      <div class="editor__pie">
        <button class="btn" type="submit">Guardar cambios</button>
        <p class="estado" role="status"></p>
      </div>
    </form>`;
}

function leerContenido(form) {
  const secc = (n) => $(`[data-seccion="${n}"]`, form);
  // Campos propios de la sección (no los de proyectos/cifras repetibles)
  const campos = (el) => Object.fromEntries(
    $$('[data-campo]', el).filter((i) => !i.closest('.repetible')).map((i) => [i.dataset.campo, i.value])
  );
  const nos = campos(secc('nosotros'));
  return {
    nosotros: {
      ...nos,
      parrafos: nos.parrafos.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean),
      cifras: $$('.cifra-editor', form).map((f) => campos2(f))
    },
    proyectos: {
      ...campos(secc('proyectos')),
      items: $$('.proyecto-editor', form).map((f) => ({
        // Campos del proyecto, sin los de sus imágenes de ejemplo
        ...Object.fromEntries($$('[data-campo]', f).filter((i) => !i.closest('.galeria-editor')).map((i) => [i.dataset.campo, i.value])),
        imagenes: $$('.galeria-editor [data-imagen]', f).map((i) => i.value.trim()).filter(Boolean)
      }))
    },
    softwares: campos(secc('softwares')),
    contacto: campos(secc('contacto'))
  };
}
const campos2 = (el) => Object.fromEntries($$('[data-campo]', el).map((i) => [i.dataset.campo, i.value]));

async function guardarContenido(form) {
  await api('/contenido', { method: 'PUT', body: leerContenido(form) });
  aviso('Contenido guardado. Los cambios ya se ven en la página.');
  recargar();
}

// ---- Imágenes ----
function reducirImagen(archivo, max = 1800, calidad = 0.82) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let datos = archivo.type === 'image/png' ? c.toDataURL('image/png') : '';
      if (!datos || datos.length > 3e6) datos = c.toDataURL('image/jpeg', calidad);
      ok(datos);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

async function subirImagen(inputArchivo) {
  const archivo = inputArchivo.files[0];
  if (!archivo) return;
  const caja = inputArchivo.closest('.campo-imagen');
  const campo = $('[data-imagen]', caja);
  const etiqueta = inputArchivo.parentElement;
  etiqueta.classList.add('cargando-boton');
  try {
    const datos = await reducirImagen(archivo);
    const r = await api('/imagenes', { method: 'POST', body: { nombre: archivo.name, datos } });
    campo.value = r.url;
    vistaPrevia(campo);
    hayCambios = true;
    aviso('Imagen subida. Recuerda guardar los cambios.');
  } catch (err) {
    aviso(err.message, true);
  } finally {
    etiqueta.classList.remove('cargando-boton');
    inputArchivo.value = '';
  }
}

function vistaPrevia(campo) {
  const vista = $('.campo-imagen__vista', campo.closest('.campo-imagen'));
  const url = campo.value.trim();
  vista.innerHTML = /^(https?:\/\/|\/imagenes\/)/i.test(url) ? `<img src="${esc(url)}" alt="">` : '<span>Sin imagen</span>';
}

// ===== Solicitudes y mensajes =====
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
      <td data-col="Plan">${esc(s.planNombre)}${s.sistemaNombre ? `<small>${esc(s.sistemaNombre)}</small>` : ''}</td>
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

// Editores de página completa (software y contenido)
$('#vista').addEventListener('submit', async (e) => {
  const form = e.target;
  const guardar = { formSistema: guardarSistema, formContenido: guardarContenido }[form.id];
  if (!guardar) return;
  e.preventDefault();
  const boton = $('.editor__pie button[type=submit]', form);
  const estado = $('.editor__pie .estado', form);
  boton.disabled = true;
  estado.textContent = 'Guardando…';
  try {
    await guardar(form);
  } catch (err) {
    estado.textContent = err.message;
    aviso(err.message, true);
  } finally {
    if (boton.isConnected) boton.disabled = false;
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
    mostrarCredenciales(nuevo, datos.password, desdeSolicitud);
  });
}

function mostrarCredenciales(usuario, password, solicitud) {
  const url = config.sitioUrl ? config.sitioUrl + '/acceder.html' : '(URL de VIMOD PRESENTACION)/acceder.html';
  const texto = `Acceso a tu cuenta VIMOD\nIngresa en: ${url}\nCorreo: ${usuario.email}\nContraseña: ${password}\nTe recomendamos cambiar la contraseña desde "Mi perfil".`;
  const sistemaId = solicitud?.sistema?._id || solicitud?.sistema || '';
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
      <button class="btn" type="button" data-accion="asignar-tras-crear" data-id="${esc(usuario._id)}"
        data-sistema="${esc(sistemaId)}" data-plan="${esc(solicitud?.plan || '')}">Asignar licencia <span class="flecha">→</span></button>
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
    const texto = `Tu nueva contraseña de VIMOD es: ${datos.password}`;
    abrirModal(`
      <span class="etiqueta">Contraseña actualizada</span>
      <h2 class="titulo">Nueva <strong>contraseña</strong></h2>
      <div class="credenciales"><div>Correo: <code>${esc(u.email)}</code></div><div>Contraseña: <code>${esc(datos.password)}</code></div></div>
      <div class="acciones" style="margin-top:20px"><button class="btn" type="button" data-accion="copiar" data-copiar="${esc(texto)}">Copiar</button></div>`);
  });
}

const opciones = (lista, actual) =>
  lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(actual) ? 'selected' : ''}>${esc(t)}</option>`).join('');
const opcionesPlan = (sistema, actual) => {
  const planes = sistema?.planes || [];
  // Software sin planes (p. ej. uno privado): la licencia queda como "Personalizado".
  if (!planes.length) return `<option value="personalizado">Personalizado (el software no tiene planes)</option>`;
  return opciones(planes.map((p) => [p.codigo, `${p.nombre} · ${precioTexto(p)}`]), actual);
};
const sistemaPorId = (id) => sistemas.find((s) => String(s._id) === String(id));
const planDe = (sistema, codigo) => (sistema?.planes || []).find((p) => p.codigo === codigo);

// ---- Duración, facturación y precio de la licencia ----
const PERIODOS_LICENCIA = [['mes', 'Mensual'], ['año', 'Anual'], ['pago único', 'Pago único'], ['', 'Sin especificar']];
const DURACIONES = [['1', '1 mes'], ['3', '3 meses'], ['6', '6 meses'], ['12', '1 año'], ['24', '2 años'], ['36', '3 años'], ['0', 'Sin vencimiento'], ['', 'Personalizada']];
const periodoDelPlan = (plan) => (/^a[ñn]o|anual/i.test(plan?.periodo || '') ? 'año' : plan?.precio == null && plan ? '' : 'mes');
const textoPrecioPlan = (plan) => (plan ? `Precio del plan: ${precioTexto(plan)}` : '');
const redondear = (n) => Math.round(n * 100) / 100;

// Precio para la facturación elegida a partir del precio del plan (anual = mensual × 12, y al revés).
function precioSugerido(plan, periodo) {
  if (!plan || plan.precio == null) return '';
  const planAnual = periodoDelPlan(plan) === 'año';
  if (periodo === 'año') return planAnual ? plan.precio : redondear(plan.precio * 12);
  if (periodo === 'mes') return planAnual ? redondear(plan.precio / 12) : plan.precio;
  return plan.precio;
}

// Qué opción de duración corresponde a unas fechas ('' = personalizada).
function duracionDe(inicio, vence) {
  if (!vence) return '0';
  const op = DURACIONES.find(([m]) => Number(m) > 0 && sumarMeses(inicio || hoy(), Number(m)) === vence);
  return op ? op[0] : '';
}

function recalcularLicencia(form, { precio = false } = {}) {
  const plan = planDe(sistemaPorId(form.sistema.value), form.plan.value);
  $('#precioPlan', form).textContent = textoPrecioPlan(plan);
  if (precio && !form.precio.dataset.editado) form.precio.value = precioSugerido(plan, form.periodo.value);
}

function aplicarDuracion(form) {
  const meses = form.duracion.value;
  if (meses === '') return; // personalizada: se respeta la fecha escrita
  form.fechaVencimiento.value = meses === '0' ? '' : sumarMeses(form.fechaInicio.value || hoy(), Number(meses));
}

function formLicencia(l, prefill = {}) {
  const u = vistaActual.usuario;
  const actualId = l?.sistema?._id || prefill.sistema;
  const disponibles = sistemas.filter((s) => s.activo !== false || String(s._id) === String(actualId));
  if (!disponibles.length) {
    abrirModal(`<span class="etiqueta">Licencias</span><h2 class="titulo">No hay <strong>softwares</strong></h2>
      <p class="texto-gris" style="margin-bottom:20px">Primero crea un software en el catálogo.</p>
      <a class="btn" href="#/sistemas" data-accion="cerrar-modal">Ir a Softwares y planes</a>`);
    return;
  }
  const sistema = sistemaPorId(actualId) || disponibles[0];
  const planCodigo = l?.plan || prefill.plan || sistema.planes?.[0]?.codigo || 'personalizado';
  const plan = planDe(sistema, planCodigo);
  const maxUsuarios = l ? l.maxUsuarios ?? '' : plan?.maxUsuarios ?? '';
  const inicio = l ? aInput(l.fechaInicio) : hoy();
  const periodo = l ? l.periodo || '' : periodoDelPlan(plan);
  const vence = l ? aInput(l.fechaVencimiento) : sumarMeses(inicio, periodo === 'año' ? 12 : 1);
  const duracion = duracionDe(inicio, vence);
  const precio = l ? l.precio ?? '' : precioSugerido(plan, periodo);

  abrirModal(`
    <span class="etiqueta">${esc(u.nombre)}</span>
    <h2 class="titulo">${l ? 'Editar' : 'Asignar'} <strong>licencia</strong></h2>
    <form class="form" id="formLicencia">
      <div class="form__fila">
        <div class="campo"><label>Software</label><select name="sistema" data-cambio="sistema-licencia">${opciones(disponibles.map((s) => [s._id, s.nombre]), sistema._id)}</select></div>
        <div class="campo"><label>Plan</label><select name="plan" data-cambio="plan-licencia">${opcionesPlan(sistema, planCodigo)}</select></div>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Facturación</label><select name="periodo" data-cambio="periodo-licencia">${opciones(PERIODOS_LICENCIA, periodo)}</select></div>
        <div class="campo"><label>Precio $ (vacío = sin precio)</label><input name="precio" type="number" min="0" step="0.01" value="${esc(precio)}" data-precio data-editado="${l && precio !== '' ? '1' : ''}">
          <small class="ayuda" id="precioPlan">${esc(textoPrecioPlan(plan))}</small></div>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Duración</label><select name="duracion" data-cambio="duracion-licencia">${opciones(DURACIONES, duracion)}</select></div>
        <div class="campo"><label>Inicio</label><input name="fechaInicio" type="date" value="${inicio}" data-cambio="inicio-licencia"></div>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Vencimiento (editable)</label><input name="fechaVencimiento" type="date" value="${vence}" data-vence></div>
        <div class="campo"><label>Máx. usuarios (vacío = ilimitados)</label><input name="maxUsuarios" type="number" min="1" value="${esc(maxUsuarios)}"></div>
      </div>
      <div class="form__fila">
        <div class="campo"><label>Estado</label><select name="estado">${opciones([['activa', 'Activa'], ['suspendida', 'Suspendida'], ['vencida', 'Vencida']], l?.estado || 'activa')}</select></div>
        <div></div>
      </div>
      <div class="campo"><label>Notas internas (el cliente no las ve)</label><textarea name="notas" maxlength="1000">${esc(l?.notas)}</textarea></div>
      ${l ? `<p class="texto-gris">Clave: <span class="clave">${esc(l.clave)}</span></p>` : '<p class="texto-gris">La clave de licencia se genera automáticamente.</p>'}
      <button class="btn" type="submit">${l ? 'Guardar cambios' : 'Asignar licencia'}</button>
      <p class="estado" role="status"></p>
    </form>`,
  async ({ duracion, ...datos }) => {
    if (l) await api('/licencias/' + l._id, { method: 'PUT', body: datos });
    else await api('/licencias', { method: 'POST', body: { ...datos, usuario: u._id } });
    cerrarModal();
    aviso(l ? 'Licencia actualizada' : 'Licencia asignada');
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

function moverRepetible(el, dir) {
  const item = el.closest('.repetible');
  const otro = dir < 0 ? item.previousElementSibling : item.nextElementSibling;
  if (!otro) return;
  if (dir < 0) otro.before(item);
  else otro.after(item);
  hayCambios = true;
}

function agregarRepetible(contenedor, html) {
  contenedor.insertAdjacentHTML('beforeend', html);
  const nuevo = contenedor.lastElementChild;
  nuevo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const campo = $('input', nuevo);
  if (campo) campo.focus({ preventScroll: true });
  hayCambios = true;
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
  'nueva-empresa': (el) => formEmpresa({ licenciaId: el.dataset.licencia }),
  'ver-clave-empresa': (el) => verClaveEmpresa(vistaActual.empresas.get(el.dataset.id)),
  'borrar-clave-empresa': (el) => {
    if (!confirm('¿Borrar la contraseña guardada? Ni tú ni el cliente podrán volver a verla aquí.')) return;
    return api(`/empresas/${el.dataset.id}/clave`, { method: 'DELETE' }).then(() => { cerrarModal(); aviso('Contraseña borrada del Panel'); recargar(); });
  },
  'renovar-empresa': (el) => formRenovar(vistaActual.empresas.get(el.dataset.id)),
  'almacenamiento-empresa': (el) => formAlmacenamiento(vistaActual.empresas.get(el.dataset.id)),
  'super-empresa': async (el) => {
    // La pestaña se abre antes de pedir el enlace (si no, el navegador la bloquea como ventana emergente).
    const ventana = window.open('about:blank', '_blank');
    try {
      const r = await api(`/empresas/${el.dataset.id}/acceso-super`, { method: 'POST' });
      if (ventana) { ventana.opener = null; ventana.location.href = r.url; } else location.href = r.url;
    } catch (err) {
      if (ventana) ventana.close();
      throw err;
    }
  },
  'renovar-mas': (el) => { el.closest('form').vence.value = sumarMeses(el.dataset.desde, Number(el.dataset.meses)); },
  'estado-empresa': async (el) => {
    const suspender = el.dataset.estado === 'suspendida';
    if (suspender && !confirm('¿Suspender el sistema de esta empresa? Nadie podrá entrar hasta que lo reactives.')) return;
    await api(`/empresas/${el.dataset.id}/licencia`, { method: 'POST', body: { estado: el.dataset.estado } });
    aviso(suspender ? 'Suspensión enviada al servidor' : 'Reactivación enviada al servidor');
    recargar();
  },
  'actualizar-empresa': async (el) => {
    await api(`/empresas/${el.dataset.id}/actualizar`, { method: 'POST' });
    aviso('Actualización enviada al servidor');
    recargar();
  },
  'reintentar-empresa': async (el) => {
    await api(`/empresas/${el.dataset.id}/reintentar`, { method: 'POST' });
    aviso('Se volverá a intentar en el próximo minuto');
    recargar();
  },
  'eliminar-empresa': (el) => formEliminarEmpresa(vistaActual.empresas.get(el.dataset.id)),
  'quitar-empresa': (el) => confirmarYBorrar('¿Quitar este pedido? (No se creó en el servidor.)', '/empresas/' + el.dataset.id, 'Pedido quitado'),
  'vincular-empresa': (el) => formVincular(vistaActual.empresas.get(el.dataset.id)),
  'editar-licencia': (el) => formLicencia(vistaActual.licencias.get(el.dataset.id)),
  'eliminar-licencia': (el) => confirmarYBorrar('¿Eliminar esta licencia? El cliente dejará de verla.', '/licencias/' + el.dataset.id, 'Licencia eliminada'),
  'eliminar-sistema': (el) => confirmarYBorrar(`¿Eliminar "${el.dataset.nombre}"? Desaparecerá de la página.`, '/sistemas/' + el.dataset.id, 'Software eliminado'),
  'agregar-plan': () => agregarRepetible($('#planesEditor'), planEditor()),
  'agregar-cifra': () => agregarRepetible($('[data-lista="cifras"]'), cifraEditor()),
  'agregar-proyecto': () => agregarRepetible($('[data-lista="items"]'), proyectoEditor()),
  'agregar-imagen-proyecto': (el) =>
    agregarRepetible($('[data-lista="galeria"]', el.closest('.proyecto-editor')), imagenProyectoEditor()),
  'subir': (el) => moverRepetible(el, -1),
  'bajar': (el) => moverRepetible(el, 1),
  'quitar': (el) => {
    const item = el.closest('.repetible');
    const nombre = $('[data-campo="nombre"], [data-campo="titulo"], [data-campo="texto"]', item)?.value;
    if (!confirm(`¿Quitar ${nombre ? `"${nombre}"` : 'este elemento'}? Se aplicará al guardar.`)) return;
    item.remove();
    hayCambios = true;
  },
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
    licenciaPendiente = { sistema: el.dataset.sistema || undefined, plan: el.dataset.plan || undefined };
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
  if (!el || !acciones[el.dataset.accion] || el.disabled) return;
  if (el.tagName === 'BUTTON' || el.dataset.accion === 'ir') e.preventDefault();
  try {
    await acciones[el.dataset.accion](el);
  } catch (err) {
    aviso(err.message, true);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-subir]')) return subirImagen(el);
  if (el.dataset.cambio === 'estado-solicitud') {
    try {
      await api('/solicitudes/' + el.dataset.id, { method: 'PUT', body: { estado: el.value } });
      aviso('Estado actualizado');
      actualizarContadores();
    } catch (err) {
      aviso(err.message, true);
    }
  }
  if (el.dataset.cambio === 'licencia-empresa') {
    // Acceso por enlace: se ocultan (y desactivan) los datos del sistema en el servidor.
    const enlace = el.value.startsWith('enlace:');
    el.form.querySelectorAll('[data-solo-servidor]').forEach((b) => {
      b.hidden = enlace;
      b.querySelectorAll('input, select').forEach((c) => (c.disabled = enlace));
    });
    $('[data-ayuda-enlace]', el.form).hidden = !enlace;
    $('button[type=submit]', el.form).textContent = enlace ? 'Dar acceso' : 'Crear sistema';
  }
  if (el.dataset.cambio === 'sistema-licencia') {
    const s = sistemaPorId(el.value);
    el.form.plan.innerHTML = opcionesPlan(s, s?.planes?.[0]?.codigo);
    el.form.maxUsuarios.value = s?.planes?.[0]?.maxUsuarios ?? '';
    recalcularLicencia(el.form, { precio: true });
  }
  if (el.dataset.cambio === 'plan-licencia') {
    el.form.maxUsuarios.value = planDe(sistemaPorId(el.form.sistema.value), el.value)?.maxUsuarios ?? '';
    recalcularLicencia(el.form, { precio: true });
  }
  if (el.dataset.cambio === 'periodo-licencia') {
    // Anual → 1 año, mensual → 1 mes (si la duración era la típica del otro periodo)
    const d = el.form.duracion;
    if (el.value === 'año' && d.value === '1') d.value = '12';
    if (el.value === 'mes' && d.value === '12') d.value = '1';
    aplicarDuracion(el.form);
    recalcularLicencia(el.form, { precio: true });
  }
  if (el.dataset.cambio === 'duracion-licencia' || el.dataset.cambio === 'inicio-licencia') aplicarDuracion(el.form);
  if (el.matches('[data-vence]')) el.form.duracion.value = duracionDe(el.form.fechaInicio.value, el.value);
});

let tBusqueda;
let tVista;
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.closest('.editor')) hayCambios = true;
  if (el.matches('[data-precio]')) el.dataset.editado = el.value === '' ? '' : '1'; // precio a mano: no recalcular
  // Código de la empresa: se sugiere a partir del nombre hasta que se escriba a mano
  if (el.matches('[data-slug]')) el.dataset.editado = '1';
  if (el.matches('[data-slug-origen]')) {
    const slug = $('[data-slug]', el.form);
    if (slug && !slug.dataset.editado) slug.value = slugDe(el.value);
  }
  if (el.matches('[data-imagen]')) {
    clearTimeout(tVista);
    tVista = setTimeout(() => vistaPrevia(el), 400);
  }
  // Actualiza el título de la tarjeta del plan/proyecto mientras se escribe
  if (el.matches('.repetible [data-campo="nombre"], .repetible [data-campo="titulo"]')) {
    const b = $('.repetible__cabecera b', el.closest('.repetible'));
    if (b) b.textContent = el.value || 'Sin nombre';
  }
  if (el.id !== 'buscarUsuario') return;
  clearTimeout(tBusqueda);
  tBusqueda = setTimeout(async () => {
    try {
      $('#tablaUsuarios').innerHTML = await tablaUsuarios(el.value.trim());
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
