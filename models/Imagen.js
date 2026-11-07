const mongoose = require('mongoose');

// Imágenes subidas desde el Panel administrador. Se sirven en /imagenes/:id
// desde ambos servidores (página y panel).
const ImagenSchema = new mongoose.Schema(
  {
    datos: { type: Buffer, required: true },
    tipo: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    nombre: { type: String, trim: true, maxlength: 200 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Imagen', ImagenSchema);
