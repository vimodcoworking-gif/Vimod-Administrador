// Cifrado de la contraseña inicial del administrador de cada empresa (AES-256-GCM).
// La clave sale de CIFRADO_SECRETO, que debe ser IGUAL en el Panel y en VIMOD PRESENTACION.
// Archivo idéntico en ambos proyectos.
const crypto = require('crypto');

function clave() {
  const s = process.env.CIFRADO_SECRETO || '';
  return s.length >= 32 ? crypto.createHash('sha256').update(s).digest() : null;
}

const disponible = () => !!clave();

function cifrar(texto) {
  const k = clave();
  if (!k) throw new Error('Falta CIFRADO_SECRETO (32+ caracteres) en la configuración del servidor');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

function descifrar(texto) {
  const k = clave();
  if (!k || !texto) return null;
  try {
    const [v, iv, tag, datos] = String(texto).split(':');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { disponible, cifrar, descifrar };
