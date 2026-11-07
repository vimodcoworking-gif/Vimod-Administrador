const mongoose = require('mongoose');

const ContactoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, match: /.+@.+\..+/ },
    mensaje: { type: String, required: true, trim: true, maxlength: 2000 },
    leido: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Contacto', ContactoSchema);
