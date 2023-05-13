const https = require("https");
const cheerio = require("cheerio");
const { dataUrl } = require("../config/config");
const Team = require("../models/Team");
const getStandingsData = require("../services/getStandingsData");

const scrapingControler = (req, res) => {
  console.log('Scraping service started successfully')
  https
    .get(dataUrl, async (response) => {
      let data = "";

      response.on("data", (chunk) => {
        data += chunk;
      });

      response.on("end", async () => {
        const $ = cheerio.load(data);
        const positionsTable = $("#p_score_contenido_TorneoTabs_collapse3");

        await getStandingsData(positionsTable.html());
      });
    })
    .on("error", (err) => {
      console.error("Error: " + err.message);
      res.render("error");
    });
};

module.exports = scrapingControler;
