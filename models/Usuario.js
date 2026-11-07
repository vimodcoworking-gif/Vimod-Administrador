const mongoose = require('mongoose');

// Clientes de VIMOD. Se registran en la página (correo o Google) o desde el Panel administrador.
const UsuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /.+@.+\..+/ },
    empresa: { type: String, trim: true, maxlength: 160 },
    telefono: { type: String, trim: true, maxlength: 40 },
    passwordHash: { type: String, select: false }, // vacío si solo entra con Google
    googleId: { type: String, unique: true, sparse: true },
    activo: { type: Boolean, default: true },
    ultimoAcceso: { type: Date }
  },
  {
    timestamps: true,
    // Nunca enviar el hash de la contraseña en las respuestas JSON
    toJSON: { transform: (doc, ret) => { delete ret.passwordHash; return ret; } }
  }
);

module.exports = mongoose.model('Usuario', UsuarioSchema);
