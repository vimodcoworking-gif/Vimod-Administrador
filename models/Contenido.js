const mongoose = require('mongoose');

// Textos e imágenes editables de la página (un único documento con _id "sitio").
const ContenidoSchema = new mongoose.Schema(
  {
    _id: { type: String },
    datos: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('Contenido', ContenidoSchema);
