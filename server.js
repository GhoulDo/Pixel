// server.js
require('dotenv').config(); // Cargar variables de entorno
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const morgan = require('morgan'); // Para logs HTTP

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev')); // Registrar solicitudes HTTP

// Conectar a MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/datos';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Conexión a MongoDB exitosa'))
    .catch(err => console.error('Error al conectar a MongoDB:', err.message));

// Esquema de imágenes con validaciones
const imageSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    url: { type: String, required: true },
    pageURL: { type: String, required: true },
    tags: { type: [String], default: [] },
    user: { type: String, required: true },
    userImageURL: { type: String, default: '' },
    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    imageData: { type: Buffer, required: true }, // Campo para almacenar la imagen en binario
}, { collection: 'pixabay' }); // Forzar el nombre de la colección

const Image = mongoose.model('Image', imageSchema);

// Ruta para buscar imágenes en Pixabay
app.get('/api/images', async (req, res) => {
    try {
        const { q, page = 1, per_page = 20 } = req.query; // Paginación
        const response = await axios.get(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${q}&page=${page}&per_page=${per_page}`);
        res.json(response.data);
    } catch (error) {
        console.error('Error al buscar imágenes:', error.message);
        res.status(500).json({ error: 'Error al buscar imágenes' });
    }
});

// Ruta para guardar una imagen
app.post('/api/images', async (req, res) => {
    const { id, url, pageURL, tags, user, userImageURL, likes, views, downloads } = req.body;

    // Validar datos obligatorios
    if (!id || !url || !pageURL || !user) {
        console.error('Faltan datos obligatorios:', { id, url, pageURL, user });
        return res.status(400).json({ error: 'Faltan datos obligatorios: id, url, pageURL o user' });
    }

    try {
        // Verificar si la imagen ya existe en la base de datos
        const existingImage = await Image.findOne({ id });
        if (existingImage) {
            console.log(`La imagen con id ${id} ya existe en la base de datos.`);
            return res.status(409).json({ error: 'La imagen ya existe en la base de datos' });
        }

        // Descargar la imagen desde la URL
        let imageData;
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            imageData = Buffer.from(response.data); // Convertir la imagen a un buffer
        } catch (downloadError) {
            console.error('Error al descargar la imagen desde la URL:', downloadError.message);
            return res.status(500).json({ error: 'Error al descargar la imagen desde la URL' });
        }

        // Crear una nueva instancia del modelo Image
        const newImage = new Image({ id, url, pageURL, tags, user, userImageURL, likes, views, downloads, imageData });

        // Guardar en la base de datos
        await newImage.save();
        console.log(`Imagen con id ${id} guardada exitosamente.`);
        res.status(201).json({ message: 'Imagen guardada exitosamente', image: newImage });
    } catch (error) {
        console.error('Error al guardar la imagen en la base de datos:', error);
        res.status(500).json({ error: 'Error al guardar la imagen en la base de datos' });
    }
});

// Ruta para obtener imágenes guardadas con paginación
app.get('/api/saved-images', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const per_page = parseInt(req.query.per_page) || 12;
        const skip = (page - 1) * per_page;

        // Obtener el total de imágenes para la paginación
        const totalImages = await Image.countDocuments();
        const totalPages = Math.ceil(totalImages / per_page);

        // Obtener las imágenes de la página actual
        const images = await Image.find()
            .skip(skip)
            .limit(per_page);

        res.json({
            images,
            currentPage: page,
            totalPages,
            totalImages
        });
    } catch (error) {
        console.error('Error al obtener las imágenes guardadas:', error);
        res.status(500).json({ error: 'Error al obtener las imágenes guardadas' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});