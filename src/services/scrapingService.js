const cheerio = require("cheerio");
const Team = require("../models/Team");

const scrapingService = async (table) => {
  const $ = cheerio.load(table);

  $("tr").each(async (i, el) => {
    if (i === 0) return;

    const position = parseInt($(el).find("td").eq(0).text());

    const logo = $(el).find("td").eq(1).find("img").attr("data-src");
    const name = $(el).find("td").eq(1).find("span").first().text();
    const played = parseInt($(el).find("td").eq(2).text());
    const won = parseInt($(el).find("td").eq(3).text());
    const draw = parseInt($(el).find("td").eq(4).text());
    const lost = parseInt($(el).find("td").eq(5).text());
    const goalsScored = parseInt($(el).find("td").eq(6).text());
    const goalsAgainst = parseInt($(el).find("td").eq(7).text());
    const goalDiff = parseInt($(el).find("td").eq(8).text().trim());
    const points = parseInt($(el).find("td").eq(9).text());

    try {
      const doc = await Team.findOne({ name: name });

      if (!doc || doc.played != played || doc.position != position) {
        await Team.findOneAndUpdate(
          { name: name },
          {
            position,
            logo,
            name,
            played,
            won,
            draw,
            lost,
            goalsScored,
            goalsAgainst,
            goalDiff,
            points,
          },
          { upsert: true }
        ).then(() => console.log("Data successfully updated"));
      }
    } catch (error) {
      console.error(error);
    }
  });

  return;
};

module.exports = scrapingService;
