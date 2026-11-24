# Backoffice Lugunica

## Requisitos

- Node.js 22.5 o superior

## Iniciar

Desde esta carpeta ejecuta:

```powershell
npm start
```

Abre `http://127.0.0.1:3000`. El servidor crea `data/backoffice.sqlite` al iniciar; no hace falta instalar un servidor SQL ni paquetes de npm.

La estructura SQL esta en `schema.sql`. La base local guarda cuentas, sesiones y proyectos. Las contrasenas se almacenan con scrypt y las sesiones expiran despues de siete dias.

Para ejecutar las pruebas:

```powershell
npm test
```
