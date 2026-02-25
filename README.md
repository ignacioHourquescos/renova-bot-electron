# Renova Bot - Bot de WhatsApp con Baileys

Bot de WhatsApp creado usando la librería [Baileys](https://github.com/WhiskeySockets/Baileys).

## 🚀 Instalación

1. Instala las dependencias:
```bash
npm install
```

## 📱 Uso

1. Inicia el bot en modo desarrollo:
```bash
npm run dev
```

2. Escanea el código QR que aparece en la terminal con tu WhatsApp:
   - Abre WhatsApp en tu teléfono
   - Ve a Configuración > Dispositivos vinculados
   - Toca "Vincular un dispositivo"
   - Escanea el código QR

3. Una vez conectado, el bot estará listo para recibir mensajes.

## 🎯 Comandos disponibles

- `hola` o `hi` - El bot te saluda
- `ping` - El bot responde con "Pong"
- `echo [texto]` - El bot repite el texto que envíes

## 📁 Estructura del proyecto

```
.
├── src/
│   └── index.ts      # Código principal del bot
├── auth_info/        # Credenciales de autenticación (se crea automáticamente)
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Scripts disponibles

- `npm run dev` - Ejecuta el bot en modo desarrollo con recarga automática
- `npm run build` - Compila el código TypeScript
- `npm start` - Ejecuta el bot compilado

## ⚠️ Notas importantes

- La carpeta `auth_info/` contiene las credenciales de autenticación. No la compartas ni la subas a repositorios públicos.
- El bot necesita estar conectado a internet para funcionar.
- Asegúrate de tener Node.js 18+ instalado.

## 📚 Documentación

Para más información sobre Baileys, visita:
- [Documentación oficial](https://baileys.wiki)
- [Repositorio en GitHub](https://github.com/WhiskeySockets/Baileys)

