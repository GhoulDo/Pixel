// server.js
require('dotenv').config(); // Cargar variables de entorno
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const morgan = require('morgan'); // Para logs HTTP

// Lista de términos prohibidos y combinaciones sensibles
const PROHIBITED_TERMS = [
    // Términos discriminatorios generales
    'racista', 'racist', 'discriminación', 'discrimination',
    'supremacía', 'supremacy', 'odio racial', 'racial hate',
    'xenofobia', 'xenophobia', 'prejuicio', 'prejudice',
];

// Términos sensibles que no deben combinarse con términos socioeconómicos
const SENSITIVE_TERMS = [
    'negro', 'negra', 'indígena', 'indigena', 'gitano', 'gitana',
    'latino', 'latina', 'asiático', 'asiatica', 'africano', 'africana',
    'etnia', 'raza', 'racial', 'ethnic', 'tribe', 'tribal'
];

const SOCIOECONOMIC_TERMS = [
    'pobreza', 'poverty', 'pobre', 'poor',
    'miseria', 'misery', 'hambre', 'hunger',
    'marginación', 'marginal', 'marginalidad',
    'desigualdad', 'inequality', 'clase baja', 'lower class'
];

// Función para detectar combinaciones sensibles
function containsSensitiveCombination(text) {
    if (!text) return false;
    const normalizedText = text.toLowerCase();
    
    // Verifica si hay términos socioeconómicos
    const hasSocioeconomic = SOCIOECONOMIC_TERMS.some(term => 
        normalizedText.includes(term.toLowerCase())
    );
    
    // Si hay términos socioeconómicos, verifica términos sensibles
    if (hasSocioeconomic) {
        return SENSITIVE_TERMS.some(term => 
            normalizedText.includes(term.toLowerCase())
        );
    }
    
    return false;
}

// Función para validar contenido
function containsProhibitedContent(text) {
    if (!text) return false;
    const normalizedText = text.toLowerCase();
    
    // Verifica términos prohibidos directamente
    const hasProhibitedTerm = PROHIBITED_TERMS.some(term => 
        normalizedText.includes(term.toLowerCase())
    );
    
    // Verifica combinaciones sensibles
    const hasSensitiveCombination = containsSensitiveCombination(text);
    
    return hasProhibitedTerm || hasSensitiveCombination;
}

// Función para filtrar tags
function filterTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.filter(tag => !containsProhibitedContent(tag));
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev')); // Registrar solicitudes HTTP

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static('public'));

// Ruta raíz que sirve index.html
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: './public' });
});

// Conectar a MongoDB (base de datos: Aplication)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/Aplication';
mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000 // Timeout después de 5 segundos
})
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
}, { collection: 'Collection' }); // Forzar el nombre de la colección

const Image = mongoose.model('Image', imageSchema);

// Ruta para buscar imágenes en Pixabay
app.get('/api/images', async (req, res) => {
    try {
        const { q, page = 1, per_page = 20 } = req.query; // Paginación
        
        const searchTerm = q.trim();
        if (!searchTerm) {
            return res.status(400).json({ error: 'El término de búsqueda es requerido' });
        }

        // Validar término de búsqueda
        if (containsProhibitedContent(searchTerm)) {
            return res.status(400).json({ error: 'El término de búsqueda contiene contenido prohibido' });
        }

        if (!process.env.PIXABAY_API_KEY) {
            console.error('Error: API key de Pixabay no configurada');
            return res.status(500).json({ error: 'Error de configuración del servidor' });
        }

        const response = await axios.get(`https://pixabay.com/api/`, {
            params: {
                key: process.env.PIXABAY_API_KEY,
                q: q,
                page: page,
                per_page: per_page
            }
        });

        if (response.data.total === 0) {
            return res.status(404).json({ error: 'No se encontraron imágenes para esta búsqueda' });
        }

        res.json(response.data);
    } catch (error) {
        console.error('Error al buscar imágenes:', error.message);
        if (error.response) {
            // Error de la API de Pixabay
            if (error.response.status === 401) {
                return res.status(401).json({ error: 'API key de Pixabay inválida' });
            }
            return res.status(error.response.status).json({ error: error.response.data.message || 'Error en la API de Pixabay' });
        }
        res.status(500).json({ error: 'Error al buscar imágenes en el servidor' });
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

        // Filtrar tags antes de guardar
        const filteredTags = filterTags(tags);

        // Crear una nueva instancia del modelo Image con tags filtrados
        const newImage = new Image({ id, url, pageURL, tags: filteredTags, user, userImageURL, likes, views, downloads, imageData });

        // Guardar en la base de datos
        await newImage.save();
        console.log(`Imagen con id ${id} guardada exitosamente.`);
        res.status(201).json({ message: 'Imagen guardada exitosamente', image: newImage });
    } catch (error) {
        console.error('Error al guardar la imagen en la base de datos:', error);
        res.status(500).json({ error: 'Error al guardar la imagen en la base de datos' });
    }
});

// Ruta para obtener imágenes guardadas con paginación y búsqueda
app.get('/api/saved-images', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const per_page = parseInt(req.query.per_page) || 12;
        const skip = (page - 1) * per_page;
        const searchQuery = req.query.q ? req.query.q.trim().toLowerCase() : '';

        // Construir el filtro de búsqueda
        let filter = {};
        if (searchQuery) {
            // Validar el término de búsqueda
            if (containsProhibitedContent(searchQuery)) {
                return res.status(400).json({ error: 'El término de búsqueda contiene contenido prohibido' });
            }
            // Buscar en tags y usuario
            filter = {
                $or: [
                    { tags: { $regex: searchQuery, $options: 'i' } },
                    { user: { $regex: searchQuery, $options: 'i' } }
                ]
            };
        }

        // Obtener el total de imágenes para la paginación
        const totalImages = await Image.countDocuments(filter);
        const totalPages = Math.ceil(totalImages / per_page);

        // Obtener las imágenes de la página actual
        const images = await Image.find(filter)
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