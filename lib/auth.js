// Utilidades de autenticación sin dependencias externas:
// contraseñas con scrypt y sesiones firmadas con HMAC en una cookie.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('⚠ SESSION_SECRET no definido: las sesiones se cerrarán al reiniciar el servidor.');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verificarPassword(password, guardado) {
  const [alg, salt, hash] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const calculado = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(calculado, esperado);
}

function firmar(payload, horas) {
  const datos = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + horas * 3600e3 })).toString('base64url');
  const firma = crypto.createHmac('sha256', SECRET).update(datos).digest('base64url');
  return `${datos}.${firma}`;
}

function verificar(token) {
  const [datos, firma] = String(token || '').split('.');
  if (!datos || !firma) return null;
  const esperada = crypto.createHmac('sha256', SECRET).update(datos).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function cookie(req, nombre, valor, segundos, httpOnly = true) {
  const partes = [`${nombre}=${encodeURIComponent(valor)}`, 'Path=/', 'SameSite=Lax', `Max-Age=${segundos}`];
  if (httpOnly) partes.push('HttpOnly');
  if (req.secure) partes.push('Secure');
  return partes.join('; ');
}

// Crea la sesión. Además deja una cookie visible "<nombre>_on=1" para que el
// frontend sepa que hay sesión (sin acceso al token).
function iniciarSesion(req, res, nombre, payload, horas) {
  res.append('Set-Cookie', cookie(req, nombre, firmar(payload, horas), horas * 3600));
  res.append('Set-Cookie', cookie(req, `${nombre}_on`, '1', horas * 3600, false));
}

function cerrarSesion(req, res, nombre) {
  res.append('Set-Cookie', cookie(req, nombre, '', 0));
  res.append('Set-Cookie', cookie(req, `${nombre}_on`, '', 0, false));
}

function leerSesion(req, nombre) {
  return verificar(leerCookie(req, nombre));
}

// Limita intentos por IP (por ejemplo, en el login).
function limitador(max, ventanaMs) {
  const intentos = new Map();
  return (req, res, next) => {
    const ahora = Date.now();
    if (intentos.size > 5000) for (const [k, r] of intentos) if (r.reset < ahora) intentos.delete(k);
    const r = intentos.get(req.ip);
    if (!r || r.reset < ahora) {
      intentos.set(req.ip, { n: 1, reset: ahora + ventanaMs });
      return next();
    }
    if (++r.n > max) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    next();
  };
}

module.exports = { hashPassword, verificarPassword, iniciarSesion, cerrarSesion, leerSesion, limitador };
