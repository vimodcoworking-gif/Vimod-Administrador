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
  sistemas: vistaSistemas, sistema: vistaSistema, contenido: vistaContenido,
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
  const [{ usuario: u, licencias, solicitudes }] = await Promise.all([api('/usuarios/' + id), cargarSistemas()]);
  vistaActual = { usuario: u, licencias: new Map(licencias.map((l) => [l._id, l])) };

  const filasLic = licencias.map((l) => `
    <tr>
      <td data-col="Software">${esc(l.sistemaNombre || '—')}</td>
      <td data-col="Plan">${esc(l.planNombre)}</td>
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
    <tr><td data-col="Fecha">${fecha(s.createdAt)}</td><td data-col="Software">${esc(s.sistemaNombre) || '—'}</td>
    <td data-col="Plan">${esc(s.planNombre)}</td><td data-col="Estado">${insignia(s.estado || 'pendiente')}</td></tr>`).join('');

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
      <div><b>Acceso</b><span>${u.googleId ? 'Google' : 'Correo y contraseña'}</span></div>
      <div><b>Cliente desde</b><span>${fecha(u.createdAt)}</span></div>
      <div><b>Último acceso</b><span>${fecha(u.ultimoAcceso)}</span></div>
    </div>
    <div class="cabecera" style="margin:40px 0 16px">
      <h2 class="subtitulo" style="margin:0">Licencias y softwares</h2>
      <button class="btn btn--chico" data-accion="nueva-licencia">+ Asignar licencia</button>
    </div>
    ${tabla(['Software', 'Plan', 'Clave', 'Inicio', 'Vence', 'Usuarios', 'Estado', ''], filasLic || filaVacia(8, 'Este usuario aún no tiene licencias.'))}
    <h2 class="subtitulo">Solicitudes con este correo</h2>
    ${tabla(['Fecha', 'Software', 'Plan', 'Estado'], filasSol || filaVacia(4, 'Sin solicitudes.'))}
    ${acceso}`;
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
    ${campoImagen('', p.imagen)}
  </fieldset>`;

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
        <p class="texto-gris">El primer proyecto se muestra más grande.</p>
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
    proyectos: { ...campos(secc('proyectos')), items: $$('.proyecto-editor', form).map((f) => campos2(f)) },
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
  if (!planes.length) return '<option value="">(este software no tiene planes)</option>';
  return opciones(planes.map((p) => [p.codigo, `${p.nombre} · ${precioTexto(p)}`]), actual);
};
const sistemaPorId = (id) => sistemas.find((s) => String(s._id) === String(id));
const planDe = (sistema, codigo) => (sistema?.planes || []).find((p) => p.codigo === codigo);

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
  const planCodigo = l?.plan || prefill.plan || sistema.planes?.[0]?.codigo || '';
  const maxUsuarios = l ? l.maxUsuarios ?? '' : planDe(sistema, planCodigo)?.maxUsuarios ?? '';

  abrirModal(`
    <span class="etiqueta">${esc(u.nombre)}</span>
    <h2 class="titulo">${l ? 'Editar' : 'Asignar'} <strong>licencia</strong></h2>
    <form class="form" id="formLicencia">
      <div class="form__fila">
        <div class="campo"><label>Software</label><select name="sistema" data-cambio="sistema-licencia">${opciones(disponibles.map((s) => [s._id, s.nombre]), sistema._id)}</select></div>
        <div class="campo"><label>Plan</label><select name="plan" data-cambio="plan-licencia">${opcionesPlan(sistema, planCodigo)}</select></div>
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
        <div class="campo"><label>Estado</label><select name="estado">${opciones([['activa', 'Activa'], ['suspendida', 'Suspendida'], ['vencida', 'Vencida']], l?.estado || 'activa')}</select></div>
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
  'editar-licencia': (el) => formLicencia(vistaActual.licencias.get(el.dataset.id)),
  'eliminar-licencia': (el) => confirmarYBorrar('¿Eliminar esta licencia? El cliente dejará de verla.', '/licencias/' + el.dataset.id, 'Licencia eliminada'),
  'eliminar-sistema': (el) => confirmarYBorrar(`¿Eliminar "${el.dataset.nombre}"? Desaparecerá de la página.`, '/sistemas/' + el.dataset.id, 'Software eliminado'),
  'agregar-plan': () => agregarRepetible($('#planesEditor'), planEditor()),
  'agregar-cifra': () => agregarRepetible($('[data-lista="cifras"]'), cifraEditor()),
  'agregar-proyecto': () => agregarRepetible($('[data-lista="items"]'), proyectoEditor()),
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
  if (el.dataset.cambio === 'sistema-licencia') {
    const s = sistemaPorId(el.value);
    el.form.plan.innerHTML = opcionesPlan(s, s?.planes?.[0]?.codigo);
    el.form.maxUsuarios.value = s?.planes?.[0]?.maxUsuarios ?? '';
  }
  if (el.dataset.cambio === 'plan-licencia') {
    el.form.maxUsuarios.value = planDe(sistemaPorId(el.form.sistema.value), el.value)?.maxUsuarios ?? '';
  }
});

let tBusqueda;
let tVista;
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.closest('.editor')) hayCambios = true;
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
