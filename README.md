# Backoffice Lugunica

Panel de proyectos con tema Re:Zero. Incluye registro, inicio y cierre de sesion, y un CRUD de proyectos asociado a la cuenta activa.

## Publicado en GitHub Pages

El sitio estatico consume `https://portfolio-api-three-black.vercel.app/api/v1`. Para publicar, sube los cambios a la rama `main`; el workflow de GitHub Actions publica las vistas automaticamente. Activa GitHub Pages con la opcion `GitHub Actions` como fuente en la configuracion del repositorio.

La API debe permitir CORS desde el dominio de GitHub Pages. El sitio envia el token guardado despues del login en el header `auth-token` a las rutas protegidas. La API publica no documenta una ruta para cerrar sesion, por eso el boton de salida elimina el token del navegador.

## Iniciar con SQLite local

Requiere Node.js 22.5 o superior. Ejecuta:

```powershell
npm start
```

Abre `http://127.0.0.1:3000`. El servidor crea `data/backoffice.sqlite` y atiende las mismas rutas de la interfaz. Las cuentas, sesiones y proyectos de esta base local son independientes de los de la API publica.

Para ejecutar pruebas:

```powershell
npm test
```
