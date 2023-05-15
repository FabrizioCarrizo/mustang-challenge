
module.exports={
    dataUrl: "https://www.futbolargentino.com/primera-division/tabla-de-posiciones",
    interval: process.env.SCRAPING_INTERVAL ||3600000,
    port: process.env.PORT,
    dbUser: process.env.DB_USER,
    dbPassword: process.env.DB_PASSWORD

}